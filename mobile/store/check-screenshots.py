#!/usr/bin/env python3
"""The judgment-free gate for the store screenshots (round 10). Run after make-screenshots.py, from mobile/:
    python3 store/check-screenshots.py
Every number below is measured in the PNG files themselves where the PNG can tell it (sizes, mode, text position, cap height, margins,
background colours, lime and orange pixels, the frame and its share of the canvas). Text strings, the records on each hero and the
compose-time layout come from store/.gen/metrics.json (written by make-screenshots.py in Chrome) and are checked against the fixture,
the served data and the web lib files. Prints a report; exits 1 on any failure."""
import colorsys, json, re, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
OUT = HERE / "screenshots"
MET = json.loads((HERE / ".gen/metrics.json").read_text())
M = MET["shots"]
GRID = MET["grid"]
DATA = json.loads((HERE / ".gen/data.json").read_text())
FX = json.loads((HERE / "fixtures/real-signals.json").read_text())
ROWS = {r["id"]: r for r in FX["rows"]}
PLATS = ("ios", "android")
SIZE = {"ios": (1320, 2868), "android": (1080, 1920)}
EDGE = {"ios": 64, "android": 52}
MAX_BYTES = 8 * 1024 * 1024
TOKENS = {"green": "#1E3A2C", "paper": "#F5F4EF"}
LIME = (0xD9, 0xF0, 0x46)
BANNED = ["seamless", "robust", "unlock", "elevate", "effortless", "game-changer", "game changer", "revolutionary", "supercharge",
          "leverage", "best-in-class", "world-class", "cutting-edge", "next-level", "guaranteed", "guarantee", "#1", "new!", "leads"]
fail = []


def check(ok, label):
    if not ok:
        fail.append(label)
    return "OK" if ok else "FAIL"


def hexrgb(h):
    h = h.lstrip("#"); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lum(rgb):
    c = [x / 255 for x in rgb]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def ratio(a, b):
    la, lb = sorted([lum(a), lum(b)], reverse=True)
    return (la + 0.05) / (lb + 0.05)


def load(plat, n):
    return np.asarray(Image.open(OUT / plat / f"{n}.png").convert("RGB"), dtype=np.int16)


def runs(mask_rows):
    """[(start, end_exclusive)] of consecutive True rows."""
    out = []; start = None
    for i, v in enumerate(mask_rows):
        if v and start is None: start = i
        if not v and start is not None: out.append((start, i)); start = None
    if start is not None: out.append((start, len(mask_rows)))
    return out


# ---------------------------------------------------------------- 1. files ------------------------------------------------------------
print("== 1. Files: exact names, count per platform 5 to 7, size, RGB without alpha, under 8 MB; old names gone")
names = {plat: sorted(k.split("/", 1)[1] for k in M if k.startswith(plat + "/")) for plat in PLATS}
for plat in PLATS:
    on_disk = sorted(p.stem for p in (OUT / plat).glob("*"))
    print(f"  {plat}: made {names[plat]}; on disk {on_disk} "
          f"{check(on_disk == names[plat] and 5 <= len(on_disk) <= 7, f'file set {plat}')}")
    for n in names[plat]:
        p = OUT / plat / f"{n}.png"
        im = Image.open(p)
        b = p.stat().st_size
        ok = im.format == "PNG" and im.size == SIZE[plat] and im.mode == "RGB" and "transparency" not in im.info and b < MAX_BYTES
        print(f"    {plat}/{n}.png {im.format} {im.size[0]}x{im.size[1]} {im.mode} {b / 1e6:.2f} MB {check(ok, f'file {plat}/{n}')}")
print(f"  same shots on both platforms: {check(names['ios'] == names['android'], 'same names')}")
legacy = ["01-know-when", "02-storm-hail", "03-permits", "04-311", "05-source-link", "06-trade-radius", "07-push", "08-price"]
left = [f"{plat}/{n}" for plat in PLATS for n in legacy if (OUT / plat / f"{n}.png").exists() and n not in names[plat]]
print(f"  old file names still present: {left or 'none'} {check(not left, 'old files')}")
for extra in ("contact-sheet.png", "thumb-strip.png"):
    ok = (OUT / extra).exists()
    print(f"  {extra}: {Image.open(OUT / extra).size if ok else 'missing'} {check(ok, extra)}")

# ---------------------------------------------------------------- 2. the drawn text, measured ----------------------------------------
print("\n== 2. Drawn text measured in the PNG (text pixel = differs from the background by more than 60 in RGB sum, above the hero)")
meas = {}
for plat in PLATS:
    g = GRID[plat]; W, H = SIZE[plat]
    for n in names[plat]:
        a = load(plat, n); m = M[f"{plat}/{n}"]
        bg = np.array(hexrgb(m["bg_hex"]))
        hero_top = int(m["hero"]["box"][1])
        head = a[:hero_top - 4]
        txt = np.abs(head - bg).sum(axis=2) > 60
        rr = runs(txt.any(axis=1))
        ys, xs = np.nonzero(txt)
        bands = rr
        info = dict(runs=bands, x0=int(xs.min()), x1=int(xs.max()), y0=int(ys.min()))
        # line bands: eyebrow, headline line 1, headline line 2, supporting line
        if len(bands) == 4:
            e, h1, h2, s = bands
            lab, k = ndimage.label(txt[h1[0]:h1[1]])
            sl = ndimage.find_objects(lab)
            hs = sorted(q[0].stop - q[0].start for q in sl)
            cap = int(np.median([x for x in hs if x >= 0.6 * max(hs)]))
            tops = [q[0].start + h1[0] for q in sl if abs((q[0].stop - q[0].start) - cap) <= 2]
            def baseline(band):  # median bottom row of the glyphs in a band: the text baseline (descenders and "$" do not move it)
                lb, kk = ndimage.label(txt[band[0]:band[1]])
                return int(np.median([q[0].stop for q in ndimage.find_objects(lb)])) + band[0]
            info.update(eyebrow=e, h1=h1, h2=h2, sub=s, cap=cap, cap_top=int(np.median(tops)),
                        base=dict(eyebrow=baseline(e), h1=baseline(h1), h2=baseline(h2), sub=baseline(s)),
                        eyebrow_x0=int(np.nonzero(txt[e[0]:e[1]].any(axis=0))[0].min()),
                        head_x0=int(np.nonzero(txt[h1[0]:h2[1]].any(axis=0))[0].min()),
                        sub_x0=int(np.nonzero(txt[s[0]:s[1]].any(axis=0))[0].min()))
        meas[(plat, n)] = info
        ok = len(bands) == 4
        print(f"  {plat}/{n}: {len(bands)} text bands (eyebrow, two headline lines, one supporting line) {bands} {check(ok, f'text bands {plat}/{n}')}")

print("\n   Headline cap height and cap top (median connected component of line 1) and the baseline of every text line (median glyph")
print("   bottom), each the same within 2 px across the set")
for plat in PLATS:
    caps = {n: meas[(plat, n)].get("cap") for n in names[plat]}
    tops = {n: meas[(plat, n)].get("cap_top") for n in names[plat]}
    ok = None not in caps.values() and max(caps.values()) - min(caps.values()) <= 2 and max(tops.values()) - min(tops.values()) <= 2
    print(f"   {plat}: cap heights {caps}; cap tops {tops} {check(ok, f'headline cap {plat}')}")
    for part, label in (("eyebrow", "eyebrow baseline"), ("h1", "headline line 1 baseline"), ("h2", "headline line 2 baseline"), ("sub", "supporting line baseline")):
        d = {n: meas[(plat, n)]["base"][part] for n in names[plat] if "base" in meas[(plat, n)]}
        ok = len(d) == len(names[plat]) and max(d.values()) - min(d.values()) <= 2
        print(f"   {plat}: {label} {d} {check(ok, f'{label} {plat}')}")

print("\n   Left margin: eyebrow ink (every eyebrow starts with the digit 0) identical; headline and supporting line ink within the first")
print("   letter's side bearing of the margin; text box left in Chrome exactly the margin")
for plat in PLATS:
    g = GRID[plat]
    ex = {n: meas[(plat, n)].get("eyebrow_x0") for n in names[plat]}
    hx = {n: meas[(plat, n)].get("head_x0") for n in names[plat]}
    sx = {n: meas[(plat, n)].get("sub_x0") for n in names[plat]}
    box = {n: (M[f"{plat}/{n}"]["layout"]["head"]["x0"], M[f"{plat}/{n}"]["layout"]["sub"]["x0"], M[f"{plat}/{n}"]["layout"]["eyebrow"]["x0"]) for n in names[plat]}
    ok = (len(set(ex.values())) == 1 and all(g["M"] <= v <= g["M"] + 16 for v in hx.values()) and all(g["M"] <= v <= g["M"] + 10 for v in sx.values())
          and all(b == (g["M"], g["M"], g["M"]) for b in box.values()))
    print(f"   {plat}: margin {g['M']}; eyebrow ink x {ex}; headline ink x {hx}; supporting ink x {sx} {check(ok, f'left margin {plat}')}")

print(f"\n   Drawn text distance from every edge (iOS >= {EDGE['ios']} px, Android >= {EDGE['android']} px)")
for plat in PLATS:
    W, H = SIZE[plat]
    for n in names[plat]:
        i = meas[(plat, n)]
        d = dict(left=i["x0"], right=W - 1 - i["x1"], top=i["y0"])
        print(f"   {plat}/{n}: {d} {check(min(d.values()) >= EDGE[plat], f'text edge {plat}/{n}')}")

# ---------------------------------------------------------------- 3. colour ----------------------------------------------------------
print("\n== 3. Colour")
print("   Contrast of drawn text (WCAG 2.x) against the background measured in the PNG; the text colour is the most common text pixel")
print("   colour of each band, which must equal the token (within 12)")
for plat in PLATS:
    for n in names[plat]:
        a = load(plat, n); m = M[f"{plat}/{n}"]; i = meas[(plat, n)]
        bg = tuple(int(v) for v in a[8, 8])
        out = []
        ok_all = True
        for part, band, need in (("eyebrow", i.get("eyebrow"), 4.5), ("head", i.get("h1"), 3.0), ("sub", i.get("sub"), 4.5)):
            if not band:
                ok_all = False; continue
            reg = a[band[0]:band[1]].reshape(-1, 3)
            reg = reg[np.abs(reg - np.array(bg)).sum(axis=1) > 60]
            vals, cnt = np.unique(reg, axis=0, return_counts=True)
            col = tuple(int(v) for v in vals[cnt.argmax()])
            tok = hexrgb(m["colors"][part])
            r = ratio(col, bg)
            ok = sum(abs(p - q) for p, q in zip(col, tok)) <= 12 and r >= need
            ok_all &= ok
            out.append(f"{part} #{''.join(f'{c:02X}' for c in col)} {r:.2f}:1 (need {need})")
        print(f"   {plat}/{n} on #{''.join(f'{c:02X}' for c in bg)}: {'; '.join(out)} {check(ok_all, f'contrast {plat}/{n}')}")

print("\n   Background colours across the set (four corners of each image and the gap between text and hero), at most two, each a token")
seen = set()
for plat in PLATS:
    W, H = SIZE[plat]
    for n in names[plat]:
        a = load(plat, n); m = M[f"{plat}/{n}"]
        ht = int(m["hero"]["box"][1])
        pts = [(4, 4), (W - 5, 4), (4, H - 5), (W - 5, H - 5), (W // 2, ht - 20), (4, ht + 300)]
        cols = {"#" + "".join(f"{int(c):02X}" for c in a[y, x]) for x, y in pts}
        seen |= cols
        ok = len(cols) == 1 and cols <= set(TOKENS.values())
        print(f"   {plat}/{n}: {sorted(cols)} {check(ok, f'flat background {plat}/{n}')}")
print(f"   set: {sorted(seen)} {check(len(seen) <= 2 and seen <= set(TOKENS.values()), 'two backgrounds at most')}")

print("\n   Lime #D9F046 (pixels within 60 of it): never drawn text on paper, never a large fill; largest cluster at most 0.5% of the canvas")
for plat in PLATS:
    W, H = SIZE[plat]
    for n in names[plat]:
        a = load(plat, n); m = M[f"{plat}/{n}"]
        lime = np.abs(a - np.array(LIME)).sum(axis=2) < 60
        lab, k = ndimage.label(lime)
        big = int(np.bincount(lab.ravel())[1:].max()) if k else 0
        ht = int(m["hero"]["box"][1])
        head_lime = int(lime[:ht].sum())
        paper = m["bg"] == "paper"
        ok = big <= 0.005 * W * H and lime.sum() <= 0.01 * W * H and not (paper and head_lime)
        # on paper canvases, lime may not touch the canvas background at all
        if paper:
            bgm = np.abs(a - np.array(hexrgb(TOKENS["paper"]))).sum(axis=2) == 0
            ok &= not (ndimage.binary_dilation(lime, iterations=2) & bgm).any()
        print(f"   {plat}/{n} ({m['bg']}): lime px {int(lime.sum())} ({100 * lime.sum() / (W * H):.3f}%), largest cluster {big} px, in the drawn text {head_lime} px "
              f"{check(ok, f'lime {plat}/{n}')}")

print("\n   Orange (hue 10 to 32 deg, saturation and value >= 0.6, the old #E8590C family): no cluster larger than 4 px")
for plat in PLATS:
    for n in names[plat]:
        a = load(plat, n).astype(np.float32) / 255
        mx = a.max(axis=2); mn = a.min(axis=2); d = mx - mn
        sat = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
        r, g_, b = a[..., 0], a[..., 1], a[..., 2]
        hue = np.zeros_like(mx)
        mr = (mx == r) & (d > 0)
        hue[mr] = (60 * ((g_[mr] - b[mr]) / d[mr])) % 360
        orange = mr & (hue >= 10) & (hue <= 32) & (sat >= 0.6) & (mx >= 0.6)
        lab, k = ndimage.label(orange)
        big = int(np.bincount(lab.ravel())[1:].max()) if k else 0
        print(f"   {plat}/{n}: orange px {int(orange.sum())}, largest cluster {big} {check(big <= 4, f'orange {plat}/{n}')}")

# ---------------------------------------------------------------- 4. the hero and the grid --------------------------------------------
print("\n== 4. Hero: the phone frame found in the PNG (ink #14201A bezel); same box on every shot; share of the canvas >= 45%")
INK = np.array(hexrgb("#14201A"))
for plat in PLATS:
    W, H = SIZE[plat]; g = GRID[plat]
    boxes = {}
    for n in names[plat]:
        a = load(plat, n)
        ink = np.abs(a - INK).sum(axis=2) <= 6
        y = H - 200
        xs = np.nonzero(ink[y])[0]
        left, right = int(xs.min()), int(xs.max())
        col = np.nonzero(ink[:, W // 2])[0]
        top = int(col[col > meas[(plat, n)]["sub"][1]].min()) if "sub" in meas[(plat, n)] else -1
        bez_l = int(np.argmax(~ink[y, left:])) ; bez_r = int(np.argmax(~ink[y, :right + 1][::-1]))
        bez_t = int(np.argmax(~ink[top:, W // 2]))
        share = (right - left + 1) * (H - top) / (W * H)
        boxes[n] = (left, right, top, bez_l, bez_r, bez_t)
        ok = left == g["M"] and right == W - g["M"] - 1 and top == g["hero_top"] and bez_l == bez_r == bez_t == g["bezel"] and share >= 0.45
        print(f"   {plat}/{n}: frame x {left}..{right}, top {top}, bezels left/right/top {bez_l}/{bez_r}/{bez_t}, share {100 * share:.1f}% "
              f"{check(ok, f'frame {plat}/{n}')}")
    print(f"   {plat}: one box for the whole set {check(len(set(boxes.values())) == 1, f'grid {plat}')}")
    print(f"   {plat}: no status bar drawn: the screen starts with the app's own top bar (checked by the record test below: app text only)")

print("\n   Whole paragraphs at the canvas edge and under the top bar: no text block has lines on both sides of the edge (metrics from")
print("   the DOM at capture), and the first line in the scroller is whole")
for plat in PLATS:
    for n in names[plat]:
        h = M[f"{plat}/{n}"]["hero"]
        print(f"   {plat}/{n}: blocks split by the bottom edge {h['split_at_edge']}; first line '{h['first_in_scroll']}' {check(not h['split_at_edge'], f'split paragraph {plat}/{n}')}")

print("\n   App text size on the canvas (smallest visible text, CSS size x scale): iOS >= 34 px, Android >= 28 px")
for plat in PLATS:
    for n in names[plat]:
        h = M[f"{plat}/{n}"]["hero"]
        need = 34 if plat == "ios" else 28
        print(f"   {plat}/{n}: {h['min_font_px']} px at scale {h['scale']:.3f} (viewport {h['vw']} CSS px, scrolled {h['scrolled']} px, "
              f"edge {h['edge_clear_css']} CSS px from the nearest line) {check(h['min_font_px'] >= need and h['edge_clear_css'] >= 2, f'app text {plat}/{n}')}")

# ---------------------------------------------------------------- 5. truth ----------------------------------------------------------
print("\n== 5. Every hero record is a real fixture row served to that shot's member, with the distance the server's matchOne gave")
for plat in PLATS:
    for n in names[plat]:
        h = M[f"{plat}/{n}"]["hero"]; feed = h.get("feed")
        bad = []
        for r in h["records"]:
            row = ROWS.get(r["signalId"])
            sc = FX["scenarios"].get(feed, {})
            served = {i["signalId"]: i for i in DATA["feeds"].get(feed, [])}
            if not row or row["title"] != r["title"] or r["signalId"] not in sc.get("ids", []) or r["signalId"] not in served:
                bad.append((r["signalId"], "not the fixture row of this member"))
            elif r["distance"] != served[r["signalId"]]["distanceLabel"] or r["distance"] != DATA["distances"][feed][str(r["signalId"])]:
                bad.append((r["signalId"], "distance differs from the served one"))
            if r["title"] not in h["screen_text"]:
                bad.append((r["signalId"], "title not on the screen"))
        alert_titles = {r["title"] for r in FX["rows"]}
        # any record title on screen must be one of the listed records (nothing unlisted)
        stray = [t for t in h["screen_text"] if t in alert_titles and t not in {r["title"] for r in h["records"]}]
        prof = DATA["profiles"].get(feed) if feed else None
        where = f"{prof['zip']} {prof['city']}, {prof['state']} r{prof['radiusMi']} {'+'.join(prof['trades'])}" if prof else "no records on this screen"
        ok = not bad and not stray
        print(f"   {plat}/{n}: [{where}] {[(r['signalId'], r['title'][:46], r['distance']) for r in h['records']]} {check(ok, f'records {plat}/{n} {bad} {stray}')}")

# shot-specific facts
FACT = {}
plans = (REPO / "lib/stripe/plans.ts").read_text()
solo_cents = int(re.search(r"PRICES_CENTS[^=]*=\s*\{\s*starter:\s*\{\s*monthly:\s*(\d+)", plans).group(1))
trial = int(re.search(r"export const TRIAL_DAYS = (\d+);", (REPO / "lib/auth/membership.ts").read_text()).group(1))
d, c = divmod(solo_cents, 100)
solo_price = f"${d}" if c == 0 else f"${d}.{c:02d}"
print(f"\n   lib facts read now: Solo monthly {solo_price} (lib/stripe/plans.ts PRICES_CENTS), trial {trial} days (lib/auth/membership.ts TRIAL_DAYS)")
for plat in PLATS:
    for n in names[plat]:
        h = M[f"{plat}/{n}"]["hero"]; t = M[f"{plat}/{n}"]["text"]
        if n.startswith("03"):
            f = h["form"]; prof = DATA["profiles"][h["profile_key"]]
            labels = {x["id"]: x["label"] for x in DATA["config"]["trades"]}
            ok = (f and f["zip"] == prof["zip"] and int(f["radius"]) == prof["radiusMi"] and f["pickedVisible"] == [labels[x] for x in prof["trades"]]
                  and h["first_in_scroll"] == "Home and property")
            print(f"   {plat}/{n}: first line in the scroller '{h['first_in_scroll']}'; ticked trades in view {f['pickedVisible']} "
                  f"(member {h['profile_key']}: {prof['zip']} r{prof['radiusMi']} {prof['trades']}; the form holds ZIP {f['zip']}, {f['radius']} mi) "
                  f"{check(ok, f'trade picker {plat}/{n}')}")
        if n.startswith("04"):
            ok = any(s.startswith("Open the source") for s in h["screen_text"]) and not any("source record" in s.lower() or "official" in s.lower() for s in h["screen_text"])
            print(f"   {plat}/{n}: the button reads {[s for s in h['screen_text'] if s.startswith('Open the')]} {check(ok, f'source button {plat}/{n}')}")
        if n.startswith("05"):
            sw = {x["label"]: x["on"] for x in h["switches"]}
            ok = sw == {"Push notifications": True, "Email digest": True} and not any(t in ("Sign out", "Delete account") for t in h["screen_text"])
            print(f"   {plat}/{n}: Settings switches in view {sw}; no Sign out / Delete account on screen {check(ok, f'alert settings {plat}/{n}')}")
        if n.startswith("06"):
            body = " ".join(h["screen_text"])
            drawn = " ".join(t["head"]) + " " + t["sub"]
            if plat == "ios":
                ok = f"{trial} days free" in drawn.lower() and solo_price in t["sub"] and solo_price in body
                print(f"   ios/{n}: drawn '{drawn}' states trial {trial} and Solo {solo_price}, both from lib; the Plans screen shows {solo_price}: {check(ok, 'ios price facts')}")
            else:
                print(f"   android/{n}: Plans screen shows {solo_price}: {check(solo_price in body, 'android plans screen')}")

# ---------------------------------------------------------------- 6. words ----------------------------------------------------------
print("\n== 6. Drawn text: wording rules")
for plat in PLATS:
    for n in names[plat]:
        t = M[f"{plat}/{n}"]["text"]
        drawn = [t["eyebrow"], *t["head"], t["sub"]]
        s = " ".join(drawn)
        words_head = len(" ".join(t["head"]).split()); words_sub = len(t["sub"].split())
        probs = []
        if "—" in s: probs.append("em dash")
        probs += [w for w in BANNED if re.search(r"(?<![a-z])" + re.escape(w) + r"(?![a-z])", s.lower())]
        if plat == "android" and (re.search(r"[$€£]|\d+\.\d\d", s) or re.search(r"\bfree\b", s.lower())):
            probs.append("price or 'free' on Android")
        # digits: only the eyebrow index, or the lib facts on the iOS price shot
        digits = re.findall(r"\d+(?:\.\d+)?", " ".join(drawn[1:]))
        allowed = {str(trial), solo_price.lstrip("$"), "311"}
        if any(x not in allowed for x in digits):
            probs.append(f"number not from lib: {digits}")
        if not (2 <= words_head <= 6 and words_sub <= 8): probs.append(f"length head {words_head} words, sub {words_sub} words")
        if t["eyebrow"] != f"{names[plat].index(n) + 1:02d} / {len(names[plat]):02d}": probs.append("eyebrow is not the counter")
        fam = M[f"{plat}/{n}"]["layout"]
        if "Barlow Condensed" not in fam["head"]["family"] or fam["head"]["weight"] != "700" or "Inter" not in fam["sub"]["family"] or "JetBrains Mono" not in fam["eyebrow"]["family"]:
            probs.append("fonts")
        print(f"   {plat}/{n}: '{t['eyebrow']}' | '{' / '.join(t['head'])}' ({words_head} words) | '{t['sub']}' ({words_sub} words) {check(not probs, f'words {plat}/{n} {probs}')}")

print("\n   make-screenshots.py holds no literal price, trial length or plan limit")
src = (HERE / "make-screenshots.py").read_text()
lits = set()
for p in DATA["config"]["plans"].values():
    for per in ("monthly", "yearly"):
        lits |= {p[per]["display"], p[per]["display"].lstrip("$"), str(p[per]["cents"])}
    lits |= {f"{v} {k}" for k, v in (p.get("limits") or {}).items()}
found = sorted(x for x in lits if re.search(r"(?<![\w.$])" + re.escape(x) + r"(?![\w.])", src) or (x.startswith("$") and x in src))
found += [m.group(0) for m in re.finditer(rf"(?<![\w.]){trial}(?![\w.])", src)]
found += [m.group(0) for m in re.finditer(r"\$\d", src)]
limits_words = re.findall(r"(?i)\b\d+\s+(?:service areas?|areas?|trades|keyword)", src)
print(f"   literals found: {found + limits_words or 'none'} {check(not found and not limits_words, 'no literals in make-screenshots.py')}")

print("\nHARD FAILURES:", fail if fail else "none")
sys.exit(1 if fail else 0)
