import { q } from "@/lib/db";
export const dynamic = "force-dynamic";

// Delete a practice upload. The shipped demo corpus is protected: seed documents are the
// calibration ground truth for /relations, and the NIST holdout's measured numbers are cited in
// the README — re-uploading it would reprocess under a newer prompt and produce different numbers.
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const [doc] = await q(`SELECT id, seed, locked FROM documents WHERE id=$1`, [params.id]);
  if (!doc) return Response.json({ error: "no such document" }, { status: 404 });
  if (doc.seed || doc.locked)
    return Response.json({ error: "protected: this document is part of the shipped demo corpus (relationship calibration / cited measurements)" }, { status: 403 });
  // run_events and relations carry no FK cascade — clean them explicitly, then the document
  await q(`DELETE FROM run_events WHERE document_id=$1`, [params.id]);
  await q(`DELETE FROM relations WHERE a_doc=$1 OR b_doc=$1`, [params.id]);
  await q(`DELETE FROM documents WHERE id=$1`, [params.id]);
  return Response.json({ deleted: params.id });
}
