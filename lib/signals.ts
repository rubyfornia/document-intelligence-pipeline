// Per-page deterministic signals + triage. Pure functions — unit-tested.
import type { PageExtract } from "./pdf";

export interface Signals {
  chars: number;
  garbage_pct: number;      // % of chars outside letter/digit/punct/space + non-word-shaped tokens
  image_cov: number;        // image area / page area
  columns: number;          // detected column count (1 or 2+)
  modal_font: number;
  font_spread: number;      // stddev of line font sizes
  math_density: number;     // symbol-font or math-glyph share
  landscape: boolean;
  blankish: boolean;
}
export type PageClass = "A" | "B" | "C" | "D" | "slide" | "blank";
export interface Triage { class: PageClass; route: "deterministic" | "vision" | "none"; reason: string; signals: Signals }

const WORDISH = /^[\p{L}\p{N}][\p{L}\p{N}'’\-\.,;:!?()"]*$/u;

export function computeSignals(p: PageExtract): Signals {
  const text = p.lines.map(l => l.text).join(" ");
  const chars = text.replace(/\s+/g, "").length;
  let bad = 0, total = 0;
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    total++;
    const cp = ch.codePointAt(0)!;
    const isCommon = /[\p{L}\p{N}\p{P}\p{Sm}\p{Sc}]/u.test(ch) && !(cp >= 0xe000 && cp <= 0xf8ff) && cp !== 0xfffd;
    if (!isCommon) bad++;
  }
  const tokens = text.split(/\s+/).filter(Boolean);
  const nonWord = tokens.length ? tokens.filter(t => !WORDISH.test(t)).length / tokens.length : 0;
  const charGarbage = total ? bad / total : 0;
  const garbage_pct = Math.max(charGarbage, Math.max(0, nonWord - 0.35)) * 100;

  const pageArea = Math.max(p.width * p.height, 1);
  const imgArea = p.imageBoxes.reduce((a, b) => a + Math.max(b.w, 0) * Math.max(b.h, 0), 0);
  const image_cov = Math.min(imgArea / pageArea, 1);

  // column detection: cluster line left edges
  const xs = p.lines.map(l => l.bbox.x).sort((a, b) => a - b);
  let columns = 1;
  if (xs.length >= 12) {
    const gaps: { at: number; size: number }[] = [];
    for (let i = 1; i < xs.length; i++) gaps.push({ at: i, size: xs[i] - xs[i - 1] });
    gaps.sort((a, b) => b.size - a.size);
    const big = gaps[0];
    if (big && big.size > p.width * 0.22) {
      const left = big.at, right = xs.length - big.at;
      if (left / xs.length > 0.25 && right / xs.length > 0.25) columns = 2;
    }
  }

  const sizes = p.lines.map(l => l.fontSize).filter(s => s > 0);
  const modal_font = mode(sizes);
  const mean = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
  const font_spread = sizes.length ? Math.sqrt(sizes.reduce((a, b) => a + (b - mean) ** 2, 0) / sizes.length) : 0;

  const mathLines = p.lines.filter(l => /symbol|math|cmmi|cmsy|cmex/i.test(l.fontName)).length;
  const mathGlyphs = (text.match(/[∑∫∂√∞≈≠≤≥±×÷∈∀∃α-ωΓΔΘΛΞΠΣΦΨΩ]/g) || []).length;
  const math_density = Math.max(p.lines.length ? mathLines / p.lines.length : 0, chars ? Math.min(mathGlyphs / Math.max(chars / 100, 1) / 10, 1) : 0);

  return {
    chars, garbage_pct: round2(garbage_pct), image_cov: round2(image_cov), columns,
    modal_font: round2(modal_font), font_spread: round2(font_spread), math_density: round2(math_density),
    landscape: p.width > p.height,
    blankish: chars < 5 && image_cov < 0.02,
  };
}

export function triagePage(p: PageExtract): Triage {
  const s = computeSignals(p);
  if (p.error) return { class: "D", route: "vision", reason: `extractor error: ${p.error.slice(0, 80)}`, signals: s };
  if (s.blankish) return { class: "blank", route: "none", reason: "no text, no image — blank page", signals: s };
  if (s.chars < 20 && s.image_cov > 0.5)
    return { class: "C", route: "vision", reason: `scanned: ${s.chars} chars under ${Math.round(s.image_cov * 100)}% image coverage`, signals: s };
  if (s.garbage_pct >= 10)
    return { class: "D", route: "vision", reason: `degraded text layer: ${s.garbage_pct}% garbage`, signals: s };
  if (s.landscape && s.modal_font >= 18 && s.chars < 900)
    return { class: "slide", route: "deterministic", reason: "slide-deck geometry: landscape, large modal font, low density", signals: s };
  const complexFlags: string[] = [];
  if (s.columns >= 2) complexFlags.push("multi-column");
  if (s.image_cov >= 0.15 && s.image_cov < 0.6) complexFlags.push("figure-heavy");
  if (s.math_density > 0.08) complexFlags.push("math");
  if (s.garbage_pct >= 2) complexFlags.push("distrust-text");
  if (s.chars >= 200 && complexFlags.length === 0)
    return { class: "A", route: "deterministic", reason: "clean digital: single column, trusted text", signals: s };
  if (s.chars >= 60) {
    // multi-column escalates the whole page pre-emptively; other B pages stay deterministic with region assists
    const toVision = complexFlags.includes("multi-column");
    return {
      class: "B",
      route: toVision ? "vision" : "deterministic",
      reason: `complex: ${complexFlags.join(", ") || "short page"}${toVision ? " → whole-page vision (reading order is cheaper to prevent than repair)" : ""}`,
      signals: s,
    };
  }
  return { class: "C", route: "vision", reason: `sparse text (${s.chars} chars) — treated as scanned`, signals: s };
}

function mode(arr: number[]): number {
  if (!arr.length) return 0;
  const c = new Map<number, number>();
  for (const v of arr) { const k = Math.round(v * 2) / 2; c.set(k, (c.get(k) || 0) + 1); }
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
const round2 = (n: number) => Math.round(n * 100) / 100;
