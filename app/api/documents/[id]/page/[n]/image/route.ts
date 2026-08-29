// Page images are rendered on demand from the stored PDF — no raster store to keep in sync.
import { q } from "@/lib/db";
import { openDoc, rasterPage } from "@/lib/pdf";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(_r: Request, { params }: { params: { id: string; n: string } }) {
  const [row] = await q<{ pdf: Buffer }>(`SELECT pdf FROM documents WHERE id=$1`, [params.id]);
  if (!row) return new Response("not found", { status: 404 });
  try {
    const png = rasterPage(openDoc(row.pdf), parseInt(params.n, 10), 110);
    return new Response(png as any, { headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" } });
  } catch (e: any) {
    return new Response(`render failed: ${String(e?.message ?? e).slice(0, 120)}`, { status: 422 });
  }
}
