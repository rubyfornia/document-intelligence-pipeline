import { q } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  const docs = await q(`SELECT id, filename, title, status, seed, locked, page_count, byte_size, totals, created_at FROM documents ORDER BY created_at DESC`);
  const pages = await q(`SELECT document_id, n, class FROM pages ORDER BY document_id, n`);
  const byDoc: Record<string, { n: number; class: string }[]> = {};
  for (const p of pages) (byDoc[p.document_id] ??= []).push({ n: p.n, class: p.class });
  return Response.json({ documents: docs.map(d => ({ ...d, pdf: undefined, classes: byDoc[d.id] ?? [] })) });
}
