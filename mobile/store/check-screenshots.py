#!/usr/bin/env python3
"""The judgment-free gate for the store screenshots (round 11 set: eight shots per platform, the composition changes per shot on one
type and margin system). Run after make-screenshots.py, from mobile/:
    python3 store/check-screenshots.py
Every number below is measured in the PNG files themselves where the PNG can tell it (sizes, mode, text position, cap height, margins,
background colours, lime and orange pixels, phone bezels). Text strings, the records on each screen and card, the map and the
compose-time layout come from store/.gen/metrics.json (written by make-screenshots.py in Chrome) and are checked against the fixture,
the served data and the web lib files. Prints a report; exits 1 on any failure.
SHOTS_OUT and SHOTS_METRICS point the checker at another copy (used for the damaged-copy test)."""
import json, math, os, re, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
OUT = Path(os.environ.get("SHOTS_OUT", HERE / "screenshots"))
MET = json.loads(Path(os.environ.get("SHOTS_METRICS", HERE / ".gen/metrics.json")).read_text())
M = MET["shots"]
GRID = MET["grid"]
DATA = json.loads((HERE / ".gen/data.json").read_text())
FX = json.loads((HERE / "fixtures/real-signals.json").read_text())
ROWS = {r["id"]: r for r in FX["rows"]}
PLATS = ("ios", "android")
SIZE = {"ios": (1320, 2868), "android": (1080, 1920)}
EDGE = {"ios": 64, "android": 52}
COUNT = 8
MAX_BYTES = 8 * 1024 * 1024
# Backgrounds a shot may use: field green, paper and the family tints (app/globals.css tokens).
TOKENS = {"green": "#1E3A2C", "paper": "#F5F4EF", "sky": "#DDE8EC", "sky_deep": "#C9DCE5", "sage": "#E3EFE6", "sage_deep": "#CFE3D5",
          "civic": "#EFEAF7"}
LIGHT = {k for k in TOKENS if k != "green"}
LIME = (0xD9, 0xF0, 0x46)
INK = (0x14, 0x20, 0x1A)
BANNED = ["seamless", "robust", "unlock", "elevate", "effortless", "game-changer", "game changer", "revolutionary", "supercharge",
          "leverage", "best-in-class", "world-class", "cutting-edge", "next-level", "guaranteed", "guarantee", "#1", "new!", "leads"]
END_OF_FEED = "That is everything for now."
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


EARTH_MI = float(re.search(r"const EARTH_RADIUS_MI = ([\d.]+);", (REPO / "lib/geo/index.ts").read_text()).group(1))


def haversine_mi(a_lat, a_lon, b_lat, b_lon):
    """The same formula and earth radius as lib/geo haversineMi (radius read from lib/geo/index.ts)."""
    r = math.radians
    d = math.sin(r(b_lat - a_lat) / 2) ** 2 + math.cos(r(a_lat)) * math.cos(r(b_lat)) * math.sin(r(b_lon - a_lon) / 2) ** 2
    return 2 * EARTH_MI * math.asin(min(1, math.sqrt(d)))


def bearing(a_lat, a_lon, b_lat, b_lon):
    r = math.radians
    y = math.sin(r(b_lon - a_lon)) * math.cos(r(b_lat))
    x = math.cos(r(a_lat)) * math.sin(r(b_lat)) - math.sin(r(a_lat)) * math.cos(r(b_lat)) * math.cos(r(b_lon - a_lon))
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def objs(plat, n, kind=None):
    return [o for o in M[f"{plat}/{n}"]["objects"] if kind is None or o["kind"] == kind]


# ---------------------------------------------------------------- 1. files ------------------------------------------------------------
print(f"== 1. Files: exact names, exactly {COUNT} per platform, the same slots on both (a platform may put its own shot in a slot),")
print("   size, RGB without alpha, under 8 MB; old names gone")
names = {plat: sorted(k.split("/", 1)[1] for k in M if k.startswith(plat + "/")) for plat in PLATS}
for plat in PLATS:
    on_disk = sorted(p.stem for p in (OUT / plat).glob("*"))
    print(f"  {plat}: made {names[plat]}; on disk {on_disk} "
          f"{check(on_disk == names[plat] and len(on_disk) == COUNT, f'file set {plat}')}")
    for n in names[plat]:
        p = OUT / plat / f"{n}.png"
        if not p.exists():
            continue
        im = Image.open(p)
        b = p.stat().st_size
        ok = im.format == "PNG" and im.size == SIZE[plat] and im.mode == "RGB" and "transparency" not in im.info and b < MAX_BYTES
        print(f"    {plat}/{n}.png {im.format} {im.size[0]}x{im.size[1]} {im.mode} {b / 1e6:.2f} MB {check(ok, f'file {plat}/{n}')}")
slots = {p_: [n[:2] for n in names[p_]] for p_ in PLATS}
print(f"  same slots on both platforms: {slots['ios']} {check(slots['ios'] == slots['android'] == [f'{i + 1:02d}' for i in range(COUNT)], 'same slots')}")
legacy = ["01-know-when", "02-storm-hail", "03-permits", "04-311", "05-source-link", "06-trade-radius", "07-push", "08-price",   # round 9
          "01-records", "03-radius", "04-source", "05-push", "06-plans"]                                                          # round 10
legacy_plat = {"android": ["08-plans"]}                                                                                       # round 11 first set
left = [f"{plat}/{n}" for plat in PLATS for n in legacy + legacy_plat.get(plat, []) if (OUT / plat / f"{n}.png").exists() and n not in names[plat]]
print(f"  old file names still present: {left or 'none'} {check(not left, 'old files')}")
for extra in ("contact-sheet.png", "thumb-strip.png"):
    ok = (OUT / extra).exists()
    print(f"  {extra}: {Image.open(OUT / extra).size if ok else 'missing'} {check(ok, extra)}")
PN = names            # per platform

# ---------------------------------------------------------------- 2. the drawn text, measured ----------------------------------------
print("\n== 2. Drawn text measured in the PNG (text pixel = differs from the background by more than 60 in RGB sum, in the header band")
print("   from the top to 12 px under the supporting line)")
meas = {}
for plat in PLATS:
    W, H = SIZE[plat]
    for n in PN[plat]:
        a = load(plat, n); m = M[f"{plat}/{n}"]
        bg = np.array(hexrgb(m["bg_hex"]))
        band_bottom = int(m["layout"]["sub"]["y1"]) + 12
        head = a[:band_bottom]
        txt = np.abs(head - bg).sum(axis=2) > 60
        bands = runs(txt.any(axis=1))
        ys, xs = np.nonzero(txt)
        info = dict(runs=bands, x0=int(xs.min()), x1=int(xs.max()), y0=int(ys.min()))
        if len(bands) == 4:
            e, h1, h2, s = bands
            lab, k = ndimage.label(txt[h1[0]:h1[1]])
            sl = ndimage.find_objects(lab)
            hs = sorted(q[0].stop - q[0].start for q in sl)
            cap = int(np.median([x for x in hs if x >= 0.6 * max(hs)]))
            tops = [q[0].start + h1[0] for q in sl if abs((q[0].stop - q[0].start) - cap) <= 2]

            def baseline(band):  # median bottom row of the glyphs in a band: the text baseline
                lb, kk = ndimage.label(txt[band[0]:band[1]])
                return int(np.median([q[0].stop for q in ndimage.find_objects(lb)])) + band[0]
            info.update(eyebrow=e, h1=h1, h2=h2, sub=s, cap=cap, cap_top=int(np.median(tops)),
                        base=dict(eyebrow=baseline(e), h1=baseline(h1), h2=baseline(h2), sub=baseline(s)),
                        eyebrow_x0=int(np.nonzero(txt[e[0]:e[1]].any(axis=0))[0].min()),
                        head_x0=int(np.nonzero(txt[h1[0]:h2[1]].any(axis=0))[0].min()),
                        sub_x0=int(np.nonzero(txt[s[0]:s[1]].any(axis=0))[0].min()))
        meas[(plat, n)] = info
        print(f"  {plat}/{n}: {len(bands)} text bands (eyebrow, two headline lines, one supporting line) {bands} {check(len(bands) == 4, f'text bands {plat}/{n}')}")

print("\n   Headline cap height and cap top (median connected component of line 1) and the baseline of every text line (median glyph")
print("   bottom), each the same within 2 px across the set: one type system")
for plat in PLATS:
    caps = {n: meas[(plat, n)].get("cap") for n in PN[plat]}
    tops = {n: meas[(plat, n)].get("cap_top") for n in PN[plat]}
    ok = None not in caps.values() and max(caps.values()) - min(caps.values()) <= 2 and max(tops.values()) - min(tops.values()) <= 2
    print(f"   {plat}: cap heights {caps}; cap tops {tops} {check(ok, f'headline cap {plat}')}")
    for part, label in (("eyebrow", "eyebrow baseline"), ("h1", "headline line 1 baseline"), ("h2", "headline line 2 baseline"), ("sub", "supporting line baseline")):
        d = {n: meas[(plat, n)]["base"][part] for n in PN[plat] if "base" in meas[(plat, n)]}
        ok = len(d) == len(PN[plat]) and max(d.values()) - min(d.values()) <= 2
        print(f"   {plat}: {label} {d} {check(ok, f'{label} {plat}')}")

print("\n   Left margin: eyebrow, headline and supporting-line ink within the first letter's side bearing of the margin; text box left in")
print("   Chrome exactly the margin: one margin system")
for plat in PLATS:
    g = GRID[plat]
    ex = {n: meas[(plat, n)].get("eyebrow_x0") for n in PN[plat]}
    hx = {n: meas[(plat, n)].get("head_x0") for n in PN[plat]}
    sx = {n: meas[(plat, n)].get("sub_x0") for n in PN[plat]}
    box = {n: (M[f"{plat}/{n}"]["layout"]["head"]["x0"], M[f"{plat}/{n}"]["layout"]["sub"]["x0"], M[f"{plat}/{n}"]["layout"]["eyebrow"]["x0"]) for n in PN[plat]}
    ok = (all(v is not None and g["M"] <= v <= g["M"] + 10 for v in ex.values()) and all(v is not None and g["M"] <= v <= g["M"] + 16 for v in hx.values())
          and all(v is not None and g["M"] <= v <= g["M"] + 10 for v in sx.values()) and all(b == (g["M"], g["M"], g["M"]) for b in box.values()))
    print(f"   {plat}: margin {g['M']}; eyebrow ink x {ex}; headline ink x {hx}; supporting ink x {sx} {check(ok, f'left margin {plat}')}")

print(f"\n   Drawn text distance from every edge (iOS >= {EDGE['ios']} px, Android >= {EDGE['android']} px): the header band measured in the")
print("   PNG, and every drawn text a viewer can see (map labels, ring captions, the ZIP chip, the figure) measured in Chrome")
for plat in PLATS:
    W, H = SIZE[plat]
    for n in PN[plat]:
        i = meas[(plat, n)]
        d = dict(left=i["x0"], right=W - 1 - i["x1"], top=i["y0"])
        drawn = M[f"{plat}/{n}"]["layout"]["drawn"]
        dm = min(min(t["x0"], W - t["x1"], t["y0"], H - t["y1"]) for t in drawn)
        print(f"   {plat}/{n}: header {d}; nearest drawn text {dm:.0f} px from an edge ({len(drawn)} items) "
              f"{check(min(d.values()) >= EDGE[plat] and dm >= EDGE[plat] - 0.5, f'text edge {plat}/{n}')}")

# ---------------------------------------------------------------- 3. colour ----------------------------------------------------------
print("\n== 3. Colour")
print("   Contrast of drawn text (WCAG 2.x) against the background measured in the PNG; the text colour is the most common text pixel")
print("   colour of each band, which must equal the token (within 12)")
for plat in PLATS:
    for n in PN[plat]:
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

print("\n   Background: flat (four corners, the left and right margins beside the supporting line, a point under it), the shot's own")
print("   token, and one of the brand backgrounds (field green, paper, sky, sage, civic tints)")
for plat in PLATS:
    W, H = SIZE[plat]
    for n in PN[plat]:
        a = load(plat, n); m = M[f"{plat}/{n}"]
        sy = int(m["layout"]["sub"]["y1"]) + 20
        pts = [(4, 4), (W - 5, 4), (4, H - 5), (W - 5, H - 5), (8, sy), (W - 9, sy), (W // 2, sy)]
        # a corner covered by a phone or a card running off the canvas is not background; skip points inside any object box
        def covered(x, y, pad=110):  # inside a phone or card, or under its soft shadow (70 px blur, 30 px down)
            return any(o.get("box") and o["box"][2] is not None and o["box"][0] - pad <= x <= o["box"][2] + pad and o["box"][1] - pad <= y <= o["box"][3] + pad
                       for o in m["objects"] if o["kind"] in ("phone", "card"))
        cols = {"#" + "".join(f"{int(c):02X}" for c in a[y, x]) for x, y in pts if not covered(x, y)}
        ok = cols == {TOKENS.get(m["bg"], "?")} and m["bg_hex"] == TOKENS.get(m["bg"])
        print(f"   {plat}/{n} ({m['bg']}): {sorted(cols)} {check(ok, f'flat background {plat}/{n}')}")
    seq = [(M[f"{plat}/{n}"]["bg"], M[f"{plat}/{n}"]["comp"]) for n in PN[plat]]
    same = [(PN[plat][i], PN[plat][i + 1]) for i in range(len(seq) - 1) if seq[i] == seq[i + 1]]
    print(f"   {plat}: background and composition per shot {seq}")
    print(f"   {plat}: neighbours sharing both background and composition: {same or 'none'} {check(not same, f'neighbours {plat}')}")

print("\n   Lime #D9F046 (pixels within 60 of it): a small accent only, never drawn text on a light background, never touching a light")
print("   canvas; largest cluster at most 0.5% of the canvas, all lime at most 1%")
for plat in PLATS:
    W, H = SIZE[plat]
    for n in PN[plat]:
        a = load(plat, n); m = M[f"{plat}/{n}"]
        lime = np.abs(a - np.array(LIME)).sum(axis=2) < 60
        lab, k = ndimage.label(lime)
        big = int(np.bincount(lab.ravel())[1:].max()) if k else 0
        band_bottom = int(m["layout"]["sub"]["y1"]) + 12
        head_lime = int(lime[:band_bottom].sum())
        light = m["bg"] in LIGHT
        ok = big <= 0.005 * W * H and lime.sum() <= 0.01 * W * H and not (light and head_lime)
        if light:
            bgm = np.abs(a - np.array(hexrgb(m["bg_hex"]))).sum(axis=2) == 0
            ok &= not (ndimage.binary_dilation(lime, iterations=2) & bgm).any()
        print(f"   {plat}/{n} ({m['bg']}): lime px {int(lime.sum())} ({100 * lime.sum() / (W * H):.3f}%), largest cluster {big} px, in the drawn text {head_lime} px "
              f"{check(ok, f'lime {plat}/{n}')}")

print("\n   Orange (hue 10 to 32 deg, saturation and value >= 0.6, the old #E8590C family): no cluster larger than 4 px")
for plat in PLATS:
    for n in PN[plat]:
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

# ---------------------------------------------------------------- 4. the heroes ------------------------------------------------------
print("\n== 4. Heroes: every phone frame found in the PNG as flat ink #14201A with the bezel it was drawn with (left bezel measured on")
print("   rows no other object covers); every phone and card inside the canvas sideways; nothing runs into the supporting line")
for plat in PLATS:
    W, H = SIZE[plat]
    for n in PN[plat]:
        a = load(plat, n); m = M[f"{plat}/{n}"]
        ink = np.abs(a - np.array(INK)).sum(axis=2) <= 6
        res = []
        ok_all = True
        for o in m["objects"]:
            if o["kind"] in ("phone", "card"):
                x0, y0, x1, y1 = o["box"]
                inside = x0 >= 0 and x1 <= W
                ok_all &= inside
                if not inside:
                    res.append(f"{o['key']} outside the canvas sideways")
            if o["kind"] != "phone":
                continue
            x0, y0, x1, y1 = o["box"]; bez = o["bez"]
            hits = 0
            for side in ("left", "right"):   # the left bezel, or the right one where another object covers the left
                xb = int(x0) if side == "left" else int(x1) - bez
                others = [q["box"] for q in m["objects"] if q is not o and q["kind"] in ("phone", "card") and q["box"][0] - 2 <= xb + bez // 2 <= q["box"][2] + 2]
                for y in range(int(y0) + 200, int(min(y1, H)) - 150, 25):
                    if any(b[1] - 2 <= y <= b[3] + 2 for b in others):
                        continue
                    row = ink[y, xb - 1:xb + bez + 1]
                    if row.size == bez + 2 and not row[0] and row[1:bez + 1].all() and not row[bez + 1]:
                        hits += 1
            ok = hits >= 3
            ok_all &= ok
            res.append(f"{o['key']} at {[int(v) for v in o['box']]} bezel {bez} px found on {hits} rows, {'whole' if o['whole'] else 'runs off the canvas'}")
        ok_all &= m["hero_top"] >= m["layout"]["sub"]["y1"] + 40
        print(f"   {plat}/{n}: {'; '.join(res)}; hero top {m['hero_top']} {check(ok_all, f'heroes {plat}/{n}')}")
print("   No status bar is drawn: every phone screen starts with the app's own top bar (the record test below allows app text only)")

print("\n   Whole lines at every cut (the round 10 rules): no text block has lines on both sides of a phone's bottom cut (the tab bar on a")
print("   whole phone, the canvas edge on a phone that runs off), the first line in the scroller is whole, the last line in view is never")
print("   a group or section heading with its items under the cut, and no screen shows the feed's end-of-list line")
for plat in PLATS:
    for n in PN[plat]:
        for o in objs(plat, n, "phone"):
            end = END_OF_FEED in o["screen_text"]
            ok = not o["split_at_edge"] and not o["last_line_is_heading"] and not end and o["edge_clear_css"] >= 2
            print(f"   {plat}/{n} {o['key']}: first line '{o['first_in_scroll'][:40]}'; last line '{o['last_line']}' (heading: {o['last_line_is_heading']}); "
                  f"blocks split {o['split_at_edge']}; {o['edge_clear_css']} CSS px clear; end-of-feed line: {end} "
                  f"{check(ok, 'ending ' + plat + '/' + n + ' ' + o['key'])}")

print("\n   Text size on the canvas: app text on a phone >= iOS 20 / Android 16 px, on a lifted card >= iOS 34 / Android 28 px, map")
print("   labels at least the eyebrow size")
for plat in PLATS:
    g = GRID[plat]
    for n in PN[plat]:
        parts = []
        ok = True
        for o in M[f"{plat}/{n}"]["objects"]:
            if o["kind"] == "phone":
                ok &= o["min_font_px"] >= g["min_phone_px"]; parts.append(f"phone {o['key']} {o['min_font_px']} px")
            elif o["kind"] == "card":
                ok &= o["min_font_px"] >= g["min_card_px"]; parts.append(f"card {o['key']} {o['min_font_px']} px")
            elif o["kind"] == "map":
                ok &= o["label_px"] >= g["eyebrow_px"]; parts.append(f"map labels {o['label_px']} px")
            elif o["kind"] == "figure":
                parts.append(f"figure {o['px']} px")
        print(f"   {plat}/{n}: {'; '.join(parts)} {check(ok, f'text size {plat}/{n}')}")

# ---------------------------------------------------------------- 5. truth ----------------------------------------------------------
print("\n== 5. Truth: every record on a phone or a lifted card is a real fixture row served to that screen's member, with the distance")
print("   the server's matchOne gave, and its title is on that screen; no other record title appears anywhere")
all_titles = {r["title"] for r in FX["rows"]}
for plat in PLATS:
    for n in PN[plat]:
        for o in M[f"{plat}/{n}"]["objects"]:
            if o["kind"] not in ("phone", "card"):
                continue
            feed = o.get("feed"); bad = []
            text = o["screen_text"] if o["kind"] == "phone" else o["text"].split("\n")
            for r in o["records"]:
                row = ROWS.get(r["signalId"])
                sc = FX["scenarios"].get(feed, {})
                served = {i["signalId"]: i for i in DATA["feeds"].get(feed, [])}
                if not row or row["title"] != r["title"] or r["signalId"] not in sc.get("ids", []) or r["signalId"] not in served:
                    bad.append((r["signalId"], "not the fixture row of this member"))
                elif r["distance"] != served[r["signalId"]]["distanceLabel"] or r["distance"] != DATA["distances"][feed][str(r["signalId"])]:
                    bad.append((r["signalId"], "distance differs from the served one"))
                if r["title"] not in text:
                    bad.append((r["signalId"], "title not on the screen"))
            listed = {r["title"] for r in o["records"]}
            stray = [t for t in text if t in all_titles and t not in listed]
            prof = DATA["profiles"].get(feed) if feed else None
            where = f"{prof['zip']} {prof['city']}, {prof['state']} r{prof['radiusMi']} {'+'.join(prof['trades'])}" if prof else "no records on this screen"
            print(f"   {plat}/{n} {o['kind']} {o['key']}: [{where}] {[(r['signalId'], r['title'][:40], r['distance']) for r in o['records']]} "
                  f"{check(not bad and not stray, 'records ' + plat + '/' + n + ' ' + o['key'] + ' ' + str(bad) + ' ' + str(stray))}")

print("\n   The map: every dot is a fixture row inside the 6 mi circle of the member's ZIP point, drawn at its true distance (lib/geo")
print("   haversine, labelled the way the app writes distances: one decimal, '.0' dropped) and its true bearing; the ZIP is the member's")
for plat in PLATS:
    for n in PN[plat]:
        for o in objs(plat, n, "map"):
            prof = next(p for p in DATA["profiles"].values() if p["zip"] == o["zip"])
            bad = []
            for r in o["records"]:
                row = ROWS.get(int(r["id"]))
                if not row or row["title"] != r["title"]:
                    bad.append((r["id"], "not a fixture row")); continue
                mi = round(haversine_mi(prof["lat"], prof["lon"], row["lat"], row["lon"]) * 10) / 10
                br = bearing(prof["lat"], prof["lon"], row["lat"], row["lon"])
                cx, cy = o["centre"]; ppm = o["px_per_mi"]
                ex, ey = cx + mi * ppm * math.sin(math.radians(br)), cy - mi * ppm * math.cos(math.radians(br))
                app = (f"{mi:.1f}".removesuffix(".0") if mi < 10 else str(round(mi))) + " MI"   # components/format.ts formatDistance
                if not (0 < mi <= 6) or abs(mi - r["mi"]) > 0.05 or not r["text"].endswith(" " + app):
                    bad.append((r["id"], f"distance {mi} vs drawn {r['mi']} '{r['text']}'"))
                if abs(br - r["bearing"]) > 0.5 or math.hypot(ex - r["x"], ey - r["y"]) > 2:
                    bad.append((r["id"], "not at its bearing and distance"))
                fam = {"permit": "permit", "civic": "civic", "alert": "weather", "report": "weather"}.get(row["kind"])
                if fam != r["family"]:
                    bad.append((r["id"], "wrong family mark"))
            print(f"   {plat}/{n}: ZIP {o['zip']} ({prof['city']}), {[(r['id'], r['text']) for r in o['records']]} {check(not bad, f'map {plat}/{n} {bad}')}")

print("\n   Big figures: copied from the card beside them")
for plat in PLATS:
    for n in PN[plat]:
        for o in objs(plat, n, "figure"):
            card = next(q for q in M[f"{plat}/{n}"]["objects"] if q.get("key") == o["source"]["card"])
            ok = o.get("number", o["text"]) in o["source"]["text"] and o["source"]["text"] in card["text"]
            print(f"   {plat}/{n}: '{o['text']}' from '{o['source']['text']}' on card {card['key']} {check(ok, f'figure {plat}/{n}')}")

FACT = {}
plans = (REPO / "lib/stripe/plans.ts").read_text()
solo_cents = int(re.search(r"PRICES_CENTS[^=]*=\s*\{\s*starter:\s*\{\s*monthly:\s*(\d+)", plans).group(1))
trial = int(re.search(r"export const TRIAL_DAYS = (\d+);", (REPO / "lib/auth/membership.ts").read_text()).group(1))
d, c = divmod(solo_cents, 100)
solo_price = f"${d}" if c == 0 else f"${d}.{c:02d}"
print(f"\n   Shot facts. lib facts read now: Solo monthly {solo_price} (lib/stripe/plans.ts PRICES_CENTS), trial {trial} days (lib/auth/membership.ts TRIAL_DAYS)")
labels = {x["id"]: x["label"] for x in DATA["config"]["trades"]}
for plat in PLATS:
    for n in PN[plat]:
        t = M[f"{plat}/{n}"]["text"]
        for o in objs(plat, n, "phone"):
            if o.get("profile_key"):
                f = o["form"]; prof = DATA["profiles"][o["profile_key"]]
                ok = (f and f["zip"] == prof["zip"] and int(f["radius"]) == prof["radiusMi"] and f["pickedVisible"] == [labels[x] for x in prof["trades"]]
                      and o["first_in_scroll"].startswith(("Home and property", "Pick up to", "Your trades")))
                print(f"   {plat}/{n}: trade picker, first line '{o['first_in_scroll']}'; ticked trades in view {f['pickedVisible']} (member {o['profile_key']}: "
                      f"{prof['zip']} r{prof['radiusMi']} {prof['trades']}; the form holds ZIP {f['zip']}, {f['radius']} mi) {check(ok, f'trade picker {plat}/{n}')}")
            if o["switches"]:
                sw = {x["label"]: x["on"] for x in o["switches"]}
                emails = [x for x in o["screen_text"] if "@" in x]
                ok = (sw == {"Push notifications": True, "Email digest": True} and not any(x in ("Sign out", "Delete account") for x in o["screen_text"])
                      and "Not shared" not in o["screen_text"] and emails and all(e.endswith("@example.com") for e in emails))
                print(f"   {plat}/{n}: Settings switches in view {sw}; Email row {emails or 'no address'}; no Sign out / Delete account "
                      f"{check(ok, f'alert settings {plat}/{n}')}")
            if any(x.startswith("Open the") for x in o["screen_text"]):
                ok = any(x.startswith("Open the source") for x in o["screen_text"]) and not any("source record" in x.lower() or "official" in x.lower() for x in o["screen_text"])
                print(f"   {plat}/{n}: {o['key']} button reads {[x for x in o['screen_text'] if x.startswith('Open the')]} {check(ok, f'source button {plat}/{n}')}")
            if o["route"] and o["route"].get("name") == "paywall":
                body = " ".join(o["screen_text"])
                drawn = " ".join(t["head"]) + " " + t["sub"]
                if plat == "ios":
                    ok = f"{trial} days free" in drawn.lower() and solo_price in t["sub"] and solo_price in body
                    print(f"   ios/{n}: drawn '{drawn}' states trial {trial} and Solo {solo_price}, both from lib; the Plans screen shows {solo_price} "
                          f"{check(ok, 'ios price facts')}")
                else:
                    print(f"   android/{n}: the Plans screen shows {solo_price} {check(solo_price in body, 'android plans screen')}")
        for o in objs(plat, n, "card"):
            if o["key"].endswith("datafrom"):
                ok = o["text"].startswith("Data from") and "open data" in o["text"]
                print(f"   {plat}/{n}: lifted line '{o['text'].strip()}' {check(ok, f'data from {plat}/{n}')}")
            if o["key"].endswith("zip-radius"):
                ok = "ZIP code you work from" in o["text"] and "How far you travel" in o["text"] and o.get("form")
                print(f"   {plat}/{n}: lifted fields '{' / '.join(o['text'].splitlines()[:3])}' {check(bool(ok), f'zip radius {plat}/{n}')}")
            if o["key"].endswith("solo"):
                ok = o["text"].strip().startswith("Solo") and solo_price in o["text"]
                print(f"   {plat}/{n}: lifted plan card '{' / '.join(o['text'].splitlines()[:2])}' {check(ok, f'plan card {plat}/{n}')}")

print("\n   Record words set large (quotes): the record's own title, then parts of its own summary, as served to the member; the source line is")
print("   its source label, and both are on that alert's screen")
for plat in PLATS:
    for n in PN[plat]:
        for o in objs(plat, n, "quote"):
            src = o["source"]; recs = src["records"]
            it = DATA["alerts"].get(f"01-records:{recs[0]['signalId']}") if recs else None
            ok = bool(it) and o["lines"] == [it["title"]] + it["summary"].split(" | ")[1:] and o["attribution"] == it["sourceLabel"] and src["text"] == it["summary"]
            ok &= ROWS[recs[0]["signalId"]]["title"] == it["title"]
            ok &= recs[0]["distance"] == it["distanceLabel"] and ROWS[recs[0]["signalId"]]["summary"] == it["summary"]
            print(f"   {plat}/{n}: {o['lines']} / {o['attribution']} (row {recs[0]['signalId'] if recs else '?'}) {check(ok, f'quote {plat}/{n}')}")

print("\n   Android shows no plan price and no 'free' anywhere: not in the drawn text, not on a lifted card, not on any phone screen")
prices = {p_[per]["display"] for p_ in DATA["config"]["plans"].values() for per in ("monthly", "yearly")}
for n in PN["android"]:
    texts = []
    for o in M[f"android/{n}"]["objects"]:
        texts += o.get("screen_text", []) + [o.get("text") or ""] + o.get("lines", []) + [o.get("attribution") or ""]
    t = M[f"android/{n}"]["text"]; texts += [t["eyebrow"], *t["head"], t["sub"]]
    hits = sorted({p_ for p_ in prices for x in texts if p_ in x} | {x for x in texts if re.search(r"\bfree\b", x.lower())})
    print(f"   android/{n}: {hits or 'none'} {check(not hits, f'android price {n}')}")

# ---------------------------------------------------------------- 5b. overlaps ------------------------------------------------------
NEAR = 8


def canvas_rects(o):
    if o["kind"] == "phone":
        sx, sy, s_ = o["x"] + o["bez"], o["y"] + o["bez"], o["s"]
        return [(sx + r[0] * s_, sy + r[1] * s_, sx + r[2] * s_, sy + r[3] * s_, r[4]) for r in o["rects_css"]]
    if o["kind"] == "map":
        return [tuple(b[2:6]) + (f"{b[0]} {b[1]}",) for b in o.get("boxes", []) if b[0] in ("lab", "cap", "chip")]
    return []


print("\n== 5b. Overlaps: whatever is drawn over a phone or the map (a lifted card, a second phone) covers each text line, chip, button and")
print(f"   icon under it whole or not at all, and a lifted card's edge keeps {NEAR} px or more from any line it leaves in view")
for plat in PLATS:
    for n in PN[plat]:
        ob = M[f"{plat}/{n}"]["objects"]; probs = []; pairs = 0
        for i, a in enumerate(ob):
            if a["kind"] not in ("phone", "card"):
                continue
            ax0, ay0, ax1, ay1 = a["box"]
            for j, b in enumerate(ob):
                if b is a or b["kind"] not in ("phone", "map") or not (a["z"] > b["z"] or (a["z"] == b["z"] and i > j)):
                    continue
                pairs += 1
                for x0, y0, x1, y1, lab in canvas_rects(b):
                    ix = max(0.0, min(x1, ax1) - max(x0, ax0)); iy = max(0.0, min(y1, ay1) - max(y0, ay0))
                    inter, area = ix * iy, (x1 - x0) * (y1 - y0)
                    if inter > 1 and inter < area - 1:
                        probs.append(f"{a.get('key', a['kind'])} cuts '{lab}'")
                    elif inter <= 1 and a["kind"] == "card" and min(x1, ax1) - max(x0, ax0) > 0 and (0 <= y0 - ay1 < NEAR or 0 <= ay0 - y1 < NEAR):
                        probs.append(f"{a.get('key')} edge near '{lab}'")
        print(f"   {plat}/{n}: {pairs} object pairs, {probs or 'no cut or crowded line'} {check(not probs, f'overlap {plat}/{n}')}")

print("\n   Lifted cuts are clean: one element's own box, or (with padding) only that screen's flat paper around it; nothing of a")
print("   neighbouring element is taken in (the outer ring of the saved cut, 2 CSS px short of the element, is one colour)")
for plat in PLATS:
    for n in PN[plat]:
        for o in objs(plat, n, "card"):
            ok = True; note = "own box"
            if o["pad"]:
                a = np.asarray(Image.open(o["path"]).convert("RGB"), dtype=np.int16); k = max(1, (o["pad"] - 2) * 4)
                ring = np.concatenate([a[:k].reshape(-1, 3), a[-k:].reshape(-1, 3), a[:, :k].reshape(-1, 3), a[:, -k:].reshape(-1, 3)])
                ok = bool((np.abs(ring - ring[0]).max(axis=1) <= 3).all()); note = f"pad {o['pad']} CSS px, ring colour #{''.join(f'{int(v):02X}' for v in ring[0])}"
            print(f"   {plat}/{n} {o['key']}: {note} {check(ok, 'clean cut ' + plat + '/' + n + ' ' + o['key'])}")

print("\n   Map labels at least 6 px from every other label, dot, ring caption and the ZIP chip (their own dot excepted)")
for plat in PLATS:
    for n in PN[plat]:
        for o in objs(plat, n, "map"):
            bx = [b for b in o["boxes"] if b[0] in ("lab", "dot", "cap", "chip")]
            gaps = []
            for k_, (kind, id_, x0, y0, x1, y1) in enumerate(bx):
                if kind != "lab":
                    continue
                for kind2, id2, a0, b0, a1, b1 in bx[:k_] + bx[k_ + 1:]:
                    if kind2 == "dot" and id2 == id_:
                        continue
                    gaps.append((max(a0 - x1, x0 - a1, b0 - y1, y0 - b1), id_, kind2, id2))
            g_ = min(gaps)
            print(f"   {plat}/{n}: smallest label gap {g_[0]:.1f} px (label {g_[1]} to {g_[2]} {g_[3]}) {check(g_[0] >= 6, f'map labels {plat}/{n}')}")

# ---------------------------------------------------------------- 6. words ----------------------------------------------------------
print("\n== 6. Drawn text: wording rules")
zips = {p["zip"] for p in DATA["profiles"].values()}
for plat in PLATS:
    for n in PN[plat]:
        t = M[f"{plat}/{n}"]["text"]
        drawn = [t["eyebrow"], *t["head"], t["sub"]]
        s = " ".join(drawn)
        words_head = len(" ".join(t["head"]).split()); words_sub = len(t["sub"].split())
        probs = []
        if "—" in s or "–" in s: probs.append("em or en dash")
        probs += [w for w in BANNED if re.search(r"(?<![a-z])" + re.escape(w) + r"(?![a-z])", s.lower())]
        if plat == "android" and (re.search(r"[$€£]|\d+\.\d\d", s) or re.search(r"\bfree\b", s.lower())):
            probs.append("price or 'free' on Android")
        digits = re.findall(r"\d+(?:\.\d+)?", s)
        allowed = {str(trial), solo_price.lstrip("$"), "311"} | zips
        if any(x not in allowed for x in digits):
            probs.append(f"number not from lib or data: {digits}")
        if not (2 <= words_head <= 6 and words_sub <= 8 and len(t["eyebrow"].split()) <= 4): probs.append(f"length head {words_head} words, sub {words_sub} words")
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
