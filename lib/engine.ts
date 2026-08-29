// The step engine. POST /api/documents/:id/step advances exactly one bounded unit of work.
// State lives in Postgres; every model call becomes a run_events row — the ledger records
// what ran, not what was intended.
import { q } from "./db";
import { id } from "./ids";
import { openDoc, extractPage, rasterPage, docMeta, docOutline } from "./pdf";
import { triagePage } from "./signals";
import { detectBoilerplate, headingCandidates, isBoilerplateLine, sanityCheck, type PageLines } from "./structure";
import { buildChunks, embeddingText, estTokens } from "./chunker";
import { strictCall, embedBatch, HAIKU } from "./models";
import { PAGE_SCHEMA, NORMALIZE_SCHEMA, SUMMARY_SCHEMA } from "./schemas";

const VISION_BUDGET = 150;           // max multimodal calls per document
const SAMPLER_K = 5;                 // clean pages cross-checked per document
const EXTRACT_BATCH = 10;
const VISION_CONCURRENCY = 3;

interface Run { id: string; document_id: string; status: string; stage: string; cursor: any }

async function ev(run: Run, stage: string, fields: Partial<{ page_n: number; model: string; input_tokens: number; output_tokens: number; ms: number; cost_usd: number; note: string }>) {
  await q(
    `INSERT INTO run_events (run_id, document_id, stage, page_n, model, input_tokens, output_tokens, ms, cost_usd, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [run.id, run.document_id, stage, fields.page_n ?? null, fields.model ?? null, fields.input_tokens ?? null,
     fields.output_tokens ?? null, fields.ms ?? null, fields.cost_usd ?? null, fields.note ?? null],
  );
}
async function warn(docId: string, code: string, message: string, page_n?: number) {
  await q(`INSERT INTO warnings (document_id, code, page_n, message) VALUES ($1,$2,$3,$4)`, [docId, code, page_n ?? null, message]);
}
async function setCursor(run: Run, stage: string, cursor: any) {
  run.stage = stage; run.cursor = cursor;
  await q(`UPDATE runs SET stage=$1, cursor=$2 WHERE id=$3`, [stage, JSON.stringify(cursor), run.id]);
}

async function loadPdf(docId: string): Promise<{ buf: Buffer; doc: any }> {
  const [row] = await q<{ pdf: Buffer }>(`SELECT pdf FROM documents WHERE id=$1`, [docId]);
  const buf = row.pdf;
  return { buf, doc: openDoc(buf) };
}

const pageLines = async (docId: string, ns: number[]): Promise<PageLines[]> => {
  if (!ns.length) return [];
  const rows = await q(
    `SELECT b.page_n, b.id, b.text, b.bbox, b.font_size, b.font_name, b.is_bold, p.width, p.height
     FROM blocks b JOIN pages p ON p.document_id=b.document_id AND p.n=b.page_n
     WHERE b.document_id=$1 AND b.page_n = ANY($2) AND b.source='deterministic' ORDER BY b.page_n, b.order_index`,
    [docId, ns]);
  const by = new Map<number, PageLines>();
  for (const r of rows) {
    if (!by.has(r.page_n)) by.set(r.page_n, { n: r.page_n, width: r.width, height: r.height, lines: [] });
    by.get(r.page_n)!.lines.push({ text: r.text, bbox: r.bbox, fontName: r.font_name ?? "", fontSize: r.font_size ?? 0, bold: !!r.is_bold });
  }
  return [...by.values()];
};

/** Advance the pipeline by one bounded step. Returns progress for the client. */
export async function step(docId: string) {
  const [run] = await q<Run>(`SELECT * FROM runs WHERE document_id=$1 ORDER BY started_at DESC LIMIT 1`, [docId]);
  if (!run) throw new Error("no run");
  if (run.status !== "processing") return { stage: run.stage, done: true, status: run.status };
  const t0 = Date.now();
  try {
    switch (run.stage) {
      case "extract":   await stExtract(run); break;
      case "triage":    await stTriage(run); break;
      case "vision":    await stVision(run); break;
      case "sampler":   await stSampler(run); break;
      case "structure": await stStructure(run); break;
      case "chunk":     await stChunk(run); break;
      case "summarize": await stSummarize(run); break;
      case "embed":     await stEmbed(run); break;
      case "finalize":  await stFinalize(run); break;
      default: throw new Error(`unknown stage ${run.stage}`);
    }
  } catch (e: any) {
    await ev(run, run.stage, { note: `STEP ERROR: ${String(e?.message ?? e).slice(0, 300)}`, ms: Date.now() - t0 });
    const key = `err_${run.stage}`;
    const errs = (run.cursor[key] ?? 0) + 1;
    if (errs >= 3) {
      await q(`UPDATE runs SET status='failed', finished_at=now() WHERE id=$1`, [run.id]);
      await q(`UPDATE documents SET status='failed', error=$2 WHERE id=$1`, [run.document_id, String(e?.message ?? e).slice(0, 500)]);
      return { stage: run.stage, done: true, status: "failed", error: String(e?.message ?? e).slice(0, 200) };
    }
    await setCursor(run, run.stage, { ...run.cursor, [key]: errs });
    return { stage: run.stage, done: false, status: "processing", retried: true };
  }
  const [r2] = await q<Run>(`SELECT * FROM runs WHERE id=$1`, [run.id]);
  const [d] = await q(`SELECT status, page_count FROM documents WHERE id=$1`, [docId]);
  const doneN = (await q(`SELECT count(*)::int c FROM pages WHERE document_id=$1 AND class IS NOT NULL`, [docId]))[0].c;
  return { stage: r2.stage, done: r2.status !== "processing", status: r2.status, pagesTriaged: doneN, pageCount: d.page_count };
}

// ---- stages ----

async function stExtract(run: Run) {
  const t0 = Date.now();
  const { doc } = await loadPdf(run.document_id);
  const total = doc.countPages();
  const from = run.cursor.page ?? 1;
  if (from === 1) {
    const meta = docMeta(doc);
    await q(`UPDATE documents SET page_count=$2, metadata=$3 WHERE id=$1`,
      [run.document_id, total, JSON.stringify({ ...meta, outline_present: docOutline(doc).length > 0 })]);
  }
  const to = Math.min(from + EXTRACT_BATCH - 1, total);
  for (let n = from; n <= to; n++) {
    const p = extractPage(doc, n);
    await q(`INSERT INTO pages (document_id, n, width, height, signals) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (document_id, n) DO UPDATE SET width=$3, height=$4`,
      [run.document_id, n, p.width, p.height, "{}"]);
    if (p.error) {
      await q(`UPDATE pages SET class='D', reason=$3, route='vision' WHERE document_id=$1 AND n=$2`,
        [run.document_id, n, `extractor error: ${p.error.slice(0, 120)}`]);
      continue;
    }
    let i = 0;
    for (const l of p.lines) {
      await q(
        `INSERT INTO blocks (id, document_id, page_n, order_index, bbox, text, font_size, font_name, is_bold)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id("blk"), run.document_id, n, i++, JSON.stringify(l.bbox), l.text, l.fontSize, l.fontName, l.bold]);
    }
  }
  await ev(run, "extract", { note: `pages ${from}–${to} of ${total}`, ms: Date.now() - t0 });
  if (to >= total) await setCursor(run, "triage", {});
  else await setCursor(run, "extract", { page: to + 1 });
}

async function stTriage(run: Run) {
  const t0 = Date.now();
  const { doc } = await loadPdf(run.document_id);
  const total = doc.countPages();
  const counts: Record<string, number> = {};
  for (let n = 1; n <= total; n++) {
    const [existing] = await q(`SELECT class FROM pages WHERE document_id=$1 AND n=$2`, [run.document_id, n]);
    if (existing?.class === "D") { counts.D = (counts.D ?? 0) + 1; continue; } // extractor-error pages stay D
    const p = extractPage(doc, n);
    const t = triagePage(p);
    counts[t.class] = (counts[t.class] ?? 0) + 1;
    const flags = t.reason.includes("distrust-text") ? ["distrust-text"] : [];
    await q(`UPDATE pages SET class=$3, reason=$4, route=$5, signals=$6, flags=$7 WHERE document_id=$1 AND n=$2`,
      [run.document_id, n, t.class, t.reason, t.route, JSON.stringify(t.signals), flags]);
  }
  const scanShare = ((counts.C ?? 0) + (counts.D ?? 0)) / Math.max(total, 1);
  if (scanShare > 0.4) await warn(run.document_id, "SCAN_HEAVY", `${Math.round(scanShare * 100)}% of pages are scanned/degraded; structure fidelity is OCR-limited`);
  await ev(run, "triage", { note: `classes ${JSON.stringify(counts)}`, ms: Date.now() - t0 });
  await setCursor(run, "vision", { queue: null, done: 0 });
}

const visionSystem =
  "You extract the structure of one document page from its image. Return every block of text in true reading order with its role, plus figures and tables with their regions. Bounding boxes are fractions of page width/height in [0,1] with origin top-left. For tables, set extraction_ok=false rather than inventing cells you cannot read. Report confidence honestly; note anything illegible.";

async function stVision(run: Run) {
  if (run.cursor.queue == null) {
    const rows = await q(`SELECT n FROM pages WHERE document_id=$1 AND route='vision' ORDER BY n`, [run.document_id]);
    const queue = rows.map(r => r.n);
    if (queue.length > VISION_BUDGET) {
      const skipped = queue.slice(VISION_BUDGET);
      for (const n of skipped)
        await q(`UPDATE pages SET flags = array_append(flags,'skipped_budget_exceeded') WHERE document_id=$1 AND n=$2`, [run.document_id, n]);
      await warn(run.document_id, "BUDGET_CAP", `vision budget: processed ${VISION_BUDGET} of ${queue.length} routed pages; remainder deterministic-only`);
    }
    await setCursor(run, "vision", { queue: queue.slice(0, VISION_BUDGET), done: 0 });
    return;
  }
  const queue: number[] = run.cursor.queue;
  const done: number = run.cursor.done ?? 0;
  if (done >= queue.length) { await setCursor(run, "sampler", {}); return; }
  const batch = queue.slice(done, done + VISION_CONCURRENCY);
  const { doc } = await loadPdf(run.document_id);
  await Promise.all(batch.map(async n => {
    const t0 = Date.now();
    const png = rasterPage(doc, n);
    const hint = (await pageLines(run.document_id, [n]))[0]?.lines.map(l => l.text).join("\n").slice(0, 2000) ?? "";
    const r = await strictCall<any>({
      system: visionSystem,
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } },
        { type: "text", text: hint ? `Partial text layer as a hint (may be wrong):\n${hint}` : "No usable text layer." },
      ],
      schema: PAGE_SCHEMA,
    });
    await ev(run, "vision", { page_n: n, model: r.model || HAIKU, input_tokens: r.inputTokens, output_tokens: r.outputTokens, ms: Date.now() - t0, cost_usd: r.costUsd, note: r.ok ? (r.escalated ? "escalated" : undefined) : `FAILED: ${r.error?.slice(0, 120)}` });
    if (!r.ok) {
      await q(`UPDATE pages SET flags=array_append(flags,'vision_failed'), model=$3, ms=ms+$4, cost_usd=cost_usd+$5 WHERE document_id=$1 AND n=$2`,
        [run.document_id, n, r.model, r.ms, r.costUsd]);
      await warn(run.document_id, "VISION_FAILED", `page ${n}: model output failed validation after retry+escalation`, n);
      return;
    }
    const [{ width, height }] = await q(`SELECT width, height FROM pages WHERE document_id=$1 AND n=$2`, [run.document_id, n]);
    // replace any deterministic lines for this page with vision reading order
    await q(`DELETE FROM blocks WHERE document_id=$1 AND page_n=$2`, [run.document_id, n]);
    let i = 0;
    for (const b of r.data.blocks ?? []) {
      const bbox = { x: b.bbox.x * (width || 1), y: b.bbox.y * (height || 1), w: b.bbox.w * (width || 1), h: b.bbox.h * (height || 1) };
      await q(`INSERT INTO blocks (id, document_id, page_n, order_index, bbox, text, role, heading_level, source, bbox_source)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'vision','asserted')`,
        [id("blk"), run.document_id, n, i++, JSON.stringify(bbox), b.text, b.role, b.role === "heading" ? b.heading_level : null]);
    }
    for (const f of r.data.figures ?? [])
      await q(`INSERT INTO elements (id, document_id, page_n, type, bbox, caption, description) VALUES ($1,$2,$3,'figure',$4,$5,$6)`,
        [id("fig"), run.document_id, n, JSON.stringify(f.bbox), f.caption, f.description]);
    for (const t of r.data.tables ?? [])
      await q(`INSERT INTO elements (id, document_id, page_n, type, bbox, caption, grid, status) VALUES ($1,$2,$3,'table',$4,$5,$6,$7)`,
        [id("tbl"), run.document_id, n, JSON.stringify(t.bbox), t.caption,
         JSON.stringify({ columns: t.columns, rows: t.rows }), t.extraction_ok ? "ok" : "table_extraction_failed"]);
    if ((r.data.confidence ?? 1) < 0.5)
      await warn(run.document_id, "LOW_CONFIDENCE", `page ${n}: model self-reported ${r.data.confidence} — ${String(r.data.notes).slice(0, 140)}`, n);
    await q(`UPDATE pages SET model=$3, ms=ms+$4, cost_usd=cost_usd+$5 WHERE document_id=$1 AND n=$2`,
      [run.document_id, n, r.model, r.ms, r.costUsd]);
  }));
  await setCursor(run, "vision", { queue, done: done + batch.length });
}

async function stSampler(run: Run) {
  const t0 = Date.now();
  const clean = await q(`SELECT n FROM pages WHERE document_id=$1 AND class IN ('A','B') AND route='deterministic' ORDER BY n`, [run.document_id]);
  if (clean.length === 0) { await setCursor(run, "structure", {}); return; }
  // deterministic "random": hash-spread over the doc id so runs are reproducible
  const pick = clean.map(r => r.n).filter((_, i) => i % Math.max(1, Math.floor(clean.length / SAMPLER_K)) === 0).slice(0, SAMPLER_K);
  const { doc } = await loadPdf(run.document_id);
  let mismatches = 0;
  for (const n of pick) {
    const png = rasterPage(doc, n, 110);
    const r = await strictCall<any>({
      system: "Transcribe the text of this page in reading order. Only the blocks array matters; use role 'body' throughout if unsure.",
      content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } }],
      schema: PAGE_SCHEMA, escalate: false, maxTokens: 4096,
    });
    const detText = (await pageLines(run.document_id, [n]))[0]?.lines.map(l => l.text).join(" ") ?? "";
    if (r.ok) {
      const visText = (r.data.blocks ?? []).map((b: any) => b.text).join(" ");
      const j = jaccard(words(detText), words(visText));
      await ev(run, "sampler", { page_n: n, model: r.model, input_tokens: r.inputTokens, output_tokens: r.outputTokens, ms: r.ms, cost_usd: r.costUsd, note: `overlap ${j.toFixed(2)}` });
      if (j < 0.55) mismatches++;
    } else {
      await ev(run, "sampler", { page_n: n, note: `sampler call failed: ${r.error?.slice(0, 80)}`, ms: r.ms, cost_usd: r.costUsd });
    }
  }
  if (mismatches >= Math.max(2, Math.ceil(pick.length / 2))) {
    await q(`UPDATE documents SET totals = totals || '{"distrust_text":true}'::jsonb WHERE id=$1`, [run.document_id]);
    await warn(run.document_id, "DISTRUST_TEXT", `cross-check sampler: ${mismatches}/${pick.length} clean-looking pages disagree with a vision read — text layer distrusted (plausible-garbage suspected)`);
  }
  await ev(run, "sampler", { note: `${pick.length} pages sampled, ${mismatches} mismatched`, ms: Date.now() - t0 });
  await setCursor(run, "structure", {});
}
const words = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter(w => w.length > 2));
const jaccard = (a: Set<string>, b: Set<string>) => { if (!a.size && !b.size) return 1; let i = 0; for (const w of a) if (b.has(w)) i++; return i / (a.size + b.size - i || 1); };

async function stStructure(run: Run) {
  const t0 = Date.now();
  const docId = run.document_id;
  const all = await q(`SELECT n FROM pages WHERE document_id=$1 ORDER BY n`, [docId]);
  const pls = await pageLines(docId, all.map(r => r.n));
  const bp = detectBoilerplate(pls);
  for (const [, v] of bp)
    await q(`INSERT INTO boilerplate (id, document_id, text, pages) VALUES ($1,$2,$3,$4)`, [id("bp"), docId, v.text, v.pages]);
  // mark boilerplate blocks
  for (const p of pls)
    for (const l of p.lines)
      if (isBoilerplateLine(l, p, bp))
        await q(`UPDATE blocks SET boilerplate=true WHERE document_id=$1 AND page_n=$2 AND text=$3`, [docId, p.n, l.text]);

  // candidates: deterministic pages via font logic; vision pages contribute their labeled headings
  const cands = headingCandidates(pls, bp).map(c => ({ ...c, src: "detected" as const }));
  const vh = await q(`SELECT page_n, order_index, text, heading_level FROM blocks WHERE document_id=$1 AND source='vision' AND role IN ('heading','title') ORDER BY page_n, order_index`, [docId]);
  for (const v of vh) cands.push({ page: v.page_n, lineIdx: v.order_index, text: v.text, size: 0, bold: false, numbered: false, level: v.heading_level ?? 2, confidence: 0.6, src: "vision" as any });
  cands.sort((a, b) => a.page - b.page || a.lineIdx - b.lineIdx);
  for (const w of sanityCheck(cands as any)) await warn(docId, "HEADING_SANITY", w);

  // outline prior
  const { doc } = await loadPdf(docId);
  const outline = docOutline(doc);
  let sections: { title: string; level: number; page: number; source: string; confidence: number; lineIdx?: number }[];
  if (outline.length >= 2) {
    sections = outline.map(o => ({ title: o.title, level: Math.min(o.level, 4), page: o.page, source: "outline", confidence: 0.95 }));
    if (cands.length && Math.abs(cands.length - outline.length) / Math.max(outline.length, 1) > 0.5)
      await warn(docId, "OUTLINE_DISAGREES", `PDF outline has ${outline.length} entries but ${cands.length} headings were detected; outline used as prior`);
  } else if (cands.length) {
    // one normalization call over the candidate list (cheap; document-level decision)
    const list = cands.slice(0, 250).map((c, i) => ({ index: i, text: c.text.slice(0, 90), size: Math.round(c.size), bold: c.bold, page: c.page }));
    const r = await strictCall<{ headings: { index: number; keep: boolean; level: number }[] }>({
      system: "These are candidate section headings extracted from one document, in order. Decide which are real section headings (keep) and assign a consistent hierarchy level 1-4. Drop pull-quotes, captions, running heads, and body fragments.",
      content: [{ type: "text", text: JSON.stringify(list) }],
      schema: NORMALIZE_SCHEMA, escalate: false, maxTokens: 6000,
    });
    await ev(run, "structure", { model: r.model, input_tokens: r.inputTokens, output_tokens: r.outputTokens, ms: r.ms, cost_usd: r.costUsd, note: r.ok ? "normalization" : `normalize failed: ${r.error?.slice(0, 80)} — deterministic levels used` });
    if (r.ok) {
      const keep = new Map((r.data?.headings ?? []).map(h => [h.index, h]));
      sections = cands.map((c, i) => ({ ...c, kept: keep.get(i)?.keep ?? true, level: keep.get(i)?.level ?? c.level }))
        .filter((c: any) => c.kept)
        .map(c => ({ title: c.text, level: c.level, page: c.page, source: (c as any).src ?? "detected", confidence: c.confidence, lineIdx: c.lineIdx }));
    } else {
      sections = cands.map(c => ({ title: c.text, level: c.level, page: c.page, source: (c as any).src, confidence: c.confidence, lineIdx: c.lineIdx }));
    }
  } else sections = [];
  if (!sections.length) sections = [{ title: "Document", level: 1, page: 1, source: "fallback", confidence: 0.3 }];

  // build tree rows with page ranges
  const total = (await q(`SELECT page_count c FROM documents WHERE id=$1`, [docId]))[0].c;
  const stack: { id: string; level: number }[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const next = sections[i + 1];
    const sid = id("sec");
    while (stack.length && stack[stack.length - 1].level >= s.level) stack.pop();
    await q(`INSERT INTO sections (id, document_id, parent_id, level, title, page_start, page_end, order_index, source, confidence)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [sid, docId, stack[stack.length - 1]?.id ?? null, s.level, s.title.slice(0, 200), s.page, (next?.page ?? total) , i, s.source, s.confidence]);
    stack.push({ id: sid, level: s.level });
  }
  // slide-deck pages become their own sections if no structure found for them
  // title reconciliation
  const [d] = await q(`SELECT metadata FROM documents WHERE id=$1`, [docId]);
  const metaTitle = (d.metadata?.title ?? "").trim();
  let title = metaTitle, source = "metadata";
  if (!metaTitle || /^(untitled|anonymous|\(anonymous\)|microsoft word)/i.test(metaTitle)) {
    const p1 = pls.find(p => p.n === 1);
    const big = p1?.lines.slice().sort((a, b) => b.fontSize - a.fontSize)[0];
    title = big?.text?.slice(0, 160) || (await q(`SELECT filename f FROM documents WHERE id=$1`, [docId]))[0].f;
    source = big ? "heading" : "filename";
  }
  await q(`UPDATE documents SET title=$2 WHERE id=$1`, [docId, JSON.stringify({ value: title, source })]);
  // assign blocks to sections (by page + order)
  const secRows = await q(`SELECT id, page_start, page_end, order_index FROM sections WHERE document_id=$1 ORDER BY order_index`, [docId]);
  for (const s of secRows)
    await q(`UPDATE blocks SET section_id=$2 WHERE document_id=$1 AND page_n BETWEEN $3 AND $4 AND section_id IS NULL AND NOT boilerplate`,
      [docId, s.id, s.page_start, s.page_end]);
  await ev(run, "structure", { note: `${secRows.length} sections (${sections[0]?.source})`, ms: Date.now() - t0 });
  await setCursor(run, "chunk", {});
}

async function stChunk(run: Run) {
  const t0 = Date.now();
  const docId = run.document_id;
  const [{ title }] = await q(`SELECT title FROM documents WHERE id=$1`, [docId]);
  const docTitle = title?.value ?? "";
  const secs = await q(`SELECT * FROM sections WHERE document_id=$1 ORDER BY order_index`, [docId]);
  const children = new Map<string, number>();
  for (const s of secs) if (s.parent_id) children.set(s.parent_id, (children.get(s.parent_id) ?? 0) + 1);
  const byId = new Map(secs.map(s => [s.id, s]));
  const crumb = (s: any): string[] => { const out = [s.title]; let p = s.parent_id; while (p) { const ps = byId.get(p); if (!ps) break; out.unshift(ps.title); p = ps.parent_id; } return out; };
  let order = 0; let prevId: string | null = null;
  for (const s of secs) {
    if (children.get(s.id)) continue; // leaf sections only
    const blocks = await q(
      `SELECT id, text, page_n FROM blocks WHERE document_id=$1 AND section_id=$2 AND NOT boilerplate AND role NOT IN ('header','footer','page-number') ORDER BY page_n, order_index`,
      [docId, s.id]);
    const built = buildChunks({ sectionId: s.id, breadcrumb: crumb(s), blocks: blocks.map(b => ({ id: b.id, text: b.text, page: b.page_n })) });
    for (const c of built) {
      const cid = id("chk");
      await q(`INSERT INTO chunks (id, document_id, section_id, content_type, order_index, breadcrumb, text, embedding_text, tokens, page_start, page_end, block_ids, prev_id, provenance)
               VALUES ($1,$2,$3,'text',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [cid, docId, s.id, order++, c.breadcrumb, c.text, embeddingText(docTitle, c.breadcrumb, c.text), c.tokens, c.pageStart, c.pageEnd, c.blockIds, prevId,
         JSON.stringify({ extractor: "deterministic+vision", bbox_source: "mixed" })]);
      if (prevId) await q(`UPDATE chunks SET next_id=$2 WHERE id=$1`, [prevId, cid]);
      prevId = cid;
    }
  }
  // figure/table chunks — atomic
  const els = await q(`SELECT * FROM elements WHERE document_id=$1 ORDER BY page_n`, [docId]);
  for (const e of els) {
    const [sec] = await q(`SELECT id, title FROM sections WHERE document_id=$1 AND page_start<=$2 AND page_end>=$2 ORDER BY level DESC LIMIT 1`, [docId, e.page_n]);
    const text = [e.caption, e.description, e.grid ? `columns: ${(e.grid.columns ?? []).join(", ")}` : ""].filter(Boolean).join("\n");
    const cid = id("chk");
    await q(`INSERT INTO chunks (id, document_id, section_id, content_type, order_index, breadcrumb, text, embedding_text, tokens, page_start, page_end, element_id, provenance)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12)`,
      [cid, docId, sec?.id ?? null, e.type === "table" ? "table" : "figure", order++, sec ? [sec.title] : [], text,
       embeddingText(docTitle, sec ? [sec.title] : [], text), estTokens(text), e.page_n, e.id,
       JSON.stringify({ extractor: "vision", bbox_source: e.bbox_source, status: e.status })]);
    await q(`UPDATE elements SET section_id=$2 WHERE id=$1`, [e.id, sec?.id ?? null]);
  }
  await ev(run, "chunk", { note: `${order} chunks`, ms: Date.now() - t0 });
  await setCursor(run, "summarize", { done: 0 });
}

async function stSummarize(run: Run) {
  const docId = run.document_id;
  const secs = await q(`SELECT id, title FROM sections WHERE document_id=$1 AND summary IS NULL ORDER BY order_index LIMIT 4`, [docId]);
  if (!secs.length) {
    // document abstract from section summaries
    const sums = await q(`SELECT title, summary FROM sections WHERE document_id=$1 AND summary IS NOT NULL ORDER BY order_index LIMIT 40`, [docId]);
    if (sums.length) {
      const r = await strictCall<{ summary: string }>({
        system: "Write a 3-5 sentence abstract of the whole document from its section summaries. Factual register; no marketing.",
        content: [{ type: "text", text: sums.map(s => `${s.title}: ${s.summary}`).join("\n") }],
        schema: SUMMARY_SCHEMA, escalate: false, maxTokens: 1024,
      });
      await ev(run, "summarize", { model: r.model, input_tokens: r.inputTokens, output_tokens: r.outputTokens, ms: r.ms, cost_usd: r.costUsd, note: "document abstract" });
      if (r.ok && r.data) await q(`UPDATE documents SET abstract=$2 WHERE id=$1`, [docId, JSON.stringify({ value: r.data.summary, extractor: "generated", evidence: sums.slice(0, 8).map(s => s.title) })]);
    }
    await setCursor(run, "embed", { done: 0 });
    return;
  }
  await Promise.all(secs.map(async s => {
    const chunkRows = await q(`SELECT text FROM chunks WHERE document_id=$1 AND section_id=$2 AND content_type='text' ORDER BY order_index LIMIT 6`, [docId, s.id]);
    const body = chunkRows.map(c => c.text).join("\n\n").slice(0, 9000);
    if (!body.trim()) { await q(`UPDATE sections SET summary='' WHERE id=$1`, [s.id]); return; }
    const r = await strictCall<{ summary: string }>({
      system: "Summarize this document section in 1-2 sentences. Factual, specific, no filler.",
      content: [{ type: "text", text: `Section: ${s.title}\n\n${body}` }],
      schema: SUMMARY_SCHEMA, escalate: false, maxTokens: 512,
    });
    await ev(run, "summarize", { model: r.model, input_tokens: r.inputTokens, output_tokens: r.outputTokens, ms: r.ms, cost_usd: r.costUsd, note: s.title.slice(0, 60) });
    await q(`UPDATE sections SET summary=$2 WHERE id=$1`, [s.id, r.ok && r.data ? r.data.summary : ""]);
  }));
}

async function stEmbed(run: Run) {
  const docId = run.document_id;
  const rows = await q(`SELECT id, embedding_text FROM chunks WHERE document_id=$1 AND embedding IS NULL ORDER BY order_index LIMIT 48`, [docId]);
  if (!rows.length) { await setCursor(run, "finalize", {}); return; }
  const t0 = Date.now();
  const vecs = await embedBatch(rows.map(r => r.embedding_text || " "));
  for (let i = 0; i < rows.length; i++)
    await q(`UPDATE chunks SET embedding=$2::vector Where id=$1`, [rows[i].id, `[${vecs[i].join(",")}]`]);
  await ev(run, "embed", { note: `${rows.length} chunks embedded`, ms: Date.now() - t0, model: "gemini-embedding-001" });
}

async function stFinalize(run: Run) {
  const docId = run.document_id;
  const [agg] = await q(
    `SELECT count(*) FILTER (WHERE model IS NOT NULL)::int AS model_calls,
            coalesce(sum(cost_usd),0)::float AS cost, coalesce(sum(ms),0)::int AS ms
     FROM run_events WHERE document_id=$1`, [docId]);
  const classes = await q(`SELECT class, count(*)::int c FROM pages WHERE document_id=$1 GROUP BY class`, [docId]);
  const capped = (await q(`SELECT count(*)::int c FROM pages WHERE document_id=$1 AND 'skipped_budget_exceeded' = ANY(flags)`, [docId]))[0].c;
  const status = capped > 0 ? "partial" : "complete";
  await q(`UPDATE documents SET status=$2, totals=$3 WHERE id=$1`,
    [docId, status, JSON.stringify({
      model_calls: agg.model_calls, cost_usd: Math.round(agg.cost * 10000) / 10000, duration_ms: agg.ms,
      page_class_counts: Object.fromEntries(classes.map(c => [c.class ?? "?", c.c])),
    })]);
  await q(`UPDATE runs SET status=$2, finished_at=now() WHERE id=$1`, [run.id, status]);
  await ev(run, "finalize", { note: status });
}
