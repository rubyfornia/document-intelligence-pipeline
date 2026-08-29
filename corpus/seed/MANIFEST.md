# Test corpus manifest

Every document earns its row. All content is public domain (Project Gutenberg texts:
*On the Origin of Species* 1st ed. #1228 and 6th ed. #2009; *Pride and Prejudice* #1342)
or manufactured by `scripts/corpus/build.py` — rerunnable from scratch. No licensing
ambiguity anywhere in the seed set; anything unclear stays in `corpus/local/` (gitignored).

| file | class exercised | expected hurt |
|---|---|---|
| seed-01-clean.pdf | A happy path: headings ×2 levels, figure, table, math glyphs | math line may flag as complex; table is borderless-adjacent |
| seed-02-twocol.pdf | B multi-column → whole-page vision (reading order) | column detection on reportlab frame layout |
| seed-03-deck.pdf | slide-deck mode (landscape, 34pt, sparse) | title-vs-heading disambiguation across 3 slides |
| seed-04-scan.pdf | C scanned (110-dpi grayscale raster of seed-01 → image-only) | known ground truth = seed-01 text; OCR quality measurable |
| seed-05-neardup.pdf | bonus plant: near-duplicate of seed-01 (deterministic word swaps, new styling) | must score ≥ 0.92 against seed-01 chunks |
| seed-06-related.pdf | bonus plant: same topics from the heavily revised 6th edition | must land in 0.75–0.92 band vs seed-01, not near-dup |
| seed-07-negative.pdf | bonus negative control (distant domain) | must stay OUT of every top-K; if present, embeddings match "PDF-ness" |
| seed-08-corrupt.pdf | ingest fast-fail: header + 600 bytes, no recoverable page tree | must refuse at the door. Finding from building this: the engine *repairs* damaged xrefs (a 35% truncation still opened with 8 pages), so the true fast-fail boundary is "no recoverable page tree", not "damaged file" |
| seed-09-protected.pdf | ingest fast-fail: password-protected (password: demo) | must be distinguished from generic parse failure |

The deployed system will face documents that are in nobody's corpus — the upload button
is the real exam. This set exists so the failure modes are earned before an evaluator
finds them.
