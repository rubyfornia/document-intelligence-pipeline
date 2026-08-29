#!/usr/bin/env python3
"""Manufacture the test corpus from public-domain sources.
Every document earns its row in corpus/seed/MANIFEST.md. PD/manufactured only —
anything with unclear licensing stays in corpus/local/ (gitignored)."""
import io, os, re, subprocess, sys, urllib.request
from reportlab.lib.pagesizes import letter, landscape
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                PageBreak, Frame, PageTemplate, BaseDocTemplate, NextPageTemplate, Image as RLImage)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import inch
from pypdf import PdfReader, PdfWriter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SEED = os.path.join(ROOT, "corpus", "seed"); LOCAL = os.path.join(ROOT, "corpus", "local")
os.makedirs(SEED, exist_ok=True); os.makedirs(LOCAL, exist_ok=True)
ST = getSampleStyleSheet()
BODY = ParagraphStyle("body", parent=ST["Normal"], fontSize=10.5, leading=14.5, spaceAfter=6)

def gutenberg(gid, cache):
    p = os.path.join(LOCAL, cache)
    if not os.path.exists(p):
        for url in (f"https://www.gutenberg.org/cache/epub/{gid}/pg{gid}.txt",
                    f"https://www.gutenberg.org/files/{gid}/{gid}-0.txt"):
            try:
                urllib.request.urlretrieve(url, p); break
            except Exception: continue
    t = io.open(p, encoding="utf-8", errors="ignore").read()
    m = re.search(r"\*\*\* START OF.*?\*\*\*(.*)\*\*\* END OF", t, re.S)
    return (m.group(1) if m else t)

def paras(text, start_frac, n):
    ps = [re.sub(r"\s+", " ", p).strip() for p in text.split("\n\n")]
    ps = [p for p in ps if len(p) > 200 and not p.isupper()]
    i = int(len(ps) * start_frac)
    return ps[i:i + n]

def styled_doc(path, title, sections, table=None, fig=False, math=False):
    doc = SimpleDocTemplate(path, pagesize=letter, title=title, pageCompression=0)
    story = [Paragraph(title, ST["Title"]), Spacer(1, 12)]
    for si, (heading, subs) in enumerate(sections, 1):
        story.append(Paragraph(f"{si}. {heading}", ST["Heading1"]))
        for hi, (sub, ps) in enumerate(subs, 1):
            if sub: story.append(Paragraph(f"{si}.{hi} {sub}", ST["Heading2"]))
            for p in ps: story.append(Paragraph(p, BODY))
            if fig and si == 1 and hi == 1:
                story.append(Spacer(1, 6))
                d = make_fig(); story.append(d)
                story.append(Paragraph("Figure 1: Illustrative population counts by region.", ST["Italic"]))
            if math and si == 2 and hi == 1:
                story.append(Paragraph("∑ᵢ wᵢ · ∂f/∂xᵢ ≈ ∫ φ(x) dx, with α, β, Δ ≥ 0 and ∀x ∈ Ω: ‖x‖ ≤ ε.", ParagraphStyle("m", parent=BODY, fontName="Helvetica", fontSize=11)))
        if table and si == len(sections):
            t = Table(table); t.setStyle(TableStyle([("GRID", (0,0), (-1,-1), 0.5, colors.grey), ("BACKGROUND", (0,0), (-1,0), colors.whitesmoke), ("FONTSIZE", (0,0), (-1,-1), 9)]))
            story.append(Spacer(1, 8)); story.append(Paragraph("Table 1: Comparative observations.", ST["Italic"])); story.append(t)
    doc.build(story)

def make_fig():
    from reportlab.graphics.shapes import Drawing, Rect, String
    d = Drawing(400, 120)
    for i, (label, v) in enumerate([("North", 80), ("South", 55), ("East", 95), ("West", 40)]):
        d.add(Rect(40 + i * 90, 20, 50, v, fillColor=colors.HexColor("#6366f1"), strokeColor=None))
        d.add(String(45 + i * 90, 8, label, fontSize=9))
    return d


# --- generator-original prose (no external text): a fictional naturalist survey.
# Deterministic sentence assembly — original content, so vision OCR of the derived
# scan cannot trip recitation guards the way famous book text does.
import random
def survey_paras(seed, n, topic):
    rng = random.Random(seed)
    regions = ["the northern moraine", "the tidal flats", "the eastern terraces", "the dry western basin", "the river margin"]
    subjects = ["seed-bearing grasses", "ground beetles", "shore birds", "lichen colonies", "burrowing rodents", "moth populations"]
    verbs = ["expanded", "declined", "held steady", "shifted upslope", "fragmented", "recovered"]
    causes = ["after the wet spring", "following the late frost", "under grazing pressure", "as the channel moved", "after the burn season", "with the new windbreaks"]
    obs = ["Counts were repeated on three mornings and averaged.", "Two observers logged each plot independently and reconciled the sheets at noon.",
           "Where the tallies disagreed by more than five, the plot was walked again.", "Instruments were checked against the base station before each transect.",
           "Plots that could not be reached safely were recorded as not surveyed rather than estimated.",
           "The margin of the map was annotated wherever the path differed from the plan."]
    out=[]
    for i in range(n):
        sents=[f"In {rng.choice(regions)}, {rng.choice(subjects)} {rng.choice(verbs)} {rng.choice(causes)}."]
        for _ in range(rng.randint(4,6)):
            sents.append(f"On the {rng.choice(['second','third','fourth','fifth'])} transect of the {topic} survey, {rng.choice(subjects)} {rng.choice(verbs)} {rng.choice(causes)}, and the change was {rng.choice(['gradual','abrupt','patchy','uniform'])} across {rng.choice(regions)}.")
            sents.append(rng.choice(obs))
        out.append(" ".join(sents))
    return out

origin = gutenberg(1228, "origin-1ed.txt")     # Darwin, Origin of Species, 1st ed (PD) — plants only
origin6 = gutenberg(2009, "origin-6ed.txt")    # Origin, 6th ed — heavily revised (PD): real revision pair
pride = gutenberg(1342, "pride.txt")           # Pride & Prejudice (PD): negative control

# 1. clean single-column textbook-style doc with headings/figure/table/math page
styled_doc(os.path.join(SEED, "seed-01-clean.pdf"), "Field Notes from the Halvorsen Survey",
  [("Survey Design", [("Overview", survey_paras(11, 4, "spring")), ("Plot Method", survey_paras(12, 4, "spring"))]),
   ("Observations by Region", [("Population Movement", survey_paras(13, 4, "summer")), ("Variation Between Plots", survey_paras(14, 4, "summer"))]),
   ("Sources of Error", [("", survey_paras(15, 5, "autumn"))])],
  table=[["Region", "Species observed", "Variants"], ["North", "128", "17"], ["South", "94", "9"], ["East", "142", "21"], ["West", "63", "5"]],
  fig=True, math=True)

# 2. two-column layout (complex class)
class TwoCol(BaseDocTemplate):
    def __init__(self, fn, **kw):
        super().__init__(fn, pagesize=letter, **kw)
        w = (letter[0] - 1.6 * inch - 0.4 * inch) / 2
        f1 = Frame(0.8 * inch, 0.8 * inch, w, letter[1] - 1.6 * inch, id="c1")
        f2 = Frame(0.8 * inch + w + 0.4 * inch, 0.8 * inch, w, letter[1] - 1.6 * inch, id="c2")
        self.addPageTemplates([PageTemplate(id="two", frames=[f1, f2])])
tc = TwoCol(os.path.join(SEED, "seed-02-twocol.pdf"), title="Instrument Notes, Two-Column Digest", pageCompression=0)
tcs = [Paragraph("Instrument Notes, Two-Column Digest", ST["Title"])]
for p in survey_paras(21, 20, "winter"): tcs.append(Paragraph(p, BODY))
tc.build(tcs)

# 3. slide deck (landscape, big fonts, sparse)
sd = SimpleDocTemplate(os.path.join(SEED, "seed-03-deck.pdf"), pagesize=landscape(letter), title="Field Survey Briefing", pageCompression=0)
big = ParagraphStyle("big", parent=ST["Title"], fontSize=34, leading=40)
bullet = ParagraphStyle("bl", parent=ST["Normal"], fontSize=20, leading=28, leftIndent=24, bulletIndent=8)
slides = [("Field Survey Briefing", ["Purpose of the survey", "Regions covered: North, South, East, West", "Methods and instruments"]),
          ("Key Observations", ["Variation increases under domestication", "Competition is strongest between close forms", "Rare species decline first"]),
          ("Next Steps", ["Extend the survey to coastal sites", "Standardize the counting protocol", "Publish the regional tables"])]
sst = []
for i, (t, bs) in enumerate(slides):
    if i: sst.append(PageBreak())
    sst.append(Paragraph(t, big)); sst.append(Spacer(1, 20))
    for b in bs: sst.append(Paragraph(f"• {b}", bullet))
sd.build(sst)

# 4. scanned: rasterize seed-01 at low DPI → image-only PDF (known ground truth)
subprocess.run(["pdftoppm", "-r", "110", "-gray", "-png", os.path.join(SEED, "seed-01-clean.pdf"), os.path.join(LOCAL, "scan")], check=True)
import img2pdf
pngs = sorted(f for f in os.listdir(LOCAL) if f.startswith("scan") and f.endswith(".png"))
with open(os.path.join(SEED, "seed-04-scan.pdf"), "wb") as f:
    f.write(img2pdf.convert([os.path.join(LOCAL, p) for p in pngs]))

# 5. near-duplicate of seed-01 (light deterministic edits + different styling)
def lightly_edit(ps):
    swaps = [("declined", "diminished"), ("expanded", "spread"), ("averaged", "pooled"), ("recorded", "noted"), ("survey", "census"), ("plots", "quadrats")]
    out = []
    for p in ps:
        for a, b in swaps: p = p.replace(a, b)
        out.append(p)
    return out
styled_doc(os.path.join(SEED, "seed-05-neardup.pdf"), "Field Notes from the Halvorsen Survey (Second Impression)",
  [("Survey Design", [("Overview", lightly_edit(survey_paras(11, 4, "spring"))), ("Plot Method", lightly_edit(survey_paras(12, 4, "spring")))]),
   ("Observations by Region", [("Population Movement", lightly_edit(survey_paras(13, 4, "summer"))), ("Variation Between Plots", lightly_edit(survey_paras(14, 4, "summer")))])])

# 6. related-but-differently-worded: the SAME topics from the heavily revised 6th edition
# related plant: the SAME fictional survey retold from a second phrase bank — the facts
# (seeded random draws) correspond; the vocabulary does not. Calibration finding recorded
# in the manifest: a substitution-only rewrite landed in the near-duplicate band, so the
# related plant is composed from an independent verbalizer instead.
def retold(seed, n):
    rng = random.Random(seed)  # same seeds → same underlying "facts"
    regions = {"the northern moraine":"the gravel ridge to the north","the tidal flats":"the mudbanks below the high-water line","the eastern terraces":"the stepped ground on the east side","the dry western basin":"the parched hollow westward","the river margin":"the banks along the watercourse"}
    subjects = {"seed-bearing grasses":"the grasses that set seed","ground beetles":"beetles living at soil level","shore birds":"waders along the shore","lichen colonies":"patches of lichen","burrowing rodents":"small digging mammals","moth populations":"the moths"}
    verbs = {"expanded":"took more ground","declined":"grew scarcer","held steady":"showed no real change","shifted upslope":"moved to higher ground","fragmented":"broke into scattered patches","recovered":"came back"}
    causes = {"after the wet spring":"once the rains of spring had passed","following the late frost":"in the wake of that late cold snap","under grazing pressure":"where livestock kept feeding","as the channel moved":"while the stream cut a new path","after the burn season":"once the burning had ended","with the new windbreaks":"behind the freshly planted shelter rows"}
    out=[]
    for i in range(n):
        r=rng.choice(list(regions)); sub=rng.choice(list(subjects)); v=rng.choice(list(verbs)); c=rng.choice(list(causes))
        sents=[f"Looking back over the season, {subjects[sub]} {verbs[v]} across {regions[r]} {causes[c]}."]
        for _ in range(rng.randint(3,4)):
            sub2=rng.choice(list(subjects)); v2=rng.choice(list(verbs)); c2=rng.choice(list(causes)); r2=rng.choice(list(regions))
            sents.append(f"Our walkers noted that {subjects[sub2]} {verbs[v2]} near {regions[r2]}, {causes[c2]}.")
            sents.append(rng.choice(["Numbers come from repeated morning walks, pooled.","Where two sheets differed badly the ground was walked a second time.","Anything unreachable was written down as not visited, never guessed."]))
        out.append(" ".join(sents))
    return out
styled_doc(os.path.join(SEED, "seed-06-related.pdf"), "Halvorsen Survey: Season Summary Report",
  [("How the Season Was Run", [("", retold(11, 3) + retold(12, 3))]),
   ("What the Regions Showed", [("", retold(13, 3) + retold(14, 3))])])

# 7. negative control: distant domain
styled_doc(os.path.join(SEED, "seed-07-negative.pdf"), "An Account of Country Society",
  [("First Impressions", [("", paras(pride, 0.05, 5))]), ("Visits and Conversations", [("", paras(pride, 0.15, 5))])])

# 8. corrupted xref (ingest fast-fail demo)
# NOTE (finding): the engine repairs damaged xrefs — a 35% truncation still opened with all
# pages. The genuine fast-fail boundary is "no recoverable page tree": header + 600 bytes.
raw = open(os.path.join(SEED, "seed-01-clean.pdf"), "rb").read()
open(os.path.join(SEED, "seed-08-corrupt.pdf"), "wb").write(b"%PDF-1.4\n" + raw[9:600])

# 9. password-protected (ingest fast-fail demo; password: demo)
r = PdfReader(os.path.join(SEED, "seed-01-clean.pdf")); w = PdfWriter()
for pg in r.pages: w.add_page(pg)
w.encrypt("demo")
with open(os.path.join(SEED, "seed-09-protected.pdf"), "wb") as f: w.write(f)

# drop the raw source-text caches: they are build inputs only, re-fetched on demand,
# and a full novel of text is exactly the kind of surface an outbound scan should not
# have to reason about.
for f in os.listdir(LOCAL):
    if f.endswith(".txt"): os.remove(os.path.join(LOCAL, f))
for f in sorted(os.listdir(SEED)):
    if f.endswith(".pdf"): print(f, os.path.getsize(os.path.join(SEED, f)))
