"use client";
import clsx from "clsx";

export const CLASS_COLORS: Record<string, string> = {
  A: "bg-emerald-500", B: "bg-amber-500", C: "bg-rose-500", D: "bg-purple-600",
  slide: "bg-sky-500", blank: "bg-gray-300",
};
export const CLASS_LABELS: Record<string, string> = {
  A: "clean digital", B: "complex", C: "scanned", D: "degraded", slide: "slide deck", blank: "blank",
};

export function ClassStrip({ classes, size = "h-3" }: { classes: { n: number; class: string }[]; size?: string }) {
  if (!classes.length) return null;
  return (
    <div className="flex w-full gap-px" title="one cell per page, colored by triage class">
      {classes.map(c => (
        <div key={c.n} className={clsx("flex-1 rounded-[1px]", size, CLASS_COLORS[c.class] ?? "bg-gray-200")}
             title={`p.${c.n} — ${CLASS_LABELS[c.class] ?? c.class}`} />
      ))}
    </div>
  );
}

export function StatusChip({ s }: { s: string }) {
  const style = s === "complete" ? "bg-emerald-100 text-emerald-800" : s === "processing" ? "bg-amber-100 text-amber-800 animate-pulse"
    : s === "partial" ? "bg-orange-100 text-orange-800" : s === "failed" ? "bg-rose-100 text-rose-800" : "bg-gray-100 text-gray-700";
  return <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", style)}>{s}</span>;
}
export const money = (n: number | string | null | undefined) => n == null ? "—" : `$${Number(n).toFixed(4)}`;
export const secs = (ms: number | null | undefined) => ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`;
