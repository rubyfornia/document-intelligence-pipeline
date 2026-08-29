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
    doc = SimpleDocTemplate(path, pagesize=letter, title=title)
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

origin = gutenberg(1228, "origin-1ed.txt")     # Darwin, Origin of Species, 1st ed (PD)
origin6 = gutenberg(2009, "origin-6ed.txt")    # Origin, 6th ed — heavily revised (PD): real revision pair
pride = gutenberg(1342, "pride.txt")           # Pride & Prejudice (PD): negative control

# 1. clean single-column textbook-style doc with headings/figure/table/math page
styled_doc(os.path.join(SEED, "seed-01-clean.pdf"), "Notes on the Struggle for Existence",
  [("The Struggle for Existence", [("Overview", paras(origin, 0.22, 4)), ("Competition", paras(origin, 0.26, 4))]),
   ("Natural Selection", [("Mechanism", paras(origin, 0.33, 4)), ("Variation", paras(origin, 0.37, 4))]),
   ("Circumstances Favourable", [("", paras(origin, 0.41, 5))])],
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
tc = TwoCol(os.path.join(SEED, "seed-02-twocol.pdf"), title="On the Laws of Variation")
tcs = [Paragraph("On the Laws of Variation", ST["Title"])]
for p in paras(origin, 0.5, 22): tcs.append(Paragraph(p, BODY))
tc.build(tcs)

# 3. slide deck (landscape, big fonts, sparse)
sd = SimpleDocTemplate(os.path.join(SEED, "seed-03-deck.pdf"), pagesize=landscape(letter), title="Field Survey Briefing")
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
    swaps = [("great", "considerable"), ("very", "quite"), ("many", "numerous"), ("often", "frequently"), ("plants", "flora"), ("animals", "fauna")]
    out = []
    for p in ps:
        for a, b in swaps: p = p.replace(a, b)
        out.append(p)
    return out
styled_doc(os.path.join(SEED, "seed-05-neardup.pdf"), "Notes on the Struggle for Existence (Second Impression)",
  [("The Struggle for Existence", [("Overview", lightly_edit(paras(origin, 0.22, 4))), ("Competition", lightly_edit(paras(origin, 0.26, 4)))]),
   ("Natural Selection", [("Mechanism", lightly_edit(paras(origin, 0.33, 4))), ("Variation", lightly_edit(paras(origin, 0.37, 4)))])])

# 6. related-but-differently-worded: the SAME topics from the heavily revised 6th edition
styled_doc(os.path.join(SEED, "seed-06-related.pdf"), "Struggle and Selection, Revised",
  [("The Struggle for Existence", [("", paras(origin6, 0.20, 6))]),
   ("Natural Selection; or the Survival of the Fittest", [("", paras(origin6, 0.30, 6))])])

# 7. negative control: distant domain
styled_doc(os.path.join(SEED, "seed-07-negative.pdf"), "An Account of Country Society",
  [("First Impressions", [("", paras(pride, 0.05, 5))]), ("Visits and Conversations", [("", paras(pride, 0.15, 5))])])

# 8. corrupted xref (ingest fast-fail demo)
raw = open(os.path.join(SEED, "seed-01-clean.pdf"), "rb").read()
open(os.path.join(SEED, "seed-08-corrupt.pdf"), "wb").write(raw[: int(len(raw) * 0.6)].replace(b"xref", b"xrfe", 1))

# 9. password-protected (ingest fast-fail demo; password: demo)
r = PdfReader(os.path.join(SEED, "seed-01-clean.pdf")); w = PdfWriter()
for pg in r.pages: w.add_page(pg)
w.encrypt("demo")
with open(os.path.join(SEED, "seed-09-protected.pdf"), "wb") as f: w.write(f)

for f in sorted(os.listdir(SEED)):
    if f.endswith(".pdf"): print(f, os.path.getsize(os.path.join(SEED, f)))
