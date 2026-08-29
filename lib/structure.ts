// Deterministic structure: boilerplate detection, heading candidates, section tree.
// Pure functions over extracted lines — unit-testable.
import type { Line } from "./pdf";

export interface PageLines { n: number; width: number; height: number; lines: Line[] }
export interface HeadingCandidate {
  page: number; lineIdx: number; text: string; size: number; bold: boolean;
  numbered: boolean; level: number; confidence: number;
}

const norm = (s: string) => s.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();

/** Recurring top/bottom lines across ≥ max(3, 30% of pages) → boilerplate. Stored, not destroyed. */
export function detectBoilerplate(pages: PageLines[]): Map<string, { text: string; pages: number[] }> {
  const zoneHits = new Map<string, { text: string; pages: number[] }>();
  for (const p of pages) {
    if (!p.height) continue;
    for (const l of p.lines) {
      const yr = l.bbox.y / p.height;
      if (yr < 0.1 || yr > 0.88) {
        const k = (yr < 0.1 ? "T:" : "B:") + norm(l.text);
        if (!k.slice(2)) continue;
        const e = zoneHits.get(k) ?? { text: l.text, pages: [] };
        if (!e.pages.includes(p.n)) e.pages.push(p.n);
        zoneHits.set(k, e);
      }
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.3));
  const out = new Map<string, { text: string; pages: number[] }>();
  for (const [k, v] of zoneHits) if (v.pages.length >= threshold) out.set(k, v);
  return out;
}

export function isBoilerplateLine(l: Line, page: PageLines, bp: Map<string, any>): boolean {
  if (!page.height) return false;
  const yr = l.bbox.y / page.height;
  if (yr >= 0.1 && yr <= 0.88) return false;
  return bp.has((yr < 0.1 ? "T:" : "B:") + norm(l.text));
}

const NUMBERED = /^((\d+(\.\d+)*)|([IVXLC]+\.)|(Chapter|Section|Part|Appendix)\s+\w+)[\s.:—-]/i;

export function headingCandidates(pages: PageLines[], bp: Map<string, any>): HeadingCandidate[] {
  const sizes = pages.flatMap(p => p.lines.map(l => l.fontSize)).filter(s => s > 0).sort((a, b) => a - b);
  const body = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 11;
  const out: HeadingCandidate[] = [];
  for (const p of pages) {
    p.lines.forEach((l, i) => {
      if (isBoilerplateLine(l, p, bp)) return;
      const t = l.text.trim();
      if (!t || t.length > 120) return;
      const big = l.fontSize >= body * 1.12;
      const numbered = NUMBERED.test(t);
      const shortBold = l.bold && t.length < 90 && l.fontSize >= body * 0.98;
      if (!big && !numbered && !shortBold) return;
      const wordCount = t.split(/\s+/).length;
      if (!numbered && wordCount > 14) return;
      if (/[.,;:]$/.test(t) && !numbered) return;
      let conf = 0.4;
      if (big) conf += 0.25;
      if (numbered) conf += 0.25;
      if (l.bold) conf += 0.1;
      out.push({ page: p.n, lineIdx: i, text: t, size: l.fontSize, bold: l.bold, numbered, level: 1, confidence: Math.min(conf, 1) });
    });
  }
  // level by size rank (bigger = shallower); numbered depth wins where present
  const uniqSizes = [...new Set(out.map(h => Math.round(h.size)))].sort((a, b) => b - a);
  for (const h of out) {
    const m = h.text.match(/^(\d+(\.\d+)*)/);
    if (m) h.level = Math.min(m[1].split(".").length, 4);
    else h.level = Math.min(uniqSizes.indexOf(Math.round(h.size)) + 1, 4);
    if (h.level < 1) h.level = 1;
  }
  return out;
}

/** Tree-shape sanity: cap depth, drop pathological one-liner cascades. Returns warnings. */
export function sanityCheck(hs: HeadingCandidate[]): string[] {
  const warns: string[] = [];
  const deep = hs.filter(h => h.level > 4).length;
  if (deep) warns.push(`${deep} headings deeper than level 4 were clamped`);
  for (let i = 1; i < hs.length; i++) {
    if (hs[i].page === hs[i - 1].page && hs[i].lineIdx === hs[i - 1].lineIdx + 1)
      warns.push(`adjacent heading pair on page ${hs[i].page} ("${hs[i - 1].text.slice(0, 30)}…") may be over-detection`);
  }
  return warns.slice(0, 10);
}
