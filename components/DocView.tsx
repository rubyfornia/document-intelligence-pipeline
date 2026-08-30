"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ClassStrip, StatusChip, CLASS_LABELS, money, secs } from "./ui";

const TABS = ["Overview", "Structure", "Representation", "Ledger"] as const;

export default function DocView({ id }: { id: string }) {
  const [data, setData] = useState<any>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      const r = await fetch(`/api/documents/${id}/export`); const j = await r.json();
      if (!live) return;
      setData(j);
      if (j.document?.status === "processing") setTimeout(load, 1500);
    };
    load(); return () => { live = false; };
  }, [id]);
  useEffect(() => {
    if (tab !== "Ledger") return;
    fetch(`/api/documents/${id}/ledger`).then(r => r.json()).then(j => setLedger(j.events));
  }, [tab, id]);

  const d = data?.document;
  const pageRow = useMemo(() => data?.pages?.find((p: any) => p.n === page), [data, page]);
  const pageChunks = useMemo(() => (data?.chunks ?? []).filter((c: any) => page >= c.page_start && page <= c.page_end), [data, page]);
  const pageEls = useMemo(() => (data?.elements ?? []).filter((e: any) => e.page_n === page), [data, page]);

  if (!d) return <div className="p-10 text-gray-500">Loading…</div>;
  return (
    <main className="mx-auto max-w-6xl p-6 sm:p-8">
      <header className="mb-6">
        <Link href="/" className="text-sm text-brand-700 hover:underline">← Library</Link>
        <div className="mt-1 flex items-center justify-between gap-4">
          <h1 className="truncate text-xl font-bold text-gray-900">{d.title?.value ?? d.filename}</h1>
          <StatusChip s={d.status} />
        </div>
        <div className="mt-1 text-sm text-gray-500">
          title source: {d.title?.source ?? "—"} · {d.page_count} pages · {d.totals?.model_calls ?? "…"} model calls · {money(d.totals?.cost_usd)} · {secs(d.totals?.duration_ms)}
        </div>
      </header>
      <nav className="mb-6 flex gap-1 rounded-lg bg-gray-100 p-1 text-sm font-medium">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx("flex-1 rounded-md px-3 py-1.5", tab === t ? "bg-white shadow text-gray-900" : "text-gray-600 hover:text-gray-900")}>{t}</button>
        ))}
      </nav>

      {tab === "Overview" && (
        <div className="space-y-6">
          {d.abstract?.value && (
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase text-gray-500">Abstract <span className="font-normal normal-case">(generated — marked as such in the representation)</span></div>
              <p className="mt-2 text-gray-800">{d.abstract.value}</p>
            </section>
          )}
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-2 text-xs font-semibold uppercase text-gray-500">Page routing — one cell per page</div>
            <ClassStrip classes={(data.pages ?? []).map((p: any) => ({ n: p.n, class: p.class }))} size="h-5" />
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-gray-700 sm:grid-cols-3">
              {Object.entries(d.totals?.page_class_counts ?? {}).map(([k, v]: any) => (
                <div key={k}><span className="font-semibold">{v}</span> {CLASS_LABELS[k] ?? k}</div>
              ))}
            </div>
          </section>
          {!!data.warnings?.length && (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-xs font-semibold uppercase text-amber-700">Warnings — surfaced, not hidden</div>
              <ul className="mt-2 space-y-1 text-sm text-amber-900">
                {data.warnings.map((w: any, i: number) => <li key={i}><span className="font-mono text-xs">{w.code}</span>{w.page_n ? ` p.${w.page_n}` : ""} — {w.message}</li>)}
              </ul>
            </section>
          )}
          {!!data.boilerplate?.length && (
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase text-gray-500">Boilerplate — excluded from chunks, preserved here</div>
              <ul className="mt-2 space-y-1 text-sm text-gray-600">
                {data.boilerplate.slice(0, 8).map((b: any, i: number) => <li key={i}>“{b.text}” · {b.pages.length} pages</li>)}
              </ul>
            </section>
          )}
        </div>
      )}

      {tab === "Structure" && (
        <div className="grid gap-6 lg:grid-cols-[240px_1fr_300px]">
          <aside className="max-h-[70vh] overflow-auto rounded-xl border border-gray-200 bg-white p-3 text-sm">
            {(data.sections ?? []).map((s: any) => (
              <button key={s.id} onClick={() => setPage(s.page_start)}
                className="block w-full truncate rounded px-2 py-1 text-left hover:bg-gray-50"
                style={{ paddingLeft: `${(s.level - 1) * 14 + 8}px` }}
                title={`${s.source} · confidence ${s.confidence ?? "—"}`}>
                <span className="text-gray-900">{s.title}</span>
                <span className="ml-1 text-xs text-gray-400">p.{s.page_start}–{s.page_end}</span>
              </button>
            ))}
          </aside>
          <section>
            <div className="mb-2 flex items-center justify-between text-sm text-gray-600">
              <button className="rounded border px-2 py-1 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>←</button>
              <div>page {page} / {d.page_count} · <span className="font-medium">{CLASS_LABELS[pageRow?.class] ?? pageRow?.class}</span>
                {pageRow?.model ? <span className="text-gray-400"> · {pageRow.model}</span> : null}</div>
              <button className="rounded border px-2 py-1 disabled:opacity-40" disabled={page >= d.page_count} onClick={() => setPage(p => p + 1)}>→</button>
            </div>
            <div className="relative overflow-hidden rounded-xl border border-gray-300 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/documents/${id}/page/${page}/image`} alt={`page ${page}`} className="block w-full" />
              {pageEls.map((e: any) => (
                <div key={e.id} onClick={() => setSel(e.id)}
                  className={clsx("absolute cursor-pointer border-2",
                    e.bbox_source === "measured" ? "border-emerald-500/80" : "border-dashed border-rose-500/80",
                    sel === e.id && "bg-amber-200/30")}
                  style={boxStyle(e.bbox)} title={`${e.type} (${e.bbox_source ?? "model-asserted"})`} />
              ))}
            </div>
            <div className="mt-2 text-xs text-gray-500">solid <span className="text-emerald-600">green</span> = measured coordinates · dashed <span className="text-rose-600">red</span> = model-asserted (drawn differently on purpose)</div>
            <div className="mt-1 text-xs text-gray-500">routing reason: {pageRow?.reason}</div>
          </section>
          <aside className="max-h-[70vh] space-y-3 overflow-auto text-sm">
            {pageEls.map((e: any) => (
              <div key={e.id} onClick={() => setSel(e.id)}
                   className={clsx("cursor-pointer rounded-lg border p-3", sel === e.id ? "border-amber-400 bg-amber-50" : "border-gray-200 bg-white")}>
                <div className="font-semibold text-gray-800">{e.type} <span className="font-normal text-xs text-gray-500">({e.status})</span></div>
                {e.caption && <div className="mt-1 text-gray-700">{e.caption}</div>}
                {e.description && <div className="mt-1 text-gray-500">{e.description}</div>}
                {e.grid?.columns?.length ? <div className="mt-1 font-mono text-xs text-gray-500">{e.grid.columns.join(" · ")} × {e.grid.rows?.length ?? 0} rows</div> : null}
              </div>
            ))}
            {pageChunks.map((c: any) => (
              <div key={c.id} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="text-xs text-gray-500">{(c.breadcrumb ?? []).join(" › ")} · {c.tokens} tok · {c.content_type}</div>
                <div className="mt-1 line-clamp-4 whitespace-pre-wrap text-gray-700">{c.text}</div>
              </div>
            ))}
            {!pageEls.length && !pageChunks.length && <div className="text-gray-400">Nothing extracted on this page.</div>}
          </aside>
        </div>
      )}

      {tab === "Representation" && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm text-gray-600">This JSON is the deliverable a downstream system would be handed — <a className="text-brand-700 hover:underline" href={`/api/documents/${id}/export`} target="_blank">open raw ↗</a></div>
            <button className="rounded border px-2 py-1 text-sm" onClick={() => navigator.clipboard.writeText(JSON.stringify(data, null, 2))}>copy</button>
          </div>
          <pre className="max-h-[70vh] overflow-auto rounded bg-gray-50 p-3 text-xs leading-relaxed">{JSON.stringify({ ...data, chunks: data.chunks?.slice(0, 40) }, null, 2)}</pre>
        </section>
      )}

      {tab === "Ledger" && (
        <section className="rounded-xl border border-gray-200 bg-white p-2">
          <div className="p-2 text-sm text-gray-600">The ledger records <em>what ran</em> — models, tokens, time, and dollars come from the execution path, not from estimates.</div>
          <div className="overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500"><tr>
                {["ts", "stage", "page", "model", "in", "out", "ms", "cost", "note"].map(h => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {ledger.map((e: any) => (
                  <tr key={e.id} className="border-t border-gray-100">
                    <td className="px-2 py-1 text-gray-400">{new Date(e.ts).toLocaleTimeString()}</td>
                    <td className="px-2 py-1 font-medium">{e.stage}</td>
                    <td className="px-2 py-1">{e.page_n ?? ""}</td>
                    <td className="px-2 py-1">{e.model ?? ""}</td>
                    <td className="px-2 py-1">{e.input_tokens ?? ""}</td>
                    <td className="px-2 py-1">{e.output_tokens ?? ""}</td>
                    <td className="px-2 py-1">{e.ms ?? ""}</td>
                    <td className="px-2 py-1">{e.cost_usd ? `$${Number(e.cost_usd).toFixed(4)}` : ""}</td>
                    <td className="px-2 py-1 text-gray-500">{e.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
function boxStyle(bbox: any) {
  // element bboxes are stored verbatim from vision: fractions of page size in [0,1], origin top-left
  // (blocks are converted to page points at ingest; elements are not)
  return {
    left: `${(bbox?.x ?? 0) * 100}%`,
    top: `${(bbox?.y ?? 0) * 100}%`,
    width: `${(bbox?.w ?? 0) * 100}%`,
    height: `${(bbox?.h ?? 0) * 100}%`,
  } as React.CSSProperties;
}
