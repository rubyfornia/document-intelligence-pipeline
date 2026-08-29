import { step } from "@/lib/engine";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try { return Response.json(await step(params.id)); }
  catch (e: any) { return Response.json({ error: String(e?.message ?? e).slice(0, 300) }, { status: 500 }); }
}
