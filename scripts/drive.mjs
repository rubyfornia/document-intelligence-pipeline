// Upload one PDF and drive the step function to completion. Usage: node scripts/drive.mjs <base> <file> [seed]
const [base, file, seed] = process.argv.slice(2);
import fs from "node:fs";
const fd = new FormData();
fd.append("file", new File([fs.readFileSync(file)], file.split("/").pop()), file.split("/").pop());
if (seed) fd.append("seed", "1");
const up = await fetch(`${base}/api/upload`, { method: "POST", body: fd });
const uj = await up.json();
console.log("upload:", up.status, JSON.stringify(uj));
if (!up.ok || uj.cached) process.exit(up.ok ? 0 : 1);
const id = uj.id;
let last = "";
for (let i = 0; i < 400; i++) {
  const r = await fetch(`${base}/api/documents/${id}/step`, { method: "POST" });
  const j = await r.json();
  const line = `${j.stage} ${j.status ?? ""} ${j.pagesTriaged ?? ""}/${j.pageCount ?? ""} ${j.error ?? ""}`;
  if (line !== last) { console.log("step:", line); last = line; }
  if (j.done || j.error) { console.log("FINAL:", JSON.stringify(j)); break; }
}
