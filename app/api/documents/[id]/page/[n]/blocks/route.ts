import { q } from "@/lib/db";
export const dynamic = "force-dynamic";

// per-page text blocks with their provenance grade: measured (content stream) vs asserted (vision)
export async function GET(_: Request, { params }: { params: { id: string; n: string } }) {
  const n = parseInt(params.n, 10);
  if (!Number.isFinite(n)) return Response.json({ error: "bad page" }, { status: 400 });
  const [page] = await q(`SELECT width, height FROM pages WHERE document_id=$1 AND n=$2`, [params.id, n]);
  if (!page) return Response.json({ error: "no such page" }, { status: 404 });
  const blocks = await q(
    `SELECT id, bbox, bbox_source, role, source FROM blocks WHERE document_id=$1 AND page_n=$2 ORDER BY order_index`,
    [params.id, n]);
  return Response.json({ width: page.width, height: page.height, blocks });
}
