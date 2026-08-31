import { q } from "@/lib/db";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// per-page text blocks with their provenance grade: measured (content stream) vs asserted (vision).
// When a page has no measured blocks stored (vision replaced them), the text layer — if one exists —
// is extracted live from the PDF and returned as measured reference lines, so the inspector can show
// asserted geometry next to measured truth instead of pretending the assertion is precise.
export async function GET(_: Request, { params }: { params: { id: string; n: string } }) {
  const n = parseInt(params.n, 10);
  if (!Number.isFinite(n)) return Response.json({ error: "bad page" }, { status: 400 });
  const [page] = await q(`SELECT width, height FROM pages WHERE document_id=$1 AND n=$2`, [params.id, n]);
  if (!page) return Response.json({ error: "no such page" }, { status: 404 });
  const blocks = await q(
    `SELECT id, bbox, bbox_source, role, source FROM blocks WHERE document_id=$1 AND page_n=$2 ORDER BY order_index`,
    [params.id, n]);
  let reference: { bbox: { x: number; y: number; w: number; h: number } }[] = [];
  if (!blocks.some((b: any) => b.bbox_source === "measured")) {
    try {
      const [doc] = await q<{ pdf: Buffer }>(`SELECT pdf FROM documents WHERE id=$1`, [params.id]);
      if (doc) {
        const { openDoc, extractPage } = await import("@/lib/pdf");
        const p = extractPage(openDoc(doc.pdf), n);
        reference = p.lines.map(l => ({ bbox: l.bbox }));
        // a scan has no text lines, but the scan image's extent IS measured from the content
        // stream — show it as an anchor only when it is smaller than the page (a full-bleed
        // raster's extent is just the page edge and anchors nothing)
        if (!reference.length && p.width && p.height)
          reference = p.imageBoxes
            .filter(b => (b.w * b.h) / (p.width * p.height) < 0.95)
            .map(bbox => ({ bbox }));
      }
    } catch {} // no text layer, or unreadable — reference stays empty, honestly
  }
  return Response.json({ width: page.width, height: page.height, blocks, reference });
}
