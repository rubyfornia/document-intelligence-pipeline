"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ClassStrip, StatusChip, money, secs } from "./ui";

interface Doc { id: string; filename: string; title: any; status: string; seed: boolean; locked?: boolean; page_count: number; totals: any; classes: { n: number; class: string }[] }

export default function Library() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const stepping = useRef<Set<string>>(new Set());

  // browsers navigate to a dropped file by default — a drop that misses the zone must not eject the app
  useEffect(() => {
    const swallow = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => { window.removeEventListener("dragover", swallow); window.removeEventListener("drop", swallow); };
  }, []);

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
      {/* sticky: the drop zone and the strip legend stay readable while the library scrolls */}
      <div className="sticky top-0 z-20 -mx-2 space-y-2 bg-gray-50 px-2 pb-2 pt-2">
      <label
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault(); setDragOver(false);
          if (busy) return;
          const f = Array.from(e.dataTransfer.files).find(f => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
          if (f) upload(f); else setErr("Drop a PDF file — that one didn't look like a PDF.");
        }}
        className={`block cursor-pointer rounded-xl border-2 border-dashed p-8 text-center ${dragOver ? "border-brand-500 bg-brand-50" : "border-gray-300 bg-white hover:border-brand-400"}`}>
        <input type="file" accept="application/pdf" className="hidden"
               onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
        <div className="text-gray-700 font-medium">{busy ? `Uploading ${busy}…` : "Drop or choose a PDF to run the pipeline"}</div>
        <div className="mt-1 text-sm text-gray-500">50 MB / 300 pages max. Corrupt or password-protected files are refused at the door, with the reason.</div>
      </label>
      {err && <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">{err}</div>}
      <div className="text-xs text-gray-400">Strip legend: <span className="text-emerald-600">■ clean</span> · <span className="text-amber-600">■ complex</span> · <span className="text-rose-600">■ scanned</span> · <span className="text-purple-700">■ degraded</span> · <span className="text-sky-600">■ slide</span> · <span className="text-gray-400">■ blank</span></div>
      </div>
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
                {d.status === "failed" && (
                  <button title="resume the run from the stage that failed (state is in the database — a failure costs one step, not the document)"
                    onClick={async e => {
                      e.preventDefault(); e.stopPropagation();
                      const r = await fetch(`/api/documents/${d.id}/retry`, { method: "POST" });
                      if (!r.ok) setErr((await r.json()).error ?? "retry failed");
                      refresh();
                    }}
                    className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:border-emerald-500 hover:text-emerald-700">
                    retry
                  </button>
                )}
                {!d.seed && !d.locked && (
                  <button title="delete this upload (the shipped demo corpus is protected)"
                    onClick={async e => {
                      e.preventDefault(); e.stopPropagation();
                      if (!window.confirm(`Delete "${d.title?.value ?? d.filename}"? This removes the document, its pages, chunks, and ledger.`)) return;
                      const r = await fetch(`/api/documents/${d.id}`, { method: "DELETE" });
                      if (!r.ok) setErr((await r.json()).error ?? "delete failed");
                      refresh();
                    }}
                    className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:border-rose-400 hover:text-rose-600">
                    delete
                  </button>
                )}
              </div>
            </div>
            <div className="mt-3"><ClassStrip classes={d.classes} /></div>
          </Link>
        ))}
        {!docs.length && <div className="text-gray-500">No documents yet.</div>}
      </div>
    </div>
  );
}
