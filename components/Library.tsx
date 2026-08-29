"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ClassStrip, StatusChip, money, secs } from "./ui";

interface Doc { id: string; filename: string; title: any; status: string; seed: boolean; page_count: number; totals: any; classes: { n: number; class: string }[] }

export default function Library() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const stepping = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const r = await fetch("/api/documents"); const j = await r.json();
    setDocs(j.documents);
    return j.documents as Doc[];
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // drive processing: for any processing doc, keep POSTing /step (the pipeline is a step function)
  useEffect(() => {
    const t = setInterval(async () => {
      const current = await refresh();
      for (const d of current.filter(d => d.status === "processing")) {
        if (stepping.current.has(d.id)) continue;
        stepping.current.add(d.id);
        fetch(`/api/documents/${d.id}/step`, { method: "POST" })
          .catch(() => {})
          .finally(() => stepping.current.delete(d.id));
      }
    }, 1200);
    return () => clearInterval(t);
  }, [refresh]);

  async function upload(file: File) {
    setErr(null); setBusy(file.name);
    const fd = new FormData(); fd.append("file", file);
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) setErr(j.error ?? "upload failed");
    setBusy(null); refresh();
  }

  return (
    <div className="space-y-6">
      <label className="block cursor-pointer rounded-xl border-2 border-dashed border-gray-300 bg-white p-8 text-center hover:border-brand-400">
        <input type="file" accept="application/pdf" className="hidden"
               onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
        <div className="text-gray-700 font-medium">{busy ? `Uploading ${busy}…` : "Drop or choose a PDF to run the pipeline"}</div>
        <div className="mt-1 text-sm text-gray-500">50 MB / 300 pages max. Corrupt or password-protected files are refused at the door, with the reason.</div>
      </label>
      {err && <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">{err}</div>}
      <div className="grid gap-4">
        {docs.map(d => (
          <Link key={d.id} href={`/doc/${d.id}`} className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate font-semibold text-gray-900">{d.title?.value ?? d.filename}</div>
                <div className="text-sm text-gray-500">{d.filename} · {d.page_count ?? "?"} pages{d.seed ? " · seed" : ""}</div>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-600">
                <span>{d.totals?.model_calls != null ? `${d.totals.model_calls} calls` : ""}</span>
                <span>{d.totals?.cost_usd != null ? money(d.totals.cost_usd) : ""}</span>
                <span>{d.totals?.duration_ms != null ? secs(d.totals.duration_ms) : ""}</span>
                <StatusChip s={d.status} />
              </div>
            </div>
            <div className="mt-3"><ClassStrip classes={d.classes} /></div>
          </Link>
        ))}
        {!docs.length && <div className="text-gray-500">No documents yet.</div>}
      </div>
      <div className="text-xs text-gray-400">Strip legend: <span className="text-emerald-600">■ clean</span> · <span className="text-amber-600">■ complex</span> · <span className="text-rose-600">■ scanned</span> · <span className="text-purple-700">■ degraded</span> · <span className="text-sky-600">■ slide</span> · <span className="text-gray-400">■ blank</span></div>
    </div>
  );
}
