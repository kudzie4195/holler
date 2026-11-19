#!/usr/bin/env python3
"""Script-checkable items of the r8 design direction (section 6) plus the pass-2 rules. Run after make-screenshots.py:
    python3 store/check-screenshots.py
Reads store/screenshots/**, store/.gen/metrics.json and store/.gen/noring/* (written by make-screenshots.py). Prints a report and
exits 1 on a hard failure."""
import colorsys, json, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
OUT = HERE / "screenshots"
M = json.loads((HERE / ".gen/metrics.json").read_text())["shots"]
DATA = json.loads((HERE / ".gen/data.json").read_text())
FIX = {r["id"]: r for r in json.loads((HERE / "fixtures/real-signals.json").read_text())["rows"]}
NAMES = ["01-know-when", "02-storm-hail", "03-permits", "04-311", "05-source-link", "06-trade-radius", "07-push", "08-price"]
HEADS = {
    "01-know-when": "Storms, permits, 311 near you", "02-storm-hail": "Storm & hail alerts", "03-permits": "New permits near you",
    "04-311": "311 & city requests", "05-source-link": "See the official source", "06-trade-radius": "Your trades, your radius",
    "07-push": "Alerts that fit. No spam.", "08-price": "14 days free. Then $7.99/mo.", "android/08-price": "Flat monthly plans",
}
SUBS = {
    "01-know-when": "Alerts for roofers, plumbers, HVAC and more", "02-storm-hail": "Hail reports and storm warnings near you",
    "03-permits": "Plumbing, HVAC, windows and more", "04-311": "Tree emergencies and code requests",
    "05-source-link": "Every alert links to where it came from", "06-trade-radius": "Set trades and how far you drive",
    "07-push": "At most one push an hour", "08-price": "Free account first. No card. Subscribe later.",
    "android/08-price": "No per-lead fees. 14-day trial, no card.",
}
FEED_SHOTS = ["01-know-when", "02-storm-hail", "03-permits", "04-311", "07-push"]
SIZE = {"ios": (1320, 2868), "android": (1080, 1920)}
CONTENT_TOP = {"ios": 660, "android": 500}
HERO_MIN = {"ios": 64, "android": 52}
PUSH_MIN = {"ios": (56, 48), "android": (46, 40)}
RING_CLEAR = 12
fail = []


def lum(h):
    h = h.lstrip("#"); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def ratio(a, b):
    la, lb = sorted([lum(a), lum(b)], reverse=True)
    return (la + 0.05) / (lb + 0.05)


def key(plat, n):
    return f"{plat}/{n}"


def want(table, plat, n):
    return table.get(f"{plat}/{n}", table[n])


def check(ok, label):
    if not ok:
        fail.append(label)
    return "OK" if ok else "FAIL"


print("== 1. Files: size and mode")
for plat in ("ios", "android"):
    for n in NAMES:
        p = OUT / plat / f"{n}.png"
        im = Image.open(p)
        print(f"  {plat}/{n}.png {im.size[0]}x{im.size[1]} {im.mode} {check(im.size == SIZE[plat] and im.mode == 'RGB', f'size/mode {plat}/{n}')}")
for extra in ("contact-sheet.png", "thumb-strip.png"):
    im = Image.open(OUT / extra); print(f"  {extra} {im.size[0]}x{im.size[1]} {im.mode}")

print("\n== 2./3. Headlines and supporting lines (measured in Chrome at compose time); words per headline 2 to 5")
for plat in ("ios", "android"):
    for n in NAMES:
        m = M[key(plat, n)]["head"]
        h, s = want(HEADS, plat, n), want(SUBS, plat, n)
        words = len(m["text"].split())
        need = 150 if plat == "ios" else 120
        ok = (m["text"] == h and m["sub"] == s and m["headLines"] == 2 and m["headPx"] >= need and 2 <= words <= 5 and m["headFamily"].strip('"') == "Fraunces"
              and m["headWeight"] == "600" and m["subLines"] == 1 and len(s) <= 45 and abs(m["lineHeight"] / m["headPx"] - 1.06) < 0.01)
        print(f"  {plat}/{n}: '{m['text']}' words={words} lines={m['headLines']} {m['headPx']}px line-height {m['lineHeight'] / m['headPx']:.2f} | "
              f"'{m['sub']}' ({len(s)} chars) {m['subPx']}px lines={m['subLines']} {check(ok, f'headline {plat}/{n}')}")


def ink_rows(im, x0, x1, y0, y1, thr=90):
    a = np.asarray(im.convert("L").crop((x0, y0, x1, y1)), dtype=np.int16)
    return (a < thr).any(axis=1)


print("\n   Gap between the two headline lines, measured in the PNG: glyphs are connected components, each assigned to line 1 or 2 by its")
print("   centre; the number is the smallest vertical gap between a line-1 glyph and a line-2 glyph in the same pixel column")
for plat in ("ios", "android"):
    for n in NAMES:
        im = Image.open(OUT / plat / f"{n}.png")
        m = M[key(plat, n)]["head"]
        lh = m["lineHeight"]; top = m["headTop"]
        y0, y1 = int(top), int(top + 2 * lh)
        a = np.asarray(im.convert("L").crop((0, y0, SIZE[plat][0], y1)), dtype=np.int16) < 100
        lab, k = ndimage.label(a)
        centres = ndimage.center_of_mass(a, lab, range(1, k + 1))
        line_of = np.zeros(k + 1, dtype=np.int8)
        for i, (cy, cx) in enumerate(centres, start=1):
            line_of[i] = 1 if cy < lh else 2
        L = line_of[lab]; L[lab == 0] = 0
        gaps = []
        for x in range(a.shape[1]):
            r1 = np.nonzero(L[:, x] == 1)[0]; r2 = np.nonzero(L[:, x] == 2)[0]
            if len(r1) and len(r2):
                gaps.append(int(r2.min() - r1.max() - 1))
        g = min(gaps) if gaps else 999
        need = 8 if plat == "ios" else 6
        print(f"   {plat}/{n}: closest glyphs {g}px apart ({g * 115 / SIZE[plat][0]:.1f}px at 115 px wide) {check(g >= need, f'headline line gap {plat}/{n}')}")


def ink_bbox(im, x0, y0, x1, y1, ink=(0x19, 0x17, 0x14), tol=60):
    px = im.load(); ys = []; xs = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = px[x, y]
            if abs(r - ink[0]) + abs(g - ink[1]) + abs(b - ink[2]) < tol:
                ys.append(y); xs.append(x)
    return (min(xs), min(ys), max(xs), max(ys)) if ys else None


print("\n   Cap height measured in the PNG (first capital of the headline, flat-topped letters only):")
for plat, M0 in (("ios", 90), ("android", 72)):
    for n, letter in (("03-permits", "N"), ("06-trade-radius", "Y"), ("07-push", "A")):
        im = Image.open(OUT / plat / f"{n}.png").convert("RGB")
        top = M[key(plat, n)]["head"]["headTop"]; px = M[key(plat, n)]["head"]["headPx"]
        x = M0 - 4; seen = False; pxl = im.load(); line_h = int(px * 1.06)
        while x < M0 + px:
            col = any(sum(abs(a - b) for a, b in zip(pxl[x, y], (0x19, 0x17, 0x14))) < 60 for y in range(int(top), int(top + line_h)))
            if col: seen = True
            elif seen: break
            x += 1
        bb = ink_bbox(im, M0 - 4, int(top), x, int(top + line_h))
        cap = bb[3] - bb[1] + 1
        need = 105 if plat == "ios" else 84
        print(f"   {plat}/{n} '{letter}': cap height {cap}px (direction: cap >= {need}) {check(cap >= need - 1, f'cap {plat}/{n}')}")

print("\n== 4. 115 px test: see thumb-strip.png (iOS 1-3 at 115 and 230 px). Headline size at 115 px:")
for n in NAMES:
    px = M[f"ios/{n}"]["head"]["headPx"]
    print(f"   ios/{n}: headline {px * 115 / 1320:.1f}px type, cap {px * 0.703 * 115 / 1320:.1f}px at 115 px wide")

print(f"\n== P2-1. Content top: the first content block starts at {CONTENT_TOP['ios']} (iOS) / {CONTENT_TOP['android']} (Android) on every shot")
for plat in ("ios", "android"):
    for n in NAMES:
        m = M[key(plat, n)]
        im = np.asarray(Image.open(OUT / plat / f"{n}.png").convert("RGB"), dtype=np.int16)
        bg = im[5, 5]
        y = int(m["head"]["subBottom"]) + 4
        while y < im.shape[0] and (np.abs(im[y] - bg).sum(axis=1) <= 24).all():
            y += 1
        # a lifted card's 4 px outline (or a ring's stroke) is drawn just outside the content box
        ok = m["content_top"] == CONTENT_TOP[plat] and CONTENT_TOP[plat] - 6 <= y <= CONTENT_TOP[plat] + 1
        print(f"   {plat}/{n}: content_top={m['content_top']} first non-background row in the PNG y={y} {check(ok, f'content top {plat}/{n}')}")

print(f"\n== P2-2. Feed shots: hero card title >= {HERO_MIN['ios']} px (iOS) / {HERO_MIN['android']} px (Android); explainer sentence at most once, never on the hero")
for plat in ("ios", "android"):
    for n in FEED_SHOTS:
        m = M[key(plat, n)]
        ok = m["hero_title_px"] >= HERO_MIN[plat] and m["explainers"] <= 1 and not m.get("explainer_on_hero")
        lay = [(x["role"], x["title"][:34], x["title_px"], "explainer" if x["explainer_visible"] else "-") for x in m.get("layout", [])]
        print(f"   {plat}/{n}: hero title {m['hero_title_px']}px, explainers visible {m['explainers']}, layout {lay} {check(ok, f'hero/explainer {plat}/{n}')}")

print("\n== P2-3. Cards end at least 60 px above the bottom edge, or run off it with the edge between two lines")
for plat in ("ios", "android"):
    H = SIZE[plat][1]
    for n in ("01-know-when", "02-storm-hail", "03-permits", "04-311"):
        for x in M[key(plat, n)]["layout"]:
            ok = x["bottom"] <= H - 60 or (x.get("runs_off") and x["top"] < H)
            print(f"   {plat}/{n} {x['role']:7s} '{x['title'][:40]}': top {x['top']:.0f} bottom {x['bottom']:.0f} "
                  f"({'runs off' if x.get('runs_off') else f'{H - x['bottom']:.0f}px above the edge'}) {check(ok, f'card end {plat}/{n}')}")
print("   (pass 3: a card that runs off must be cut through a text-free part of its body: see P3-1)")


def ring_clearance(final, noring, box, stroke):
    """Exact smallest distance (px) from any ring pixel to any text pixel. Ring pixels: where the shipped PNG differs from the ring-less
    render. Text pixels: luminance below 100 on the ring-less render (ink 23, muted 88, tag inks 66 to 91; the accent orange is 122)."""
    X0, Y0, X1, Y1 = [int(round(v)) for v in box]
    a = np.asarray(Image.open(noring).convert("RGB"), dtype=np.int16); b = np.asarray(Image.open(final).convert("RGB"), dtype=np.int16)
    pad = 50
    y0, y1, x0, x1 = max(0, Y0 - pad), min(a.shape[0], Y1 + pad), max(0, X0 - pad), min(a.shape[1], X1 + pad)
    A, B = a[y0:y1, x0:x1], b[y0:y1, x0:x1]
    band = np.zeros(A.shape[:2], dtype=bool)
    band[Y0 - y0:Y1 - y0, X0 - x0:X1 - x0] = True
    band[Y0 - y0 + stroke + 2:Y1 - y0 - stroke - 2, X0 - x0 + stroke + 2:X1 - x0 - stroke - 2] = False
    ring = (np.abs(A - B).sum(axis=2) > 40) & band  # only differences inside the ring's own stroke band count as ring
    ink = (0.299 * A[..., 0] + 0.587 * A[..., 1] + 0.114 * A[..., 2]) < 100
    if not ring.any():
        return -1.0
    return float(ndimage.distance_transform_edt(~ring)[ink].min()) if ink.any() else 99.0


print(f"\n== P2-4. Ring clearance: every ring stroke is at least {RING_CLEAR} px from any text pixel, the ringed text included (exact: distance")
print("   transform between the ring's pixels and the text pixels of the ring-less render)")
for plat in ("ios", "android"):
    for n in NAMES:
        m = M[key(plat, n)]
        for r in m.get("rings", []):
            c = ring_clearance(OUT / plat / f"{n}.png", m["noring"], r["box"], r["stroke"])
            note = "" if r.get("first_choice", True) else " (fallback target)"
            print(f"   {plat}/{n}: {r['color']} ring ({r['stroke']}px) around {r['target']}{note} on {r['on']}: {c:.1f}px clear {check(c >= RING_CLEAR, f'ring clearance {plat}/{n}')}")


print("\n== P3-1. Bottom band: no text in the last 60 px of any file (text pixel = luminance < 100; columns inked over the whole band are")
print("   frame bezels and card outlines; pixels of the two stripe colours are not text either). Also: nearest text above the edge.")
for plat in ("ios", "android"):
    for n in NAMES:
        a = np.asarray(Image.open(OUT / plat / f"{n}.png").convert("RGB"), dtype=np.int16)
        L = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
        # card stripes (storm #2F6F8F, sage-mark #4F7D55) are not text; tag inks (storm-ink, sage-ink) are 45+ away from them
        stripe = np.zeros(L.shape, dtype=bool)
        for c in ((0x2F, 0x6F, 0x8F), (0x4F, 0x7D, 0x55)):
            stripe |= np.sqrt(((a - np.array(c)) ** 2).sum(axis=2)) < 30
        L = np.where(stripe, 255, L)
        band = L[-60:] < 100
        full = band.all(axis=0)
        text = band[:, ~full]
        rows = np.nonzero(text.any(axis=1))[0]
        # nearest text above the band, for the report
        up = L[:-60] < 100
        up = up[:, ~full]
        last = np.nonzero(up.any(axis=1))[0]
        gap = a.shape[0] - 1 - last[-1] if len(last) else None
        band_px = M[key(plat, n)].get("bottom_band") or 60
        if plat == "android" or band_px >= 60:
            ok = not len(rows)
            print(f"   {plat}/{n}: text pixels in the bottom 60 px: {int(text.sum())}; nearest text above the edge: {gap}px {check(ok, f'bottom band {plat}/{n}')}")
        else:
            # documented iOS fallback (shot 7): the edge falls between two lines; the last line's ink must still stay 8 px or more clear
            inkrows = np.nonzero((L[-band_px - 8:] < 100)[:, ~full].any(axis=1))[0]
            ok = not len(inkrows)
            print(f"   {plat}/{n}: iOS fallback band {band_px}px (60 px needs the frame far below the push card): ink in the last {band_px + 8} px: {len(inkrows)} rows {check(ok, f'bottom band {plat}/{n}')}")


print("\n== P2-5. Shot 7: push card text size and the bottom rows")
for plat in ("ios", "android"):
    p = M[key(plat, "07-push")]["push"]
    tmin, bmin = PUSH_MIN[plat]
    print(f"   {plat}: title '{p['text']['title']}' {p['title_px']}px (>= {tmin}), body '{p['text']['body']}' {p['body_px']}px (>= {bmin}) "
          f"{check(p['title_px'] >= tmin and p['body_px'] >= bmin, f'push size {plat}')}")
for plat in ("ios", "android"):
    for n in NAMES:
        a = np.asarray(Image.open(OUT / plat / f"{n}.png").convert("RGB"), dtype=np.int16)
        d = np.abs(a[-1] - a[-6]).sum(axis=1)
        white = ((a[-2:] == 255).all(axis=2)).all(axis=0).sum()
        ok = d.mean() < 12
        print(f"   {plat}/{n}: last row vs 5 rows up mean diff {d.mean():.1f}, pure-white columns in the last 2 rows {white} {check(ok, f'bottom rows {plat}/{n}')}")

print("\n== 5. UI text inside the images (CSS font size x scale on the canvas; title >= 54/44, others >= 40/33)")
for plat in ("ios", "android"):
    tmin, omin = (54, 40) if plat == "ios" else (44, 33)
    for n in NAMES:
        u = M[key(plat, n)].get("ui_px", {})
        title = u.get("title")
        low = {k: v for k, v in u.items() if k != "title" and v < omin}
        ok = (title is None or title >= tmin) and not low
        print(f"   {plat}/{n}: {u} {check(ok, f'ui size {plat}/{n}')}")

print("\n== 6./7. Bands of flat colour (rows with at most 3 distinct colours, longest run) and bottom-edge cuts")
for plat in ("ios", "android"):
    lim = 240 if plat == "ios" else 160
    for n in NAMES:
        im = Image.open(OUT / plat / f"{n}.png").convert("RGB")
        small = im.reduce(2); W, H = small.size; px = small.load()
        run = best = 0; best_at = 0
        for y in range(H):
            cols = {tuple(c // 6 for c in px[x, y]) for x in range(0, W, 2)}
            if len(cols) <= 3:
                run += 1
                if run > best: best, best_at = run, y
            else:
                run = 0
        band = best * 2
        cut = M[key(plat, n)].get("cut")
        print(f"   {plat}/{n}: longest flat band {band}px ending y={best_at * 2} (limit {lim}) {check(band <= lim, f'flat band {plat}/{n}')}; "
              f"bottom margin {M[key(plat, n)].get('bottom_margin')}; cut lines at bottom edge: {cut if cut else 'none'}")

print("\n== 8. Colour families per image (pixels with chroma >= 40/255, by hue): orange 0-45 deg, green 70-160, blue 170-250")
for plat in ("ios", "android"):
    for i, n in enumerate(NAMES):
        im = Image.open(OUT / plat / f"{n}.png").convert("RGB").reduce(3)
        fam = {"orange": 0, "green": 0, "blue": 0, "other": 0}; tot = 0
        for r, g, b in (im.get_flattened_data() if hasattr(im, 'get_flattened_data') else im.getdata()):
            tot += 1
            if max(r, g, b) - min(r, g, b) < 40: continue
            h = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)[0] * 360
            k = "orange" if h <= 45 or h >= 345 else "green" if 70 <= h <= 160 else "blue" if 170 <= h <= 250 else "other"
            fam[k] += 1
        bg = im.getpixel((5, 5))
        present = [k for k, v in fam.items() if v / tot > 0.0005 and k != "other"]
        hb = colorsys.rgb_to_hsv(*(c / 255 for c in bg))[0] * 360
        bgfam = "blue" if 170 <= hb <= 250 else "green" if 70 <= hb <= 160 else "orange"
        if bgfam not in present: present.append(bgfam)
        allowed = 3 if i == 0 else 2
        ok = len(present) <= allowed and fam["other"] / tot < 0.0005
        print(f"   {plat}/{n}: bg #{''.join(f'{c:02X}' for c in bg)} families={sorted(present)} pct={ {k: round(100 * v / tot, 2) for k, v in fam.items()} } {check(ok, f'colour {plat}/{n}')}")

print("\n== 9. Contrast pairs used (WCAG 2.x formula)")
PAIRS = [
    ("ink #191714", "#191714", "accent #E8590C", "#E8590C", 4.5, "shots 1, 8 headline + supporting line"),
    ("ink", "#191714", "sky-deep #C9DCE5", "#C9DCE5", 4.5, "shots 2, 6 headline"),
    ("muted #5C574F", "#5C574F", "sky-deep", "#C9DCE5", 4.5, "shots 2, 6 supporting line"),
    ("ink", "#191714", "sage-deep #D4E3CD", "#D4E3CD", 4.5, "shot 3 headline"),
    ("muted", "#5C574F", "sage-deep", "#D4E3CD", 4.5, "shot 3 supporting line"),
    ("ink", "#191714", "peach #F7D6BE", "#F7D6BE", 4.5, "shot 4 headline"),
    ("muted", "#5C574F", "peach", "#F7D6BE", 4.5, "shot 4 supporting line"),
    ("ink", "#191714", "paper #FAF6EE", "#FAF6EE", 4.5, "shot 5 headline; app text on --bg"),
    ("muted", "#5C574F", "paper", "#FAF6EE", 4.5, "shot 5 supporting line; app muted on --bg"),
    ("ink", "#191714", "sand #F3EBDD", "#F3EBDD", 4.5, "shot 7 headline; shot 8 trial banner text (app)"),
    ("muted", "#5C574F", "sand", "#F3EBDD", 4.5, "shot 7 supporting line"),
    ("accent-text #AD4205", "#AD4205", "sand", "#F3EBDD", 4.5, "shot 8 trial banner 'See plans' link (app)"),
    ("ink", "#191714", "white", "#FFFFFF", 4.5, "push card (shot 7), app card text"),
    ("storm-ink #1F4A63", "#1F4A63", "sky #DDE8EC", "#DDE8EC", 4.5, "app weather tag"),
    ("sage-ink #3B5A40", "#3B5A40", "sage #E7EDE3", "#E7EDE3", 4.5, "app permit tag"),
    ("accent-text #AD4205", "#AD4205", "accent-soft #FBE8D8", "#FBE8D8", 4.5, "app 311/code tag"),
    ("ink", "#191714", "accent", "#E8590C", 4.5, "app primary buttons, selected chips"),
    ("muted", "#5C574F", "white", "#FFFFFF", 4.5, "app intent label and explainer, feedback question"),
    ("accent-text", "#AD4205", "white", "#FFFFFF", 4.5, "app Refresh / Back / links"),
    ("storm #2F6F8F (non-text)", "#2F6F8F", "white", "#FFFFFF", 3.0, "weather stripe"),
    ("sage-mark #4F7D55 (non-text)", "#4F7D55", "white", "#FFFFFF", 3.0, "permit stripe"),
    ("accent (non-text)", "#E8590C", "white", "#FFFFFF", 3.0, "civic stripe; accent rings on white cards (2, 3, 4, android 8)"),
    ("accent (non-text)", "#E8590C", "paper", "#FAF6EE", 3.0, "accent ring on app paper (6); focus ring"),
    ("ink (non-text)", "#191714", "white", "#FFFFFF", 3.0, "ink ring (5), card outlines"),
    ("ink (non-text)", "#191714", "accent", "#E8590C", 3.0, "ink ring (iOS 8), outlines and phone bezel on orange (1, 8)"),
]
for a, ah, b, bh, need, use in PAIRS:
    r = ratio(ah, bh)
    print(f"   {a:30s} on {b:22s} {r:5.2f}:1 (need {need}) {check(r >= need, f'contrast {a}/{b}')}  [{use}]")
for a, ah, b, bh in (("muted", "#5C574F", "accent", "#E8590C"), ("white", "#FFFFFF", "accent", "#E8590C"), ("accent-text", "#AD4205", "peach", "#F7D6BE")):
    print(f"   forbidden pair {a} on {b}: {ratio(ah, bh):.2f}:1 (not used)")

print("\n== 10. Facts: one member per shot, every record real, inside the radius, with a distance")
print(f"   push (buildNotification for {DATA['push']['signalId']}, city Chicago): title={DATA['push']['title']!r} body={DATA['push']['body']!r}")
for plat in ("ios", "android"):
    for n in NAMES:
        m = M[key(plat, n)]
        recs = m.get("records") or []
        prof = m.get("profile")
        bad = []
        for sid, title, dist in recs:
            row = FIX.get(sid)
            if not row or (title != "push text" and row["title"] != title):
                bad.append(sid)
            if title != "push text" and (dist is None or not dist.endswith("mi away")):
                bad.append(sid)
            if prof and row and row["state"] != prof["state"]:
                bad.append(sid)
        where = f"{prof['zip']} {prof['city']}, {prof['state']} r{prof['radiusMi']} {'+'.join(prof['trades'])}" if prof else "no records"
        print(f"   {plat}/{n}: [{where}] {[(s, t[:44], d) for s, t, d in recs]} {check(not bad, f'records {plat}/{n} {bad}')}")
for plat in ("ios", "android"):
    m = M[key(plat, "08-price")]
    ok = "$7.99 a month" in m["plan_text"] and "Subscribe to Solo" in m["plan_text"] and "free trial" not in m["plan_text"].lower() and m["pro_shown"] in ("labelled", "cropped out")
    print(f"   {plat}/08 Solo card: {m['plan_text']!r}; Pro card {m['pro_shown']}; banner: {m.get('banner_text')!r} {check(ok, f'plans {plat}')}")
ok = M["ios/08-price"]["banner_text"].startswith("14 days left in your free trial.")
print(f"   ios/08 ringed trial surface is the Feed banner for a new account: {check(ok, 'trial banner')}")

print("\nHARD FAILURES:", fail if fail else "none")
sys.exit(1 if fail else 0)
