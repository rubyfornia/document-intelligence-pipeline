"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function Relations() {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = () => fetch("/api/relations").then(r => r.json()).then(setData);
  useEffect(() => { load(); }, []);
  async function rebuild() { setBusy(true); await fetch("/api/relations/rebuild", { method: "POST" }); await load(); setBusy(false); }
  const t = (id: string) => data?.titles?.[id] ?? id;
  return (
    <main className="mx-auto max-w-5xl p-6 sm:p-10">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-brand-700 hover:underline">← Library</Link>
          <h1 className="text-2xl font-bold text-gray-900">Cross-document relationships</h1>
          <p className="text-gray-600 text-sm">Chunk-level nearest neighbours over the embeddings the core pipeline already produced. Bands: near-duplicate ≥ 0.92 · related 0.75–0.92.</p>
        </div>
        <button onClick={rebuild} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-white disabled:opacity-50">{busy ? "Rebuilding…" : "Rebuild"}</button>
      </header>
      {data?.matrix?.length ? (
        <section className="mb-8 rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-2 text-xs font-semibold uppercase text-gray-500">Document-level similarity</div>
          <table className="w-full text-sm"><tbody>
            {data.matrix.map((m: any, i: number) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="py-1.5 pr-2 text-gray-800">{t(m.a_doc)}</td>
                <td className="py-1.5 pr-2 text-gray-400">↔</td>
                <td className="py-1.5 pr-2 text-gray-800">{t(m.b_doc)}</td>
                <td className="py-1.5 text-right font-mono">{Number(m.sim).toFixed(3)}</td>
              </tr>
            ))}
          </tbody></table>
        </section>
      ) : null}
      <div className="space-y-4">
        {(data?.relations ?? []).map((r: any) => (
          <section key={r.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-3 text-sm">
              <span className={r.kind === "near_duplicate" ? "rounded-full bg-purple-100 px-2 py-0.5 text-purple-800" : "rounded-full bg-sky-100 px-2 py-0.5 text-sky-800"}>{r.kind.replace("_", " ")}</span>
              <span className="font-mono text-gray-500">{Number(r.score).toFixed(3)}</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[["a", r.a_text, r.a_crumb, r.a_doc], ["b", r.b_text, r.b_crumb, r.b_doc]].map(([k, text, crumb, doc]: any) => (
                <div key={k} className="rounded-lg bg-gray-50 p-3">
                  <div className="text-xs text-gray-500">{t(doc)} › {(crumb ?? []).join(" › ")}</div>
                  <div className="mt-1 line-clamp-5 text-sm text-gray-700">{text}</div>
                </div>
              ))}
            </div>
            {r.why && <div className="mt-2 text-sm text-gray-600"><span className="font-medium">Why:</span> {r.why}</div>}
          </section>
        ))}
        {data && !data.relations?.length && <div className="text-gray-500">No cross-document relations above threshold. Process at least two related documents, then rebuild.</div>}
      </div>
    </main>
  );
}
