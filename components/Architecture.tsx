"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { StatusChip } from "./ui";

type Stage = {
  id: string;
  n: number;
  name: string;
  ledger: string | null; // exact `stage` string its ledger rows carry; null = runs before a document exists
  model: string | null;
  modelTone: string;
  conditional?: boolean;
  bypass?: string; // label on the skip lane drawn alongside a conditional stage
  one: string; // hover popover line
  what: string[];
  decisions: string[];
  fails: string[]; // each "problem → how it is surfaced"
  measured: string; // from the NIST holdout run on the deployed instance
  chips?: string[]; // always-visible footer chips on the node
};

const STAGES: Stage[] = [
  {
    id: "ingest", n: 1, name: "Ingest", ledger: null, model: null, modelTone: "bg-gray-100 text-gray-600",
    one: "Accept or refuse at the door. A refused file never becomes a document, so nothing to ledger.",
    what: [
      "SHA-256 the bytes; an already-seen document short-circuits to its existing result.",
      "Open with mupdf. Caps: 50 MB, 300 pages.",
    ],
    decisions: [
      "Refuse corrupt and password-protected files with the real reason, not a generic error.",
      "mupdf repairs damaged cross-reference tables, so the honest fast-fail boundary is “no recoverable page tree”, not “damaged file”. A 35%-truncated file still opens.",
    ],
    fails: [
      "Unprocessable file → refused immediately, reason shown in the upload UI.",
      "Password-protected → refused as its own case, distinguished from generic parse failure.",
    ],
    measured: "NIST: 48 pages accepted. The corpus's corrupt and password seeds are refused at this door, on purpose.",
    chips: ["refuses: corrupt · password · over-caps"],
  },
  {
    id: "extract", n: 2, name: "Extract", ledger: "extract", model: null, modelTone: "bg-gray-100 text-gray-600",
    one: "Structured text with fonts and boxes, per page, in batches. Deterministic and free.",
    what: [
      "mupdf structured text: every line with its font, size, boldness, and a measured bounding box.",
      "Runs in batches of pages per step call; each batch is one ledger row.",
    ],
    decisions: [
      "Coordinates from the content stream are stored as measured-grade provenance.",
      "Batched, idempotent writes: per-row inserts that were invisible locally were 60s-timeout fatal at cloud latency.",
    ],
    fails: [
      "A plausible-garbage text layer sails through here looking fine → that is exactly what the cross-check sampler exists to catch downstream.",
    ],
    measured: "NIST: 8 batches, 48 pages, about 1.1s of wall clock, $0.",
  },
  {
    id: "triage", n: 3, name: "Triage", ledger: "triage", model: null, modelTone: "bg-gray-100 text-gray-600",
    one: "Free deterministic signals classify every page. This is the routing decision the whole design argues for.",
    what: [
      "Signals per page: character count, garbage ratio, image coverage, column clusters, font spread, orientation.",
      "Classes: A clean digital · B complex · C scanned · D degraded · slide · blank.",
    ],
    decisions: [
      "A, slide, blank: deterministic extraction stands, no model is called.",
      "C, D, and multi-column B: routed to the vision path. Figure-heavy B stays deterministic; reading order is not at risk there.",
      "Over 40% scanned/degraded → SCAN_HEAVY warning: structure fidelity is OCR-limited and the document says so.",
    ],
    fails: [
      "Misclassification costs money, not correctness: a clean page sent to vision wastes cents; a garbage page kept deterministic is caught by the sampler.",
    ],
    measured: "NIST: 490ms, classes {A:41, B:7}, $0. Only one of the 7 complex pages was multi-column.",
  },
  {
    id: "vision", n: 4, name: "Vision path", ledger: "vision", model: "Haiku 4.5 → Sonnet 5 on evidence", modelTone: "bg-amber-100 text-amber-800",
    conditional: true, bypass: "41 of 48 NIST pages skip this entirely",
    one: "Only the pages that earned it. Strict-schema page reading from the rendered image.",
    what: [
      "Page rendered on demand, read under a strict tool schema: blocks in true reading order, plus figures and tables with regions.",
      "Escalation is evidence-triggered, never pre-assigned: two schema failures or self-reported low confidence → Sonnet 5.",
    ],
    decisions: [
      "Reading-order scramble is cheaper to prevent than repair: multi-column pages go whole-page vision pre-emptively.",
      "Vision block coordinates are converted to page points at ingest; figure and table regions are stored exactly as asserted, in [0,1] page fractions, and drawn dashed to say so.",
      "A 150-call vision budget caps any document: past it, pages are marked skipped, the document finishes partial with coverage shown.",
    ],
    fails: [
      "Malformed output → API-level validation failure → retry → escalate → honest failure, in that order.",
      "Verbatim OCR of book-like pages can trip the provider's recitation guard → retried once with document context, then kept as image with a named CONTENT_FILTER warning.",
      "A table the model cannot read honestly → extraction_ok=false: the crop is kept, the table is marked failed, no invented cells.",
    ],
    measured: "NIST: 1 call (page 4, the multi-column TOC), 17.9s, $0.0257. Escalation never fired.",
    chips: ["strict tool schema", "150-call budget → partial", "CONTENT_FILTER is a named failure"],
  },
  {
    id: "sampler", n: 5, name: "Cross-check sampler", ledger: "sampler", model: "Haiku 4.5, cheap reads", modelTone: "bg-amber-100 text-amber-800",
    one: "Five clean-looking pages get a vision read anyway. The one failure no cheap signal can see is a text layer of plausible garbage.",
    what: [
      "Sample up to five pages the triage trusted; compare each cheap vision read against the extracted text by word overlap.",
      "Every comparison is a ledger row with its overlap score.",
    ],
    decisions: [
      "Majority disagreement (at least 2, and at least half the sample) → the whole document flips to distrust-text and the text layer is re-read as images.",
      "One benign mismatch does not flip anything, and the ledger shows exactly that happening.",
    ],
    fails: [
      "A sampler call that fails is logged as its own row → the sample is smaller, never silently padded.",
      "Majority mismatch → DISTRUST_TEXT warning on the document, visible in the UI.",
    ],
    measured: "NIST: 5 pages, overlaps 0.53–0.97, 1 mismatch (the sparse cover). Majority rule: no flip, and that is correct.",
    chips: ["majority mismatch → distrust-text"],
  },
  {
    id: "structure", n: 6, name: "Structure", ledger: "structure", model: "one normalization call", modelTone: "bg-amber-100 text-amber-800",
    one: "Heading candidates reconciled against the PDF outline where one exists. Boilerplate preserved, never destroyed.",
    what: [
      "Deterministic heading candidates from font statistics; the PDF outline, when present, is used as the prior.",
      "Recurring running headers and footers are detected as boilerplate: excluded from chunks, preserved and inspectable.",
      "One cheap normalization call over the candidate list; a document-level decision, not per-page.",
    ],
    decisions: [
      "Section sources are recorded per row: outline, detected, vision, or fallback. Nothing pretends to a provenance it lacks.",
      "Suspicious adjacent headings → HEADING_SANITY warnings; outline/detection disagreement → OUTLINE_DISAGREES, surfaced, with the outline kept as prior.",
    ],
    fails: [
      "Normalization call fails → the ledger row says so and deterministic levels are used. The pipeline does not stop.",
    ],
    measured: "NIST: 30 sections from the outline prior; 10 HEADING_SANITY warnings and one OUTLINE_DISAGREES surfaced, not hidden. Boilerplate caught “NIST AI 100-1” on 45 of 48 pages.",
  },
  {
    id: "chunk", n: 7, name: "Chunking", ledger: "chunk", model: null, modelTone: "bg-gray-100 text-gray-600",
    one: "Leaf-section scoped, packed at paragraph boundaries. Figures and tables are atomic.",
    what: [
      "Contiguous body text of one leaf section, greedy-packed at paragraph boundaries to 500–800 tokens (1,200 ceiling).",
      "Figures and tables become atomic chunks: never split, never leaking half-read cells into prose embeddings.",
    ],
    decisions: [
      "Context travels by reference, not duplication: breadcrumb, prev/next links, block ids.",
      "The embedding text template prepends title and breadcrumb, buying contextualized retrieval for zero extra model calls.",
    ],
    fails: [
      "An oversized section hits the 1,200-token ceiling and splits at the nearest paragraph, never mid-table.",
    ],
    measured: "NIST: 39 chunks, 384ms, $0.",
  },
  {
    id: "summarize", n: 8, name: "Summaries", ledger: "summarize", model: "Haiku 4.5", modelTone: "bg-amber-100 text-amber-800",
    one: "Per-section summaries plus a document abstract that names its evidence.",
    what: [
      "One call per substantial section; each ledger row carries the section title it summarized.",
      "The document abstract is generated last and marked generated, with the section titles it drew on recorded as evidence.",
    ],
    decisions: [
      "Summaries are labeled as generated content in the representation; they never masquerade as extracted text.",
    ],
    fails: [
      "A failed call is a ledger row with the error in its note; the section keeps no summary rather than a fabricated one.",
    ],
    measured: "NIST: 20 calls (19 sections + the abstract), $0.046.",
  },
  {
    id: "embed", n: 9, name: "Embeddings", ledger: "embed", model: "gemini-embedding-001 · 768d", modelTone: "bg-sky-100 text-sky-800",
    one: "Every chunk embedded once; relationships reuse these vectors for free.",
    what: [
      "gemini-embedding-001 at 768 truncated dimensions into pgvector, one batch.",
      "Truncated-dimension embeddings are not pre-normalized → normalized in code so cosine works via inner product.",
    ],
    decisions: [
      "The cross-document relationships screen is built entirely on these vectors: near-duplicate ≥ 0.92, related 0.75–0.92, calibrated against planted ground truth.",
    ],
    fails: [
      "An embedding failure fails the step visibly; nothing is written half-embedded.",
    ],
    measured: "NIST: 39 chunks embedded, 787ms, one batch.",
  },
  {
    id: "finalize", n: 10, name: "Finalize", ledger: "finalize", model: null, modelTone: "bg-gray-100 text-gray-600",
    one: "complete, partial, or failed. Partial is a first-class honest answer with coverage shown.",
    what: [
      "Totals are written from the execution path: model calls, dollars, wall clock.",
      "Status reflects what actually happened: complete, partial (with what was skipped and why), or failed.",
    ],
    decisions: [
      "An explicit incomplete answer beats a silent one or an unbounded bill.",
    ],
    fails: [
      "A step that errors writes a STEP ERROR note on its own stage and the document lands failed, never silently stuck.",
    ],
    measured: "NIST: complete · 27 model calls · $0.1177 · 181.8s.",
  },
];

export default function Architecture() {
  const [sel, setSel] = useState<string | null>(null);
  const [nistHref, setNistHref] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/documents").then(r => r.json()).then(j => {
      const done = (j.documents ?? []).filter((d: any) => d.status === "complete");
      if (!done.length) return;
      const biggest = done.sort((a: any, b: any) => b.page_count - a.page_count)[0];
      setNistHref(`/doc/${biggest.id}?tab=Ledger`);
    }).catch(() => {});
  }, []);

  const stage = STAGES.find(s => s.id === sel) ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      {/* the board */}
      <section className="rounded-xl border border-gray-300 bg-white bg-[radial-gradient(circle,#e5e7eb_1px,transparent_1px)] [background-size:22px_22px] p-4 sm:p-8">
        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span><span className="mr-1 inline-block h-0 w-6 border-t-2 border-gray-400 align-middle" />every document</span>
          <span><span className="mr-1 inline-block h-0 w-6 border-t-2 border-dashed border-amber-500 align-middle" />conditional path</span>
          <span><span className="mr-1 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700">stage</span>= the exact name its ledger rows carry</span>
        </div>

        <ol className="mx-auto max-w-xl">
          {STAGES.map((s, i) => (
            <li key={s.id} className="relative">
              {/* bypass lane alongside a conditional stage */}
              {s.conditional && (
                <div className="pointer-events-none absolute -left-2 top-[-14px] bottom-[-14px] hidden w-10 sm:block" aria-hidden>
                  <div className="absolute left-0 top-0 h-full w-px border-l-2 border-dashed border-amber-500/70" />
                  <div className="absolute left-0 top-0 w-6 border-t-2 border-dashed border-amber-500/70" />
                  <div className="absolute left-0 bottom-0 w-6 border-t-2 border-dashed border-amber-500/70" />
                </div>
              )}
              {s.conditional && s.bypass && (
                <div className="pointer-events-none absolute -left-3 top-1/2 hidden -translate-x-full -translate-y-1/2 -rotate-90 whitespace-nowrap text-[11px] font-medium text-amber-600 lg:block" aria-hidden>
                  {s.bypass} ↓
                </div>
              )}

              <button onClick={() => setSel(sel === s.id ? null : s.id)}
                className={clsx("group relative block w-full rounded-xl border-2 bg-white p-4 text-left shadow-sm transition",
                  s.conditional ? "border-dashed" : "border-solid",
                  sel === s.id ? "border-brand-500 ring-2 ring-brand-200" : "border-gray-300 hover:border-gray-400")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={clsx("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                    sel === s.id ? "bg-brand-600 text-white" : "bg-gray-900 text-white")}>{s.n}</span>
                  <span className="text-base font-semibold text-gray-900">{s.name}</span>
                  {s.ledger
                    ? <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700" title="ledger rows for this stage carry exactly this name">{s.ledger}</span>
                    : <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800" title="a refused file never becomes a document, so there is no ledger to write to">before the ledger</span>}
                  {s.model && <span className={clsx("ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium", s.modelTone)}>{s.model}</span>}
                  {!s.model && <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">no model · $0</span>}
                </div>
                {s.chips?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.chips.map(c => <span key={c} className="rounded border border-dashed border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-500">{c}</span>)}
                  </div>
                ) : null}
                {s.id === "finalize" && (
                  <div className="mt-2 flex gap-1.5"><StatusChip s="complete" /><StatusChip s="partial" /><StatusChip s="failed" /></div>
                )}
                {/* hover popover */}
                <div className="pointer-events-none invisible absolute left-1/2 top-full z-10 mt-1 w-72 -translate-x-1/2 rounded-lg border border-gray-200 bg-gray-900 p-2.5 text-xs leading-relaxed text-gray-100 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100">
                  {s.one}<span className="mt-1 block text-gray-400">click to pin details</span>
                </div>
              </button>

              {i < STAGES.length - 1 && (
                <div className="flex h-7 flex-col items-center justify-center" aria-hidden>
                  <div className="w-0.5 flex-1 bg-gray-400" />
                  <div className="-mt-0.5 h-0 w-0 border-x-4 border-t-[6px] border-x-transparent border-t-gray-400" />
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>

      {/* the detail panel */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        {!stage ? (
          <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm leading-relaxed text-gray-700">
            <div className="mb-2 text-base font-semibold text-gray-900">The board and the ledger agree, by construction</div>
            <p>Every stage on this board writes its ledger rows under the <span className="font-mono text-xs">stage</span> name printed on the node, and every stage name a ledger can contain is a node on this board. Read a row, find its box; click a box, see its rows.</p>
            <p className="mt-3">Two honest edges of that rule:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li><span className="font-medium">Ingest refusals never reach a ledger</span>, because a refused file never becomes a document. The refusal and its reason surface in the upload UI instead.</li>
              <li><span className="font-medium">There is no separate error stage.</span> A step that fails writes a STEP ERROR note on the stage it failed in. Errors live where they happened.</li>
            </ul>
            <p className="mt-3 text-gray-500">Click any stage for what runs, the decisions it takes, what can go wrong, and its measured numbers from the real 48-page NIST holdout.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm leading-relaxed">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white">{stage.n}</span>
              <span className="text-base font-semibold text-gray-900">{stage.name}</span>
              {stage.ledger && <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700">{stage.ledger}</span>}
            </div>
            <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-gray-400">What runs</div>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-gray-700">{stage.what.map((t, i) => <li key={i}>{t}</li>)}</ul>
            <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-gray-400">The decisions</div>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-gray-700">{stage.decisions.map((t, i) => <li key={i}>{t}</li>)}</ul>
            <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-gray-400">What can go wrong → how it surfaces</div>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-gray-700">{stage.fails.map((t, i) => <li key={i}>{t}</li>)}</ul>
            <div className="mt-3 rounded-lg bg-gray-50 p-3 text-gray-700">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Measured, not estimated</div>
              <div className="mt-1">{stage.measured}</div>
            </div>
            {stage.ledger && nistHref && (
              <Link href={nistHref} className="mt-3 inline-block text-brand-700 hover:underline">
                See <span className="font-mono text-xs">{stage.ledger}</span> rows in a real ledger →
              </Link>
            )}
            {!stage.ledger && (
              <p className="mt-3 text-gray-500">No ledger rows exist for this stage: a refused file never becomes a document. Try it from the library: a corrupt or password-protected PDF is refused with its reason.</p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
