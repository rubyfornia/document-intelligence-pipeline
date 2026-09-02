// Boot the demo corpus into a running deployment, from zero.
//   node scripts/seed.mjs <baseUrl> [extra.pdf ...]
// Uploads every PDF in corpus/seed/ (the corrupt and password-protected seeds are REFUSED at the
// door — that is their job), drives each accepted document through the step function to completion,
// then rebuilds cross-document relations. Extra PDFs given as arguments (e.g. a holdout document)
// are uploaded without the seed flag. Safe to re-run: the SHA-256 gate returns already-present
// documents untouched.
import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

const force = process.argv.includes("--force");
const args = process.argv.slice(2).filter(a => a !== "--force");
const base = args[0]?.replace(/\/$/, "");
if (!base) { console.error("usage: node scripts/seed.mjs <baseUrl> [extra.pdf ...] [--force]"); process.exit(1); }
// A deployed instance sits behind a shared passcode (SITE_PASSCODE); scripts present it as a header.
const H = process.env.SITE_PASSCODE ? { "x-passcode": process.env.SITE_PASSCODE } : {};

// Guard: seeding an already-seeded database creates a parallel corpus, because the SHA-256 gate
// only recognizes byte-identical files — and a regenerated corpus has new bytes. Learned live.
const existing = await fetch(`${base}/api/documents`, { headers: H }).then(r => r.json());
const seeded = (existing.documents ?? []).filter(d => d.seed);
if (seeded.length && !force) {
  console.error(`this deployment already holds ${seeded.length} seed documents — seeding again would duplicate the corpus under new ids. Pass --force if that is really what you want.`);
  process.exit(1);
}

const seedDir = "corpus/seed";
const files = readdirSync(seedDir).filter(f => f.endsWith(".pdf")).sort().map(f => ({ path: join(seedDir, f), seed: true }));
for (const extra of process.argv.slice(3)) files.push({ path: extra, seed: false });

for (const { path, seed } of files) {
  const fd = new FormData();
  fd.append("file", new Blob([readFileSync(path)], { type: "application/pdf" }), basename(path));
  if (seed) fd.append("seed", "1");
  const r = await fetch(`${base}/api/upload`, { method: "POST", body: fd, headers: H });
  const j = await r.json();
  if (!r.ok) { console.log(`${basename(path)}: refused (${r.status}) — ${j.error}`); continue; }
  if (j.cached) { console.log(`${basename(path)}: already present (${j.id}, ${j.status})`); continue; }
  process.stdout.write(`${basename(path)}: ${j.id} `);
  for (let i = 0; i < 120; i++) {
    const s = await fetch(`${base}/api/documents/${j.id}/step`, { method: "POST", headers: H }).then(x => x.json());
    if (s.status === "complete" || s.status === "failed") { console.log(`→ ${s.status}`); break; }
    process.stdout.write(".");
  }
}
await fetch(`${base}/api/relations/rebuild`, { method: "POST", headers: H });
console.log("relations rebuilt — planted-truth pairs ready on /relations");
