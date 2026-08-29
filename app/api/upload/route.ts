import { createHash } from "node:crypto";
import { q } from "@/lib/db";
import { id } from "@/lib/ids";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 50 * 1024 * 1024, MAX_PAGES = 300;

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return Response.json({ error: "no file" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: `file exceeds ${MAX_BYTES / 1e6}MB cap` }, { status: 413 });
  const buf = Buffer.from(await file.arrayBuffer());
  const hash = createHash("sha256").update(buf).digest("hex");
  const [dup] = await q(`SELECT id, status FROM documents WHERE content_hash=$1`, [hash]);
  if (dup) return Response.json({ id: dup.id, cached: true, status: dup.status });

  // fast-fail: unprocessable files are refused at the door with the real reason
  let pageCount = 0;
  try {
    const { openDoc } = await import("@/lib/pdf");
    const doc = openDoc(buf);
    if ((doc as any).needsPassword?.()) return Response.json({ error: "password-protected PDF — cannot process" }, { status: 422 });
    pageCount = doc.countPages();
    if (pageCount === 0) throw new Error("zero pages");
    if (pageCount > MAX_PAGES) return Response.json({ error: `PDF has ${pageCount} pages; cap is ${MAX_PAGES}` }, { status: 413 });
  } catch (e: any) {
    return Response.json({ error: `unprocessable PDF: ${String(e?.message ?? e).slice(0, 160)}` }, { status: 422 });
  }
  const docId = id("doc");
  await q(`INSERT INTO documents (id, filename, content_hash, byte_size, pdf, page_count, status, seed)
           VALUES ($1,$2,$3,$4,$5,$6,'processing',$7)`,
    [docId, file.name, hash, buf.length, buf, pageCount, form.get("seed") === "1"]);
  await q(`INSERT INTO runs (id, document_id) VALUES ($1,$2)`, [id("run"), docId]);
  return Response.json({ id: docId, pageCount });
}
