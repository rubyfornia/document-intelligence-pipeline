import { test } from "node:test";
import assert from "node:assert";
import { buildChunks, embeddingText } from "../../.test-build/chunker.js";

test("packs paragraphs to target without splitting them", () => {
  const blocks = Array.from({ length: 12 }, (_, i) => ({ id: `b${i}`, text: "word ".repeat(220).trim(), page: 1 + (i >> 2) }));
  const chunks = buildChunks({ sectionId: "s1", breadcrumb: ["Ch 1"], blocks });
  assert.ok(chunks.length >= 2);
  for (const c of chunks) assert.ok(c.tokens <= 1200, `chunk over ceiling: ${c.tokens}`);
  assert.deepEqual(chunks[0].blockIds.length + chunks.slice(1).reduce((a, c) => a + c.blockIds.length, 0), 12);
});
test("page span tracks contributing blocks", () => {
  const chunks = buildChunks({ sectionId: "s", breadcrumb: [], blocks: [
    { id: "a", text: "x ".repeat(900), page: 3 }, { id: "b", text: "y ".repeat(900), page: 4 },
  ]});
  assert.equal(chunks[0].pageStart, 3);
});
test("embedding text prepends breadcrumb once", () => {
  const t = embeddingText("Doc", ["A", "B"], "body");
  assert.equal(t, "Doc > A > B\n\nbody");
});
