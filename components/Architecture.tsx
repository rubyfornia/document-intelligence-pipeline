"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { CLASS_COLORS, StatusChip } from "./ui";

type Stage = {
  id: string;
  n: number;
  name: string;
  ledger: string | null; // exact `stage` string its ledger rows carry; null = runs before a document exists
  model: string | null;
  modelTone: string;
  one: string; // hover popover line
  what: string[];
  decisions: string[];
  fails: string[]; // each "problem → how it is surfaced"
  measured: string; // from the NIST holdout run on the deployed instance
};

const STAGES: Stage[] = [
  {
    id: "ingest", n: 1, name: "Ingest", ledger: null, model: null, modelTone: "bg-gray-100 text-gray-600",
    one: "Accept or refuse at the door. A refused file never becomes a document, so nothing to ledger.",
    what: [
      "SHA-256 the bytes; an already-seen document short-circuits to its existing result (cached).",
      "Open with mupdf. Caps: 50 MB, 300 pages.",
    ],
    decisions: [
      "Refuse corrupt and password-protected files with the real reason, not a generic error.",
      "mupdf repairs damaged cross-reference tables, so the honest fast-fail boundary is “no recoverable page tree”, not “damaged file”. A 35%-truncated file still opens.",
    ],
    fails: [
      "Unprocessable file → refused 422 with the reason in the upload UI.",
      "Password-protected → refused 422 as its own case, distinguished from generic parse failure.",
      "Over caps → refused 413 (size or page count named).",
    ],
    measured: "NIST: 48 pages accepted. The corpus's corrupt and password seeds are refused at this door, on purpose.",
  },
  {
    id: "extract", n: 2, name: "Extract", ledger: "extract", model: null, modelTone: "bg-gray-100 text-gray-600",
    one: "Structured text with fonts and boxes, per page, in 6-page batches. Deterministic and free.",
    what: [
      "mupdf structured text: every line with its font, size, boldness, and a measured bounding box in page points.",
      "Runs in batches of 6 pages per step call; each batch is one ledger row.",
    ],
    decisions: [
      "Coordinates from the content stream are stored as measured-grade provenance (solid style in the inspector).",
      "Batched, idempotent writes: per-row inserts that were invisible locally were 60s-timeout fatal at cloud latency.",
    ],
    fails: [
      "A plausible-garbage text layer sails through here looking fine → that is exactly what the cross-check sampler exists to catch downstream.",
    ],
    measured: "NIST: 8 batches, 48 pages, about 1.1s of wall clock, $0.",
  },
  {
    id: "triage", n: 3, name: "Triage — the switch", ledger: "triage", model: null, modelTone: "bg-gray-100 text-gray-600",
    one: "Free deterministic signals classify every page and dictate its route. This is the decision the whole design argues for.",
    what: [
      "Signals per page: character count, garbage ratio, image coverage, column clusters, font spread, orientation.",
      "Classes: A clean digital · B complex · C scanned · D degraded · slide · blank.",
    ],
    decisions: [
      "A, slide, blank, and figure-heavy or short B: deterministic extraction stands, no model is called.",
      "Multi-column B, C, and D: routed to the vision path (reading-order scramble is cheaper to prevent than repair).",
      "A page whose garbage ratio is high gets a distrust-text flag at triage time, independent of the sampler.",
      "Over 40% scanned/degraded → SCAN_HEAVY warning: structure fidelity is OCR-limited and the document says so.",
    ],
    fails: [
      "Misclassification costs money, not correctness: a clean page sent to vision wastes cents; a garbage page kept deterministic is caught by the sampler.",
    ],
    measured: "NIST: 490ms, classes {A:41, B:7}, $0. Of the 7 complex pages, only one (the multi-column TOC) routed to vision.",
  },
  {
    id: "vision", n: 4, name: "Vision path", ledger: "vision", model: "Haiku 4.5 → Sonnet 5 on evidence", modelTone: "bg-amber-100 text-amber-800",
    one: "Only the pages that earned it. Strict-schema page reading from the on-demand rendered image.",
    what: [
      "Page rendered on demand, read under a strict tool schema: blocks in true reading order, plus figures and tables with regions.",
      "On success the page's deterministic lines are replaced by the vision reading order, stored asserted-grade in page points.",
      "Figure and table regions are stored exactly as the model asserted them, in [0,1] page fractions, and drawn dashed to say so.",
    ],
    decisions: [
      "Escalation is evidence-triggered, never pre-assigned: schema failure after retry, then Sonnet 5.",
      "A 150-call vision budget caps any document: the excess is flagged skipped_budget_exceeded up front and the document finishes partial with coverage shown.",
      "Self-reported confidence under 0.5 → a LOW_CONFIDENCE warning with the model's own note.",
    ],
    fails: [
      "Malformed output → API-level validation failure → retry → escalate → VISION_FAILED warning; the page keeps its deterministic text. Honest degrade, not a crash.",
      "Verbatim OCR of book-like pages can trip the provider's recitation guard → retried once with document context, then kept as image with a named CONTENT_FILTER warning.",
      "A table the model cannot read honestly → extraction_ok=false: the crop is kept, the table is marked table_extraction_failed, no invented cells.",
    ],
    measured: "NIST: 1 call (page 4, the multi-column TOC), 17.9s, $0.0257. Escalation never fired.",
  },
  {
    id: "sampler", n: 5, name: "Cross-check sampler", ledger: "sampler", model: "Haiku 4.5, cheap reads", modelTone: "bg-amber-100 text-amber-800",
    one: "Up to five clean-looking pages get a vision read anyway. The one failure no cheap signal can see is a text layer of plausible garbage.",
    what: [
      "Sample up to 5 pages the triage trusted; compare each cheap vision read against the extracted text by word overlap (Jaccard).",
      "Every comparison is a ledger row with its overlap score.",
    ],
    decisions: [
      "Majority disagreement — at least 2, and at least half the sample — flips the document to distrust-text: a totals flag plus a DISTRUST_TEXT warning. Pages are not re-run; the flag rides with the document so every consumer knows.",
      "One benign mismatch does not flip anything, and the ledger shows exactly that happening.",
    ],
    fails: [
      "A sampler call that fails is logged as its own row → the sample is smaller, never silently padded.",
    ],
    measured: "NIST: 5 pages, overlaps 0.53–0.97, 1 mismatch (the sparse cover). Majority rule: no flip, and that is correct.",
  },
  {
    id: "structure", n: 6, name: "Structure", ledger: "structure", model: "one normalization call", modelTone: "bg-amber-100 text-amber-800",
    one: "Heading candidates reconciled against the PDF outline where one exists. Boilerplate preserved, never destroyed.",
    what: [
      "If the PDF carries an outline, it is the prior (source: outline). Otherwise font-statistics candidates (source: detected), or vision headings on vision pages (source: vision).",
      "Recurring running headers and footers are detected as boilerplate: excluded from chunks, preserved and inspectable.",
      "One cheap normalization call over the candidate list; a document-level decision, not per-page.",
    ],
    decisions: [
      "Section sources are recorded per row: outline, detected, vision, or fallback. Nothing pretends to a provenance it lacks.",
      "Suspicious adjacent headings → HEADING_SANITY warnings; outline/detection disagreement → OUTLINE_DISAGREES, surfaced, with the outline kept as prior.",
      "Nothing found at all → a single “Document” section, source: fallback.",
    ],
    fails: [
      "Normalization call fails → the ledger row says “deterministic levels used”. The pipeline does not stop.",
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
      "Totals are written from the execution path: model calls, dollars, wall clock, page-class counts.",
      "Status: any page flagged skipped_budget_exceeded → partial; otherwise complete.",
    ],
    decisions: [
      "An explicit incomplete answer beats a silent one or an unbounded bill.",
      "Any step that throws three times → STEP ERROR rows on its own stage, and the document lands failed with the error stored. There is no separate error stage.",
    ],
    fails: [
      "failed is a first-class terminal state, never a silent hang: the run closes, the error is on the document.",
    ],
    measured: "NIST: complete · 27 model calls · $0.1177 · 181.8s.",
  },
];

/* ---------- small graph pieces ---------- */

function EdgeV({ label, dashed = false, h = "h-7" }: { label?: string; dashed?: boolean; h?: string }) {
  return (
    <div className={clsx("flex flex-col items-center justify-center", h)} aria-hidden>
      {label && <div className="mb-0.5 rounded bg-white/80 px-1 text-[10px] text-gray-500">{label}</div>}
      <div className={clsx("w-0 flex-1 border-l-2", dashed ? "border-dashed border-amber-500" : "border-solid border-gray-400")} />
      <div className={clsx("-mt-0.5 h-0 w-0 border-x-4 border-t-[6px] border-x-transparent", dashed ? "border-t-amber-500" : "border-t-gray-400")} />
    </div>
  );
}

function Diamond({ q, onClick }: { q: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="group relative mx-auto block" title={q}>
      <div className="mx-auto h-9 w-9 rotate-45 rounded-sm border-2 border-gray-500 bg-white shadow-sm transition group-hover:border-gray-700" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 w-52 -translate-x-1/2 -translate-y-1/2 text-center text-[11px] font-medium leading-tight text-gray-800">{q}</div>
    </button>
  );
}

function Terminal({ children, tone = "rose" }: { children: React.ReactNode; tone?: "rose" | "gray" | "amber" }) {
  const tones = { rose: "border-rose-400 text-rose-700 bg-rose-50", gray: "border-gray-400 text-gray-700 bg-gray-50", amber: "border-amber-400 text-amber-800 bg-amber-50" };
  return <span className={clsx("inline-block rounded-full border border-dashed px-2.5 py-1 text-[11px] font-medium leading-tight", tones[tone])}>{children}</span>;
}

function ClassDot({ c }: { c: string }) {
  return <span className={clsx("inline-block h-2.5 w-2.5 rounded-[2px] align-middle", CLASS_COLORS[c] ?? "bg-gray-300")} />;
}

function Branch({ q, out, onClick }: { q: string; out: { label: React.ReactNode; side: "l" | "r" }[]; onClick?: () => void }) {
  // a decision diamond with dashed side-exits; the main flow continues below it
  const left = out.filter(o => o.side === "l"), right = out.filter(o => o.side === "r");
  return (
    <div className="relative py-2">
      <Diamond q={q} onClick={onClick} />
      {left.map((o, i) => (
        <div key={`l${i}`} className="absolute right-1/2 top-1/2 mr-8 flex -translate-y-1/2 items-center gap-1.5" style={{ marginTop: i * 30 }}>
          <div className="max-w-[220px] text-right">{o.label}</div>
          <div className="w-8 border-t-2 border-dashed border-amber-500" aria-hidden />
        </div>
      ))}
      {right.map((o, i) => (
        <div key={`r${i}`} className="absolute left-1/2 top-1/2 ml-8 flex -translate-y-1/2 items-center gap-1.5" style={{ marginTop: i * 30 }}>
          <div className="w-8 border-t-2 border-dashed border-amber-500" aria-hidden />
          <div className="max-w-[240px]">{o.label}</div>
        </div>
      ))}
    </div>
  );
}

function StageCard({ s, sel, setSel, extra }: { s: Stage; sel: string | null; setSel: (v: string | null) => void; extra?: React.ReactNode }) {
  return (
    <button onClick={() => setSel(sel === s.id ? null : s.id)}
      className={clsx("group relative block w-full rounded-xl border-2 bg-white p-3.5 text-left shadow-sm transition",
        sel === s.id ? "border-brand-500 ring-2 ring-brand-200" : "border-gray-300 hover:border-gray-400")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={clsx("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          sel === s.id ? "bg-brand-600 text-white" : "bg-gray-900 text-white")}>{s.n}</span>
        <span className="text-sm font-semibold text-gray-900">{s.name}</span>
        {s.ledger
          ? <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700" title="ledger rows for this stage carry exactly this name">{s.ledger}</span>
          : <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800" title="a refused file never becomes a document, so there is no ledger to write to">before the ledger</span>}
        {s.model
          ? <span className={clsx("ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium", s.modelTone)}>{s.model}</span>
          : <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">no model · $0</span>}
      </div>
      {extra}
      <div className="pointer-events-none invisible absolute left-1/2 top-full z-20 mt-1 w-72 -translate-x-1/2 rounded-lg border border-gray-200 bg-gray-900 p-2.5 text-xs leading-relaxed text-gray-100 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100">
        {s.one}<span className="mt-1 block text-gray-400">click to pin details</span>
      </div>
    </button>
  );
}

const Mini = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] leading-snug text-gray-700">{children}</div>
);
const MiniQ = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-1.5 text-[11px] leading-snug text-gray-700">
    <span className="inline-block h-2 w-2 shrink-0 rotate-45 border border-gray-500 bg-white" />{children}
  </div>
);

/* ---------- the board ---------- */

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

  const S = (id: string) => STAGES.find(s => s.id === id)!;
  const stage = STAGES.find(s => s.id === sel) ?? null;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="overflow-x-auto rounded-xl border border-gray-300 bg-white bg-[radial-gradient(circle,#e5e7eb_1px,transparent_1px)] [background-size:22px_22px] p-4 sm:p-8">
        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span><span className="mr-1 inline-block h-0 w-6 border-t-2 border-gray-400 align-middle" />every document</span>
          <span><span className="mr-1 inline-block h-0 w-6 border-t-2 border-dashed border-amber-500 align-middle" />conditional / exit</span>
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rotate-45 border-2 border-gray-500 bg-white align-middle" /> decision</span>
          <span><span className="mr-1 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700">stage</span>= the exact name its ledger rows carry</span>
        </div>

        <div className="min-w-[560px]">

          {/* 1 · ingest + its two gates */}
          <StageCard s={S("ingest")} sel={sel} setSel={setSel} />
          <EdgeV h="h-5" />
          <Branch q="seen before? (SHA-256)" onClick={() => setSel("ingest")}
            out={[{ side: "r", label: <Terminal tone="gray">yes → return the existing document, cached, zero work</Terminal> }]} />
          <EdgeV label="no" h="h-5" />
          <Branch q="recoverable page tree · no password · under caps?" onClick={() => setSel("ingest")}
            out={[{ side: "r", label: <Terminal>no → REFUSED at the door with the real reason (422/413) — never becomes a document</Terminal> }]} />
          <EdgeV label="document created · processing" />

          {/* 2 · extract */}
          <StageCard s={S("extract")} sel={sel} setSel={setSel}
            extra={<div className="mt-1.5 text-[11px] text-gray-500">6-page batches · measured boxes from the content stream · idempotent batch writes</div>} />
          <EdgeV />

          {/* 3 · triage switch */}
          <StageCard s={S("triage")} sel={sel} setSel={setSel}
            extra={<div className="mt-1.5 text-[11px] text-gray-500">signals: chars · garbage ratio · image coverage · column clusters · font spread → class + route per page</div>} />
          <EdgeV label="switch (class, per page)" h="h-8" />

          {/* the two lanes */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border-2 border-gray-300 bg-white p-3">
              <div className="text-xs font-semibold text-gray-900">Deterministic lane — $0</div>
              <div className="mt-1.5 space-y-1 text-[11px] text-gray-700">
                <div><ClassDot c="A" /> A clean digital → extracted text stands</div>
                <div><ClassDot c="slide" /> slide → big-type layout kept, no model</div>
                <div><ClassDot c="blank" /> blank → nothing to read, skipped</div>
                <div><ClassDot c="B" /> B figure-heavy / short → deterministic text kept</div>
                <div className="pt-1 text-gray-500">reading order not at risk → no vision spend</div>
              </div>
            </div>
            <div className="rounded-xl border-2 border-dashed border-amber-400 bg-white p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-gray-900">Vision lane</div>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">only the pages that earned it</span>
              </div>
              <div className="mt-1.5 space-y-1 text-[11px] text-gray-700">
                <div><ClassDot c="B" /> B multi-column → whole-page vision (reading order)</div>
                <div><ClassDot c="C" /> C scanned → no text layer, image is the source</div>
                <div><ClassDot c="D" /> D degraded → garbage text layer, distrust at triage</div>
              </div>
            </div>
          </div>

          {/* vision node with its internal flow */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex justify-center"><EdgeV h="h-64" label="no model calls" /></div>
            <div>
              <EdgeV h="h-4" dashed />
              <StageCard s={S("vision")} sel={sel} setSel={setSel}
                extra={
                  <div className="mt-2 space-y-1">
                    <MiniQ>routed pages &gt; 150? → excess flagged <span className="font-mono">skipped_budget_exceeded</span> + BUDGET_CAP warning → document will finish <em>partial</em></MiniQ>
                    <Mini>strict-schema read (Haiku 4.5) — blocks in reading order + figure/table regions</Mini>
                    <MiniQ>schema invalid? → retry → escalate <span className="font-medium">Sonnet 5</span> → still failing? → VISION_FAILED warning, page keeps deterministic text</MiniQ>
                    <MiniQ>recitation guard trips? → retry once with document context → still blocked? → page kept as image + CONTENT_FILTER warning</MiniQ>
                    <MiniQ>table unreadable? → <span className="font-mono">extraction_ok=false</span> → crop kept, marked <span className="font-mono">table_extraction_failed</span></MiniQ>
                    <MiniQ>self-reported confidence &lt; 0.5? → LOW_CONFIDENCE warning</MiniQ>
                    <Mini>success → page's lines replaced with vision reading order (asserted, points) · figure/table boxes stored verbatim [0,1] (dashed in the inspector)</Mini>
                  </div>
                } />
            </div>
          </div>
          <EdgeV label="lanes merge" h="h-8" />

          {/* 5 · sampler */}
          <StageCard s={S("sampler")} sel={sel} setSel={setSel}
            extra={<div className="mt-1.5 text-[11px] text-gray-500">up to 5 trusted pages re-read cheaply · word-overlap per ledger row</div>} />
          <EdgeV h="h-5" />
          <Branch q="mismatches ≥ max(2, half the sample)?" onClick={() => setSel("sampler")}
            out={[{ side: "r", label: <Terminal tone="amber">yes → document flagged distrust-text + DISTRUST_TEXT warning (a flag every consumer sees — pages are not re-run)</Terminal> }]} />
          <EdgeV label="either way" h="h-6" />

          {/* 6 · structure */}
          <StageCard s={S("structure")} sel={sel} setSel={setSel}
            extra={
              <div className="mt-2 space-y-1">
                <MiniQ>PDF outline present? → it is the prior (<span className="font-mono">source: outline</span>) · else font-statistics candidates (<span className="font-mono">detected</span> / <span className="font-mono">vision</span>)</MiniQ>
                <MiniQ>normalization call fails? → ledger says “deterministic levels used”, pipeline continues</MiniQ>
                <MiniQ>nothing found? → single “Document” section (<span className="font-mono">source: fallback</span>)</MiniQ>
                <Mini>boilerplate (recurring headers/footers) excluded from chunks, preserved · HEADING_SANITY + OUTLINE_DISAGREES surfaced as warnings</Mini>
              </div>
            } />
          <EdgeV />

          {/* 7 · chunk */}
          <StageCard s={S("chunk")} sel={sel} setSel={setSel}
            extra={
              <div className="mt-2 space-y-1">
                <MiniQ>figure or table? → atomic chunk, never split</MiniQ>
                <MiniQ>section over 1,200 tokens? → split at the nearest paragraph boundary</MiniQ>
                <Mini>breadcrumb + prev/next + block ids · embedding text = “{`{title} > {breadcrumb}`}” + text</Mini>
              </div>
            } />
          <EdgeV />

          {/* 8 · summarize */}
          <StageCard s={S("summarize")} sel={sel} setSel={setSel}
            extra={<div className="mt-1.5 text-[11px] text-gray-500">one call per substantial section + the abstract, marked generated with its evidence</div>} />
          <EdgeV />

          {/* 9 · embed */}
          <StageCard s={S("embed")} sel={sel} setSel={setSel}
            extra={<div className="mt-1.5 text-[11px] text-gray-500">768d truncated → normalized in code so cosine works · pgvector · /relations reuses these for free</div>} />
          <EdgeV />

          {/* 10 · finalize */}
          <StageCard s={S("finalize")} sel={sel} setSel={setSel}
            extra={
              <div className="mt-2 space-y-1.5">
                <MiniQ>any page <span className="font-mono">skipped_budget_exceeded</span>? → <StatusChip s="partial" /> with coverage shown · else <StatusChip s="complete" /></MiniQ>
                <MiniQ>any step threw 3×? → STEP ERROR rows on its own stage → <StatusChip s="failed" /> with the error stored</MiniQ>
              </div>
            } />
        </div>
      </section>

      {/* the detail panel */}
      <aside className="xl:sticky xl:top-6 xl:self-start">
        {!stage ? (
          <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm leading-relaxed text-gray-700">
            <div className="mb-2 text-base font-semibold text-gray-900">The board and the ledger agree, by construction</div>
            <p>Every stage on this board writes its ledger rows under the <span className="font-mono text-xs">stage</span> name printed on the node, and every stage name a ledger can contain is a node on this board. Read a row, find its box; click a box, see its rows.</p>
            <p className="mt-3">Two honest edges of that rule:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li><span className="font-medium">Ingest refusals never reach a ledger</span>, because a refused file never becomes a document. The refusal and its reason surface in the upload UI instead.</li>
              <li><span className="font-medium">There is no separate error stage.</span> A step that fails writes a STEP ERROR note on the stage it failed in; three strikes and the document lands failed. Errors live where they happened.</li>
            </ul>
            <p className="mt-3 text-gray-500">Click any stage for what runs, the decisions it takes, what can go wrong, and its measured numbers from the real 48-page NIST holdout. Diamonds are the actual branch points in the code.</p>
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
