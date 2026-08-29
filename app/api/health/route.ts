import { q } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  const [r] = await q(`SELECT count(*)::int docs FROM documents`);
  return Response.json({ ok: true, documents: r.docs });
}
