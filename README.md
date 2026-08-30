# Document Intelligence Pipeline

PDF in → structured representation out: a section tree with page ranges, ordered text, figures,
tables, chunks with provenance, and summaries — with a UI whose job is to make the pipeline's
**routing decisions inspectable** rather than hidden behind a "process" button.

**Live:** https://document-intelligence-pipeline-three.vercel.app
**Seeded** with a nine-document test corpus (manifest in [`corpus/seed/MANIFEST.md`](corpus/seed/MANIFEST.md)) plus a real 48-page NIST report processed as a hold-out. Upload your own PDF from the library screen.

## Architecture

**Triage first, escalate on evidence.** Every page is classified by free deterministic signals
(char count, garbage ratio, image coverage, column clusters, font distribution); only pages that
determinism cannot serve are rasterized and sent to a vision model. Claude Haiku 4.5 handles every
generative call; Sonnet 5 exists as a single escalation path, triggered by evidence (schema failure
twice, or self-reported low confidence) — never pre-assigned by document type. The assignment asks
whether every page should go through an expensive multimodal model: the answer implemented here is
that **routing pages is the architecture**, and the per-page ledger is its proof.

The pipeline runs as a **step function** (`POST /api/documents/:id/step`): each call does one
bounded unit of work with state in Postgres, so every invocation fits serverless limits, a mid-run
failure costs one step, and live progress in the UI falls out for free. At real scale the same step
function moves behind a queue and workers; the routing logic does not change.

Stack: Next.js 14 / TypeScript on Vercel · **mupdf (WASM)** as the sole PDF engine (structured text
with fonts and boxes, metadata, outline, rasterization — one dependency, zero native binaries,
which is the most common way PDF pipelines die on serverless) · Postgres (Neon) + pgvector ·
Gemini `gemini-embedding-001` (768-dim) for embeddings. PDFs are stored as bytes; page images and
crops are **rendered on demand** — there is no image store to keep in sync.

## Pipeline

ingest (SHA-256 short-circuit; corrupt/password files refused at the door with the real reason) →
extract (text+fonts+boxes, per page) → **triage** (classes: clean A / complex B / scanned C /
degraded D / slide / blank) → vision path for C, D, and multi-column B (strict-schema extraction;
reading-order scramble is cheaper to prevent than repair) → **cross-check sampler** (5 clean-looking
pages get a cheap vision read; majority disagreement flips the document to `distrust-text` — the one failure
invisible to every cheap signal is a text layer of plausible garbage) → structure (deterministic
heading candidates reconciled against the PDF outline where present; recurring headers/footers
stored as boilerplate, never destroyed; one cheap normalization call over the candidate list) →
leaf-section chunking → summaries → embeddings → finalize (`complete` / `partial` / `failed`).

A 150-call vision budget caps any document; over it, deterministic extraction still completes,
remaining pages are marked `skipped_budget_exceeded`, and the document is `partial` with coverage
shown — an explicit incomplete answer beats a silent one or an unbounded bill.

## Model & API choices

Haiku 4.5 ($1/$5 per MTok) is capable enough for page extraction and 5× cheaper than the next tier;
Sonnet 5 ($2/$10) earns its cost only on pages that demonstrated a need. Every model call uses a
**strict tool schema** (`strict: true`, `additionalProperties: false`), so malformed output is an
API-level validation failure with a retry path, not a parsing adventure. The API can also ingest
whole PDFs natively — deliberately not used here, because handing the model the whole document is
the exact uniform-expensive-path the assignment warns against, and it would erase the per-page
cost/quality control this design exists to demonstrate.

## Representation, chunking, provenance

`GET /api/documents/:id/export` returns what a downstream system would be handed: document (title
with its source, metadata, generated abstract with evidence), section tree (flat rows with
`parent_id`, each with page range, source `outline|detected|vision|fallback`, confidence), chunks,
elements, per-page ledger rows, boilerplate, warnings.

**Chunks** are contiguous body text of one leaf section, greedy-packed at paragraph boundaries to
500–800 tokens (1,200 ceiling). Figures and tables are **atomic chunks** — never split, never
leaking half-read cell text into prose embeddings. Context travels **by reference, not
duplication**: breadcrumb, prev/next links, block ids, and an embedding-text template
(`"{title} > {breadcrumb}\n\n{text}"`) that buys contextualized retrieval for zero extra model calls.

**Provenance** is two-grade and visibly so: `measured` (deterministic coordinates from the content
stream) vs `asserted` (model-estimated regions) — the inspector draws them in different styles,
because pretending model output has measured precision is how downstream trust dies. Every chunk
traces to blocks → page → document; every model call is a ledger row (model, tokens, ms, dollars)
**written from the execution path**, which is why the costs below are records, not estimates.

## Measured results

| document | pages | routing | model calls | cost |
|---|---|---|---|---|
| NIST AI RMF (real hold-out, uploaded to the deployed instance) | 48 | 41 A / 7 B | 27 | **$0.118** |
| Manufactured scan (110-dpi raster, no text layer) | 8 | 8 C | 17 | $0.117 |
| Clean digital notes | 8 | 7 A / 1 B | 14 | $0.066 |
| Two-column digest | 7 | 6 B | 11 | $0.088 |

The scan recovered the full 8-heading section tree, the figure, and the table from images alone.
The NIST run exercised the outline-prior path (30 sections from the PDF outline) and boilerplate
detection on real running headers ("NIST AI 100-1" on 45 of 48 pages). Cross-document relationships
(bonus) are verified against **planted ground truth**: a near-duplicate pair scored 0.978,
a same-facts-different-wording pair 0.910 (inside the 0.75–0.92 "related" band), and a
distant-domain negative control stayed out of every neighbor list (max 0.609). The system also
flagged the scan as a near-duplicate of its own digital source — through OCR — unprompted.

## Failure modes (all surfaced in the UI, none silent)

Plausible-garbage text layers (caught by the sampler); heading over/under-detection (outline
reconciliation + tree-shape sanity warnings); reading-order scramble (prevented by pre-emptive
escalation); confidently-wrong tables (schema + invariants; on failure the crop is kept and the
table is marked `table_extraction_failed` — an honest image beats a wrong grid); unreadable pages;
budget blowout (`partial` + coverage); malformed model output (strict schemas → retry → escalate →
honest failure); **provider content filtering** — verbatim OCR of book-like pages can trip a
recitation guard; the pipeline retries once with document context, then keeps the page as image
with a named `CONTENT_FILTER` warning. Boilerplate that carries value (a DOI in a running header)
is excluded from chunks but preserved and inspectable.

## Tradeoffs and honest limitations

No local OCR engine — the vision path does OCR-plus-structure in one call and triage bounds its
cost; the tradeoff is that scanned-page coordinates are asserted-grade. Vector-drawn figures on
clean pages are not detected as figure elements (the image signal sees raster XObjects); the NIST
hold-out surfaced this and it is recorded rather than patched around. Cross-page tables are
surfaced as two tables with a note. Two findings from building the corpus: the engine **repairs**
damaged xrefs (a 35%-truncated file still opened with all pages — the true fast-fail boundary is
"no recoverable page tree"), and per-row database writes that are invisible locally are fatal at
cloud latency (fixed with batched inserts; the timeout that taught this is in the ledger).

## With another week

A queue/worker execution path behind the same step function; region-level vision assists for
figure/table crops on clean pages (closing the vector-figure gap); a retrieval-quality harness
(labeled Q&A, recall@k) instead of qualitative chunk design; reading-order confidence scoring;
user correction of headings/regions feeding back into the representation; per-tenant auth.

## Running locally

```bash
npm install
cp .env.example .env.local   # ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, DATABASE_URL
npm run db:schema
python3 scripts/corpus/build.py   # rebuild the test corpus (reportlab, pypdf, img2pdf)
npm run dev                       # then upload from http://localhost:3000
npm test                          # triage + chunker unit tests
```
