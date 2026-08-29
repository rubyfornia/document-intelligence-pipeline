import { q } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  const relations = await q(`
    SELECT r.*, ca.breadcrumb a_crumb, cb.breadcrumb b_crumb, ca.text a_text, cb.text b_text,
           da.title->>'value' a_title, db.title->>'value' b_title
    FROM relations r
    JOIN chunks ca ON ca.id=r.a_chunk JOIN chunks cb ON cb.id=r.b_chunk
    JOIN documents da ON da.id=r.a_doc JOIN documents db ON db.id=r.b_doc
    ORDER BY r.score DESC`);
  const docsim = await q(`
    WITH dv AS (SELECT document_id, avg(embedding) AS v FROM chunks WHERE embedding IS NOT NULL GROUP BY document_id)
    SELECT a.document_id a_doc, b.document_id b_doc, 1 - (a.v <=> b.v) AS sim
    FROM dv a JOIN dv b ON a.document_id < b.document_id ORDER BY sim DESC`);
  const titles = await q(`SELECT id, title->>'value' t FROM documents`);
  return Response.json({ relations, matrix: docsim, titles: Object.fromEntries(titles.map(x => [x.id, x.t])) });
}
