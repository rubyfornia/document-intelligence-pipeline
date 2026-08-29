// mupdf (WASM) wrappers — the single deterministic PDF engine.
// One dependency does structured text (with fonts + bboxes), metadata, and rasterization.
import * as mupdf from "mupdf";

export interface Line {
  text: string;
  bbox: { x: number; y: number; w: number; h: number };
  fontName: string;
  fontSize: number;
  bold: boolean;
}
export interface PageExtract {
  n: number;                 // 1-indexed
  width: number; height: number;
  lines: Line[];
  imageBoxes: { x: number; y: number; w: number; h: number }[];
  charCount: number;
  error?: string;
}
export interface OutlineItem { title: string; page: number; level: number }

export function openDoc(buf: Buffer) {
  return mupdf.Document.openDocument(buf, "application/pdf");
}

export function docMeta(doc: any) {
  const get = (k: string) => { try { return doc.getMetaData(k) || null; } catch { return null; } };
  return {
    title: get("info:Title"), author: get("info:Author"),
    creator: get("info:Creator"), producer: get("info:Producer"),
    created: get("info:CreationDate"),
  };
}

export function docOutline(doc: any): OutlineItem[] {
  const out: OutlineItem[] = [];
  try {
    const walk = (items: any[], level: number) => {
      for (const it of items || []) {
        if (it.title != null && typeof it.page === "number" && it.page >= 0)
          out.push({ title: String(it.title), page: it.page + 1, level });
        if (it.down) walk(it.down, level + 1);
      }
    };
    walk(doc.loadOutline() || [], 1);
  } catch { /* no outline */ }
  return out;
}

export function extractPage(doc: any, n: number): PageExtract {
  try {
    const page = doc.loadPage(n - 1);
    const [x0, y0, x1, y1] = page.getBounds();
    const width = x1 - x0, height = y1 - y0;
    const stext = JSON.parse(page.toStructuredText("preserve-whitespace").asJSON());
    const lines: Line[] = [];
    const imageBoxes: PageExtract["imageBoxes"] = [];
    for (const b of stext.blocks || []) {
      if (b.type === "image") {
        const bb = b.bbox || {}; imageBoxes.push({ x: bb.x ?? 0, y: bb.y ?? 0, w: bb.w ?? 0, h: bb.h ?? 0 });
        continue;
      }
      for (const l of b.lines || []) {
        const text = (l.text ?? "").toString();
        if (!text.trim()) continue;
        const bb = l.bbox || {};
        const fontName = l.font?.name ?? "";
        lines.push({
          text,
          bbox: { x: bb.x ?? 0, y: bb.y ?? 0, w: bb.w ?? 0, h: bb.h ?? 0 },
          fontName,
          fontSize: l.font?.size ?? 0,
          bold: /bold|black|heavy/i.test(fontName),
        });
      }
    }
    const charCount = lines.reduce((a, l) => a + l.text.length, 0);
    return { n, width, height, lines, imageBoxes, charCount };
  } catch (e: any) {
    return { n, width: 0, height: 0, lines: [], imageBoxes: [], charCount: 0, error: String(e?.message ?? e) };
  }
}

/** Rasterize a page to PNG. DPI capped so the long edge stays ≤ maxLongEdge px. */
export function rasterPage(doc: any, n: number, dpi = 150, maxLongEdge = 1568): Buffer {
  const page = doc.loadPage(n - 1);
  const [x0, y0, x1, y1] = page.getBounds();
  const longEdgePt = Math.max(x1 - x0, y1 - y0);
  const effDpi = Math.min(dpi, Math.floor((maxLongEdge * 72) / longEdgePt));
  const s = Math.max(effDpi, 36) / 72;
  const pix = page.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB);
  return Buffer.from(pix.asPNG());
}
