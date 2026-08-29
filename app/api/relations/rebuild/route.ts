// Bonus: cross-document relationships from the embeddings that already exist.
// Bands: near-duplicate ≥ 0.92, related 0.75–0.92 (calibrated against the planted seeds).
import { q } from "@/lib/db";
import { id } from "@/lib/ids";
import { strictCall } from "@/lib/models";
import { WHY_RELATED_SCHEMA } from "@/lib/schemas";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  await q(`DELETE FROM relations`);
  // chunk-level cross-document nearest neighbours (cosine; embeddings are L2-normalized)
  const pairs = await q(`
    SELECT a.id a_chunk, b.id b_chunk, a.document_id a_doc, b.document_id b_doc,
           1 - (a.embedding <=> b.embedding) AS sim,
           a.text a_text, b.text b_text
    FROM chunks a
    JOIN LATERAL (
      SELECT id, document_id, text, embedding FROM chunks b
      WHERE b.document_id <> a.document_id AND b.embedding IS NOT NULL AND b.content_type='text'
      ORDER BY a.embedding <=> b.embedding LIMIT 1
    ) b ON true
    WHERE a.embedding IS NOT NULL AND a.content_type='text'
      AND 1 - (a.embedding <=> b.embedding) >= 0.75
    ORDER BY sim DESC LIMIT 60`);
  const seen = new Set<string>();
  let kept = 0;
  for (const p of pairs) {
    const key = [p.a_chunk, p.b_chunk].sort().join("|");
    if (seen.has(key)) continue; seen.add(key);
    const kind = p.sim >= 0.92 ? "near_duplicate" : "related";
    let why: string | null = null;
    if (kept < 12) {
      const r = await strictCall<{ why: string }>({
        system: "Two passages from different documents scored as semantically related. In one sentence, say what they share and what distinguishes them. If they are unrelated, say so plainly.",
        content: [{ type: "text", text: `A: ${p.a_text.slice(0, 1200)}\n\nB: ${p.b_text.slice(0, 1200)}` }],
        schema: WHY_RELATED_SCHEMA, escalate: false, maxTokens: 300,
      });
      why = r.ok && r.data ? r.data.why : null;
    }
    await q(`INSERT INTO relations (id, kind, a_doc, b_doc, a_chunk, b_chunk, score, why) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id("rel"), kind, p.a_doc, p.b_doc, p.a_chunk, p.b_chunk, Math.round(p.sim * 1000) / 1000, why]);
    kept++;
  }
  // document-level similarity matrix from mean chunk embeddings
  const docsim = await q(`
    WITH dv AS (SELECT document_id, avg(embedding) AS v FROM chunks WHERE embedding IS NOT NULL GROUP BY document_id)
    SELECT a.document_id a_doc, b.document_id b_doc, 1 - (a.v <=> b.v) AS sim
    FROM dv a JOIN dv b ON a.document_id < b.document_id ORDER BY sim DESC`);
  return Response.json({ relations: kept, matrix: docsim.map(d => ({ ...d, sim: Math.round(d.sim * 1000) / 1000 })) });
}
