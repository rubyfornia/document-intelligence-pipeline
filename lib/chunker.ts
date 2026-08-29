// Leaf-section chunking: greedy paragraph packing, 500–800 token target, 1,200 hard ceiling.
// Context by reference (breadcrumb + neighbors), never by duplication.
export interface ChunkInput { sectionId: string; breadcrumb: string[]; blocks: { id: string; text: string; page: number }[] }
export interface BuiltChunk {
  sectionId: string; breadcrumb: string[]; text: string; tokens: number;
  pageStart: number; pageEnd: number; blockIds: string[];
}

export const estTokens = (s: string) => Math.ceil(s.length / 4);

export function buildChunks(inp: ChunkInput, target = 800, ceiling = 1200): BuiltChunk[] {
  const out: BuiltChunk[] = [];
  let cur: BuiltChunk | null = null;
  const flush = () => { if (cur && cur.text.trim()) out.push(cur); cur = null; };
  for (const b of inp.blocks) {
    const t = b.text.trim();
    if (!t) continue;
    const tok = estTokens(t);
    if (cur && cur.tokens + tok > (cur.tokens >= target ? cur.tokens : ceiling) && cur.tokens >= 200) flush();
    if (!cur) cur = { sectionId: inp.sectionId, breadcrumb: inp.breadcrumb, text: "", tokens: 0, pageStart: b.page, pageEnd: b.page, blockIds: [] };
    cur.text += (cur.text ? "\n\n" : "") + t;
    cur.tokens += tok;
    cur.pageEnd = Math.max(cur.pageEnd, b.page);
    cur.blockIds.push(b.id);
    if (cur.tokens >= target) flush();
  }
  flush();
  return out;
}

export const embeddingText = (docTitle: string, breadcrumb: string[], text: string) =>
  `${[docTitle, ...breadcrumb].filter(Boolean).join(" > ")}\n\n${text}`;
