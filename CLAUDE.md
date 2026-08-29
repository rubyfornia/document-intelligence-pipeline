# Document Intelligence Pipeline — Build Agent

The assignment: build a pipeline that accepts a PDF and produces a structured representation
suitable for downstream AI systems — sections with page ranges, text, figures, tables,
provenance, summaries — with a small web UI that makes the pipeline's behavior inspectable.

**Deliverables:** deployed live URL seeded with example documents · this repository · a 1–2 page
README · a 5-minute video walkthrough. **Complete by Friday 2026-09-04, 12:00 PT.**

Harold Lee builds; this agent assists. Every commit is authored by Harold Lee alone — no
co-author trailers of any kind.

---

## Session start

1. Read `_meta/context/PLAN.md` (the working plan) and `_meta/context/ASSIGNMENT.md` (the task).
2. First session only: pass `_meta/READINESS-TEST.md` before real work.
3. Check the current phase against the plan's build order; work the next unfinished phase.

`_meta/` is **local working context — never committed, never referenced in committed files.**
The README and all committed docs are authored fresh from the build.

## Decided stack (do not relitigate without new evidence)

- Next.js 14 + TypeScript + Tailwind + Radix + Tremor, deployed on Vercel.
- **mupdf (WASM)** for extraction and rasterization; fallback `pdfjs-dist` + `@napi-rs/canvas`
  — the call is made in phase 1 and recorded.
- Postgres (Neon) + pgvector; Vercel Blob for PDFs, page rasters, crops.
- **Claude Haiku 4.5 (`claude-haiku-4-5`) for every generative call; Sonnet 5
  (`claude-sonnet-5`) as the single escalation path**, triggered by evidence only. Voyage
  `voyage-4-lite` embeddings. **Strict structured outputs on every model call.**
- Pipeline runs as a step function (`POST /api/documents/:id/step`) with state in Postgres;
  a client polling hook drives it. No queue service.

## Discipline

- **Verify at source.** Prices, token accounting, library behavior: verified at build time or
  labeled as estimates with assumptions shown. A confident unverified number never ships.
- **Every figure re-runnable.** Costs and timings in the README come from the pipeline's own
  recorded runs, not from projections.
- **Honest failure surfacing.** The per-page ledger records what actually ran — class, route,
  model, ms, $ — and every page appears in it. A failed page is shown as failed. Hiding a
  failure is the one unrecoverable defect in this project.
- **Cut, don't pad.** The assignment grades judgment: what was deliberately not built, and why,
  is first-class content. Under time pressure the cut order is: bonus → UI extras → never the
  README or the video.
- **Scope discipline.** The assignment's own words: do not spend the majority of the time making
  the UI beautiful. Inspectability over polish.

## Secrets & data

- `.env*` never committed; keys live locally and in Vercel env settings.
- Only clearly-licensed documents (public domain / CC) are seeded into the deployed app or
  committed. Anything unclear stays in `corpus/local/` (gitignored).

## Guards (both halves, or neither)

Hooks live in `.githooks/`. **Enable once per clone, before the first commit:**

```bash
git config core.hooksPath .githooks
```

- `pre-commit` blocks `_meta/`, secrets, and uncleared corpus files from entering git.
- `pre-push` certifies the **destination**: it refuses any push whose URL is not an exact entry
  in `_firewall/remotes.allow`. The list is born empty and the refusal is the guard working —
  only a human adds a destination, typed in full, never pasted and never derived from
  `git remote get-url`. Do not edit the hook.

## End of turn

Close every working turn with a short status block:

```yaml
project:  DOCPIPE
turn:     <what this turn did>
phase:    <current build-order phase>
verified: [<facts checked at source this turn>]
wrote:    [<files/commits>]
next:     <the next mechanical step>
stamp:    <YYYYMMDD-HHMM local>
```
