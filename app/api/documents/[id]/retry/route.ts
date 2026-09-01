import { q } from "@/lib/db";
export const dynamic = "force-dynamic";

// Resume a failed run from the stage it died in. The step function keeps all state in Postgres,
// so a failure — an exhausted quota, a provider outage — costs the failed step, not the document.
export async function POST(_: Request, { params }: { params: { id: string } }) {
  const [doc] = await q(`SELECT id, status FROM documents WHERE id=$1`, [params.id]);
  if (!doc) return Response.json({ error: "no such document" }, { status: 404 });
  if (doc.status !== "failed")
    return Response.json({ error: `only failed documents can be retried (status: ${doc.status})` }, { status: 409 });
  const [run] = await q(`SELECT id, stage, cursor FROM runs WHERE document_id=$1 ORDER BY started_at DESC LIMIT 1`, [params.id]);
  if (!run) return Response.json({ error: "no run to resume" }, { status: 404 });
  const cursor: Record<string, any> = { ...(run.cursor ?? {}) };
  for (const k of Object.keys(cursor)) if (k.startsWith("err_") || k === "transient" || k === "retry_at") delete cursor[k];
  await q(`UPDATE runs SET status='processing', finished_at=NULL, cursor=$2 WHERE id=$1`, [run.id, JSON.stringify(cursor)]);
  await q(`UPDATE documents SET status='processing', error=NULL WHERE id=$1`, [params.id]);
  return Response.json({ resumed: params.id, stage: run.stage });
}
