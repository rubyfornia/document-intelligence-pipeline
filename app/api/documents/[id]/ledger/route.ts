import { q } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(_r: Request, { params }: { params: { id: string } }) {
  const events = await q(`SELECT * FROM run_events WHERE document_id=$1 ORDER BY id`, [params.id]);
  return Response.json({ events });
}
