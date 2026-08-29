// The canonical representation — literally what a downstream system would be handed.
import { q } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(_r: Request, { params }: { params: { id: string } }) {
  const [d] = await q(`SELECT id, filename, content_hash, page_count, title, metadata, abstract, status, totals FROM documents WHERE id=$1`, [params.id]);
  if (!d) return Response.json({ error: "not found" }, { status: 404 });
  const sections = await q(`SELECT id, parent_id, level, title, page_start, page_end, order_index, source, summary, confidence FROM sections WHERE document_id=$1 ORDER BY order_index`, [params.id]);
  const chunks = await q(`SELECT id, section_id, content_type, order_index, breadcrumb, text, embedding_text, tokens, page_start, page_end, block_ids, element_id, prev_id, next_id, provenance FROM chunks WHERE document_id=$1 ORDER BY order_index`, [params.id]);
  const pages = await q(`SELECT n, class, reason, route, signals, flags, model, ms, cost_usd FROM pages WHERE document_id=$1 ORDER BY n`, [params.id]);
  const elements = await q(`SELECT id, page_n, type, bbox, caption, description, grid, status, source, bbox_source, section_id FROM elements WHERE document_id=$1 ORDER BY page_n`, [params.id]);
  const boilerplate = await q(`SELECT text, pages FROM boilerplate WHERE document_id=$1`, [params.id]);
  const warnings = await q(`SELECT code, page_n, message FROM warnings WHERE document_id=$1 ORDER BY id`, [params.id]);
  return Response.json({ document: d, sections, chunks, elements, pages, boilerplate, warnings });
}
