import { test } from "node:test";
import assert from "node:assert";
import { triagePage } from "../../.test-build/signals.js";

const mkLine = (text, x = 72, y = 100, size = 11, font = "Helvetica") =>
  ({ text, bbox: { x, y, w: 400, h: 14 }, fontName: font, fontSize: size, bold: /bold/i.test(font) });
const page = (over = {}) => ({ n: 1, width: 612, height: 792, lines: [], imageBoxes: [], charCount: 0, ...over });

test("clean digital page → A / deterministic", () => {
  const lines = Array.from({ length: 30 }, (_, i) => mkLine("Ordinary body text sentence for a clean page.", 72, 90 + i * 20));
  const t = triagePage(page({ lines }));
  assert.equal(t.class, "A"); assert.equal(t.route, "deterministic");
});
test("image-dominant, near-zero text → C / vision", () => {
  const t = triagePage(page({ lines: [mkLine("3", 300, 770, 9)], imageBoxes: [{ x: 0, y: 0, w: 612, h: 700 }] }));
  assert.equal(t.class, "C"); assert.equal(t.route, "vision");
});
test("garbage text layer → D / vision", () => {
  const lines = Array.from({ length: 20 }, () => mkLine("  zqx "));
  const t = triagePage(page({ lines }));
  assert.equal(t.class, "D");
});
test("two-column page → B routed to vision pre-emptively", () => {
  const lines = [];
  for (let i = 0; i < 25; i++) { lines.push(mkLine("Left column body text here.", 60, 90 + i * 22)); lines.push(mkLine("Right column body text here.", 330, 90 + i * 22)); }
  const t = triagePage(page({ lines }));
  assert.equal(t.class, "B"); assert.equal(t.route, "vision");
  assert.match(t.reason, /multi-column/);
});
test("landscape big-font sparse page → slide", () => {
  const lines = Array.from({ length: 6 }, (_, i) => mkLine("Big slide bullet point", 80, 100 + i * 60, 28));
  const t = triagePage(page({ width: 792, height: 612, lines }));
  assert.equal(t.class, "slide");
});
test("blank page → blank / none", () => {
  const t = triagePage(page({}));
  assert.equal(t.class, "blank"); assert.equal(t.route, "none");
});
