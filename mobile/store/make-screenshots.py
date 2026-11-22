#!/usr/bin/env python3
"""Regenerates the 16 store screenshots, the contact sheet and the thumb strip (design direction r8 section 3, pass 2 decisions).

  1. node store/build-data.mjs                       (real holler_signals rows -> .gen/data.json, one member profile per shot, push text)
  2. SHOT_PLATFORM=ios|android ... npx vite build -c store/vite.capture.config.mjs   (see build-captures.sh)
  3. python3 store/make-screenshots.py [01-know-when ...]

What is real and what is composed:
  * Every card, crop, banner and phone screen is the REAL built app (mobile/src) rendered by /usr/bin/google-chrome at
    deviceScaleFactor 4 against store/mock-api.mjs, which serves real holler_signals rows from fixtures/real-signals.json to one member
    profile per shot (work ZIP placed by the server's lookupZip, rows kept only if the server's matchOne matches them with a distance).
  * Feed shots (1 to 4): the star is ONE real feed card, cropped above its grey explainer sentence (the crop's bottom padding repeats the
    card's own last blank pixel row) and enlarged so its title is at least 64 px (iOS) / 52 px (Android). At most one or two other real
    cards of the same feed sit below it, and the explainer sentence is visible at most once per shot, never on the hero.
  * The script composes only: the flat background, the headline and supporting line (text fixed in SHOTS), the flat ink phone frame,
    ink outlines around cards, rings, and in shot 7 a flat card holding the push text built by the server's own buildNotification().
  * No shadows, no gradients, no OS chrome, no perspective.
Fonts: Fraunces Variable and Geist from the web project's node_modules (the same files app/globals.css and app/layout.tsx use).
Writes store/screenshots/{ios,android}/*.png, contact-sheet.png, thumb-strip.png, and store/.gen/metrics.json plus .gen/noring/*.png
(the same image before rings are drawn; check-screenshots.py measures ring clearance on them).
"""
import json, subprocess, sys, time, urllib.request
from pathlib import Path
import io
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
OUT = HERE / "screenshots"
GEN = HERE / ".gen"
NORING = GEN / "noring"
TMP = Path("/tmp/holler-shots-work"); TMP.mkdir(exist_ok=True)
PORT = 8799
BASE = f"http://127.0.0.1:{PORT}"
DSF = 4  # every app capture; downscaled with Lanczos to the exact size on the canvas
# The trial wording on shot 8 comes from the server's one constant (lib/auth/membership.ts TRIAL_DAYS, phrases from
# lib/plan/price-copy.ts) through .gen/data.json (build-data.mjs), never typed here.
_CFG = json.loads((GEN / "data.json").read_text())["config"]
TRIAL_DAYS = int(_CFG["trialDays"])
TRIAL_HEADLINE = _CFG["trialHeadline"]  # built by the server from TRIAL_DAYS (lib/plan/price-copy.ts)

FRAUNCES = REPO / "node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2"
GEIST = REPO / "node_modules/geist/dist/fonts/geist-sans"
for f in (FRAUNCES, GEIST / "Geist-Regular.woff2", GEIST / "Geist-Medium.woff2", GEIST / "Geist-SemiBold.woff2", GEIST / "Geist-SemiBold.ttf"):
    assert f.exists(), f"font file missing: {f}"

# Section 2 tokens. Only these colours are drawn by the script.
TOK = dict(accent="#E8590C", ink="#191714", muted="#5C574F", paper="#FAF6EE", sand="#F3EBDD", sky_deep="#C9DCE5", sage_deep="#D4E3CD",
           peach="#F7D6BE", white="#FFFFFF", line="#E5DCCB")

# name, headline (two lines, as decided), supporting line, background; "android" overrides for the Android file only.
SHOTS = [
    dict(name="01-know-when", head=("Storms, permits,", "311 near you"), sub="Alerts for roofers, plumbers, HVAC and more", bg="accent"),
    dict(name="02-storm-hail", head=("Storm & hail", "alerts"), sub="Hail reports and storm warnings near you", bg="sky_deep"),
    dict(name="03-permits", head=("New permits", "near you"), sub="Plumbing, HVAC, windows and more", bg="sage_deep"),
    dict(name="04-311", head=("311 & city", "requests"), sub="Tree emergencies and code requests", bg="peach"),
    dict(name="05-source-link", head=("See the official", "source"), sub="Every alert links to where it came from", bg="paper"),
    dict(name="06-trade-radius", head=("Your trades,", "your radius"), sub="Set trades and how far you drive", bg="sky_deep"),
    dict(name="07-push", head=("Alerts that", "fit. No spam."), sub="At most one push an hour", bg="sand"),
    # Google asks for preview images without price promotion and "free": the Android file states the flat price model instead.
    dict(name="08-price", head=(f"{TRIAL_HEADLINE[0].upper()}{TRIAL_HEADLINE[1:]}.", "Then $7.99/mo."), sub="Free account first. No card. Subscribe later.", bg="accent",
         android=dict(head=("Flat monthly", "plans"), sub=f"No per-lead fees. {TRIAL_DAYS}-day trial, no card.")),
]

T = {
    # head_w: the headline box. "Storms, permits," is 1166 px wide at 150 px, so the box runs 30 px into the right margin (left aligned).
    "ios": dict(W=1320, H=2868, M=90, head_top=170, head_px=150, head_lh=1.06, head_w=1170, sub_px=52, sub_gap=32, content_top=660,
                frame_x=120, frame_w=1080, bezel=18, frame_r=120, lift_w=1180, peek_w=1100, lift_r=56, ring=8, outline=4,
                peek_outline=2, gap=56, hero_min=64, push_title=58, push_body=50, push_mark=88, push_pad=40, push_vpad=24),
    "android": dict(W=1080, H=1920, M=72, head_top=110, head_px=120, head_lh=1.06, head_w=936, sub_px=42, sub_gap=24, content_top=500,
                    frame_x=100, frame_w=880, bezel=14, frame_r=96, lift_w=960, peek_w=900, lift_r=44, ring=6, outline=4,
                    peek_outline=2, gap=44, hero_min=52, push_title=48, push_body=42, push_mark=72, push_pad=32, push_vpad=26),
}
for t in T.values():
    t["screen_w"] = t["frame_w"] - 2 * t["bezel"]

SESSION = {
    "access_token": "capture.token.value", "token_type": "bearer", "expires_in": 315360000,
    "expires_at": int(time.time()) + 315360000, "refresh_token": "capture-refresh",
    "user": {"id": "00000000-0000-4000-8000-0000000000a1", "aud": "authenticated", "role": "authenticated", "email": "member@example.com",
             "app_metadata": {}, "user_metadata": {}, "created_at": "2026-11-01T00:00:00Z"},
}

NAVIGATE = """(route) => {
  const root = document.getElementById('root');
  const key = Object.keys(root).find(k => k.startsWith('__reactContainer$'));
  const stack = [root[key]];
  while (stack.length) {
    const f = stack.pop();
    if (!f) continue;
    const v = f.memoizedProps && f.memoizedProps.value;
    if (v && typeof v.navigate === 'function' && 'phase' in v) { if (route) v.navigate(route); return true; }
    if (f.sibling) stack.push(f.sibling);
    if (f.child) stack.push(f.child);
  }
  return false;
}"""

# Every visible text line on the screen (text nodes) plus buttons, chips, inputs and icons: [top, bottom, label] in CSS px.
SCREEN_LINES = """() => { const out = [];
  const walk = document.createTreeWalker(document.querySelector('.app') || document.body, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) { const n = walk.currentNode; if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n);
    for (const b of r.getClientRects()) out.push([b.top, b.bottom, n.textContent.trim().slice(0, 40)]); }
  for (const e of document.querySelectorAll('.app svg, .app .btn, .app .chip, .app input')) { const b = e.getBoundingClientRect(); out.push([b.top, b.bottom, '<' + e.tagName + '>']); }
  return out; }"""

# Geometry of one feed card (found by its title), relative to the card's top-left, in CSS px.
CARD_GEOM = """(t) => { const a = [...document.querySelectorAll('article.card')].find(c => (c.querySelector('.alert-title') || {}).textContent === t);
  if (!a) return null; const b = a.getBoundingClientRect();
  const rr = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return {x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height}; };
  const tr = (e) => { if (!e) return null; const r = document.createRange(); r.selectNodeContents(e); const rs = [...r.getClientRects()];
    const x0 = Math.min(...rs.map(q => q.left)), x1 = Math.max(...rs.map(q => q.right)), y0 = Math.min(...rs.map(q => q.top)), y1 = Math.max(...rs.map(q => q.bottom));
    return {x: x0 - b.left, y: y0 - b.top, w: x1 - x0, h: y1 - y0}; };
  const q = (s) => a.querySelector(s);
  const lines = []; const walk = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) { const n = walk.currentNode; if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n);
    for (const z of r.getClientRects()) lines.push([z.top - b.top, z.bottom - b.top, n.textContent.trim().slice(0, 30)]); }
  for (const e of a.querySelectorAll('svg, .kind-tag')) { const z = e.getBoundingClientRect(); lines.push([z.top - b.top, z.bottom - b.top, '<' + e.tagName + '>']); }
  const fs = (s) => { const e = q(s); return e ? parseFloat(getComputedStyle(e).fontSize) : null; };
  return {x: b.left, y: b.top, w: b.width, h: b.height, lines, title: tr(q('.alert-title')), strong: tr(q('.meta-strong')), meta: rr(q('.meta')),
    tag: rr(q('.tag-row')), intent: rr(q('.intent-line')), source: rr(q('.source-line')), feedback: rr(q('.feedback')),
    text: a.innerText, fonts: {title: fs('.alert-title'), meta: fs('.meta'), tag: fs('.kind-tag'), label: fs('.intent'), source: fs('.source-line'), explainer: fs('.intent-line')}}; }"""

METRICS = {"shots": {}}
DATA = json.loads((GEN / "data.json").read_text())


def scenario(**kw):
    req = urllib.request.Request(f"{BASE}/__scenario", data=json.dumps(kw).encode(), headers={"Content-Type": "application/json"}, method="POST")
    urllib.request.urlopen(req).read()


def bad_text(page):
    t = page.inner_text("body")
    for needle in ("That did not load", "couldn't", "could not", "Loading", "No alerts yet", "Prices did not load", "Something went wrong",
                   "not ready", "Try again", "Demand sign", "Spending activity"):
        if needle in t:
            raise RuntimeError(f"unexpected text on screen: {needle!r}")
    if page.query_selector(".skeleton"):
        raise RuntimeError("skeleton still on screen")


def open_app(browser, plat, vw, vh, me="paid", feed="01-know-when", signed_in=True):
    scenario(me=me, feed=feed)
    ctx = browser.new_context(viewport={"width": vw, "height": vh}, device_scale_factor=DSF, is_mobile=True, has_touch=True,
                              timezone_id="America/Chicago", locale="en-US")
    if signed_in:
        ctx.add_init_script(f"localStorage.setItem('holler-auth', {json.dumps(json.dumps(SESSION))});")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{BASE}/{plat}/index.html")
    return ctx, page, errors


def settle(page, ms=500):
    page.evaluate("() => document.fonts.ready")
    page.wait_for_timeout(ms)


def shot_png(page, path, clip=None):
    """Screenshot at DSF; clip in CSS px."""
    page.screenshot(path=str(path), type="png", clip=clip)
    return Image.open(path).convert("RGB")


def crop_css(im, r):
    """Crop a DSF screenshot by a CSS-px rect {x,y,w,h}."""
    box = tuple(round(v * DSF) for v in (r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"]))
    return im.crop(box)


def save_scaled(im, width, name):
    h = round(im.height * width / im.width)
    out = im.resize((width, h), Image.LANCZOS)
    p = TMP / name; out.save(p, "PNG")
    return p, out.size


def records_of(feed, titles):
    """(signal id, title, distance label) for each title, read from the very feed the mock served."""
    by = {i["title"]: i for i in DATA["feeds"][feed]}
    return [(by[t]["signalId"], t, by[t]["distanceLabel"]) for t in titles]


def feed_capture(browser, plat, vw, feed, me="paid", vh=2400):
    """The real Feed in a tall unscrolled viewport (element crops come from here)."""
    ctx, page, errors = open_app(browser, plat, vw, vh, me=me, feed=feed)
    page.wait_for_selector(".alert-card")
    settle(page); bad_text(page)
    im = shot_png(page, TMP / f"{plat}-{feed}-{me}-{vw}-tall.png")
    if errors:
        raise RuntimeError(f"page errors: {errors}")
    return ctx, page, im


def card_crop(im, c, upto, name, width, pad_css=12):
    """One feed card as an image. upto='head': cut 1 CSS px above the grey explainer sentence (tag, title, place, time, distance stay);
    upto='body': cut above the compact feedback row. The bottom padding repeats the card's own last row (white, border and stripe)."""
    cut = (c["intent"]["y"] - 1) if upto == "head" else (c["feedback"]["y"] if c["feedback"] else c["h"])
    region = crop_css(im, {"x": c["x"], "y": c["y"], "w": c["w"], "h": cut})
    pad = round(pad_css * DSF)
    row = region.crop((0, region.height - 1, region.width, region.height))
    full = Image.new("RGB", (region.width, region.height + pad))
    full.paste(region, (0, 0))
    full.paste(row.resize((region.width, pad)), (0, region.height))
    p, size = save_scaled(full, width, name)
    return dict(path=p, size=size, ls=width / c["w"], h_css=cut + pad_css, cut_css=cut, geom=c, upto=upto)


# ---------------------------------------------------------------- composition (Chrome, flat HTML) --------------------------------

def font_faces():
    return f"""
    @font-face {{ font-family: 'Fraunces'; src: url('file://{FRAUNCES}') format('woff2'); font-weight: 100 900; font-style: normal; }}
    @font-face {{ font-family: 'Geist'; src: url('file://{GEIST}/Geist-Regular.woff2') format('woff2'); font-weight: 400; }}
    @font-face {{ font-family: 'Geist'; src: url('file://{GEIST}/Geist-Medium.woff2') format('woff2'); font-weight: 500; }}
    @font-face {{ font-family: 'Geist'; src: url('file://{GEIST}/Geist-SemiBold.woff2') format('woff2'); font-weight: 600; }}"""


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def header_page(browser, plat, name, head, sub, bg):
    t = T[plat]
    sub_color = TOK["ink"] if bg == "accent" else TOK["muted"]
    lines = "".join(f'<span class="hl">{esc(l)}</span>' for l in head)
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>{font_faces()}
    html,body{{margin:0;padding:0;}}
    body{{width:{t['W']}px;height:{t['H']}px;overflow:hidden;position:relative;background:{TOK[bg]};-webkit-font-smoothing:antialiased;}}
    .head{{position:absolute;left:{t['M']}px;width:{t['head_w']}px;top:{t['head_top']}px;}}
    h1{{margin:0;font-family:'Fraunces';font-weight:600;font-size:{t['head_px']}px;line-height:{t['head_lh']};letter-spacing:-0.02em;color:{TOK['ink']};font-variation-settings:'wght' 600;}}
    h1 .hl{{display:block;white-space:nowrap;}}
    p.sub{{margin:{t['sub_gap']}px 0 0;font-family:'Geist';font-weight:500;font-size:{t['sub_px']}px;line-height:1.25;color:{sub_color};width:{t['W'] - 2 * t['M']}px;}}
    .abs{{position:absolute;}}
    img{{display:block;}}
    .frame{{position:absolute;box-sizing:border-box;border:{t['bezel']}px solid {TOK['ink']};border-bottom:0;border-radius:{t['frame_r']}px {t['frame_r']}px 0 0;overflow:hidden;background:{TOK['white']};}}
    .lift{{position:absolute;box-sizing:border-box;overflow:hidden;outline:{t['outline']}px solid {TOK['ink']};outline-offset:0;}}
    .peek{{position:absolute;box-sizing:border-box;overflow:hidden;outline:{t['peek_outline']}px solid {TOK['ink']};outline-offset:0;}}
    .plain{{position:absolute;box-sizing:border-box;overflow:hidden;}}
    .ring{{position:absolute;box-sizing:border-box;border-style:solid;}}
    </style></head><body><div class="head"><h1>{lines}</h1><p class="sub">{esc(sub)}</p></div></body></html>"""
    f = TMP / f"{plat}-{name}.html"; f.write_text(html)
    ctx = browser.new_context(viewport={"width": t["W"], "height": t["H"]}, device_scale_factor=1)
    page = ctx.new_page(); page.goto(f"file://{f}")
    page.evaluate("() => Promise.all(['400 40px Geist', '500 40px Geist', '600 40px Geist', '600 40px Fraunces'].map(f => document.fonts.load(f)))")
    page.evaluate("() => document.fonts.ready")
    page.wait_for_timeout(200)
    m = page.evaluate("""() => { const h = document.querySelector('h1'), p = document.querySelector('p.sub');
      const lines = (e) => { const r = document.createRange(); r.selectNodeContents(e); const tops = new Set([...r.getClientRects()].map(b => Math.round(b.top))); return tops.size; };
      const spans = [...h.querySelectorAll('.hl')].map(s => { const r = document.createRange(); r.selectNodeContents(s); const b = r.getBoundingClientRect(); return {top: b.top, bottom: b.bottom, w: b.width}; });
      const hb = h.getBoundingClientRect(), pb = p.getBoundingClientRect(); const cs = getComputedStyle(h);
      const sr = document.createRange(); sr.selectNodeContents(p); const sw = sr.getBoundingClientRect().width;
      return {headTop: hb.top, headBottom: hb.bottom, headLines: new Set(spans.map(b => Math.round(b.top))).size, lineBoxes: spans, subBottom: pb.bottom, subLines: lines(p), subWidth: sw,
        headPx: parseFloat(cs.fontSize), lineHeight: parseFloat(cs.lineHeight), headFamily: cs.fontFamily, headWeight: cs.fontWeight,
        subPx: parseFloat(getComputedStyle(p).fontSize), text: h.innerText.replace(/\\n/g, ' '), sub: p.textContent,
        fontsOk: document.fonts.check("600 20px Fraunces") && document.fonts.check("500 20px Geist")}; }""")
    assert m["fontsOk"], m
    assert m["headLines"] == 2 and all(s["w"] <= t["head_w"] + 1 for s in m["lineBoxes"]), ("headline does not fit in 2 lines", plat, name, m)
    assert m["subLines"] == 1, ("supporting line wraps", plat, name, m)
    assert m["subBottom"] <= t["content_top"] - 24, ("supporting line runs into the content", plat, name, m)
    return ctx, page, m


def add(page, html):
    page.evaluate("(h) => document.body.insertAdjacentHTML('beforeend', h)", html)


def img_html(path, x, y, w, h, cls="abs", style=""):
    return f'<div class="{cls}" style="left:{x}px;top:{y}px;width:{w}px;height:{h}px;{style}"><img src="file://{path}" width="{w}" height="{h}"></div>'


RING_CLEAR = 12  # px between a ring's stroke and any text, the ringed text included


def ring_spec(x, y, w, h, color, target, mode="glyph", radius=None, on="white card"):
    """A ring candidate. mode 'glyph': the ring hugs the dark glyphs found inside the box; 'box': it goes round the box itself
    (a button, a banner). Coordinates in canvas px."""
    return dict(rect=[x, y, w, h], color=color, target=target, mode=mode, radius=radius, on=on)


def clearance(noring_win, ringed_win, band_box, stroke):
    """Exact smallest distance (px) from any ring pixel to any text pixel (luminance < 100 on the ring-less render). Only differences
    inside the ring's own stroke band (band_box, window coordinates) count as ring."""
    a = np.asarray(noring_win.convert("RGB"), dtype=np.int16); b = np.asarray(ringed_win.convert("RGB"), dtype=np.int16)
    X0, Y0, X1, Y1 = [int(round(v)) for v in band_box]
    band = np.zeros(a.shape[:2], dtype=bool)
    band[max(0, Y0):Y1, max(0, X0):X1] = True
    band[Y0 + stroke + 2:Y1 - stroke - 2, X0 + stroke + 2:X1 - stroke - 2] = False
    ring = (np.abs(a - b).sum(axis=2) > 40) & band
    ink = np.asarray(noring_win.convert("L"), dtype=np.int16) < 100
    if not ring.any():
        return 0.0
    if not ink.any():
        return 99.0
    d = ndimage.distance_transform_edt(~ring)
    return float(d[ink].min())


def place_rings(page, plat, noring, alts_list):
    """Draw each ring: the first candidate (and the heavier stroke first) that keeps RING_CLEAR px from every text pixel wins.
    Returns the metrics of the rings drawn."""
    t = T[plat]
    L = np.asarray(noring.convert("L"), dtype=np.int16)
    out = []
    for alts in alts_list:
        best = None; tries = []
        for spec in alts:
            for stroke in (t["ring"], t["ring"] - 2):
                x, y, w, h = spec["rect"]
                if spec["mode"] == "glyph":
                    sub = L[int(y):int(y + h) + 1, int(x):int(x + w) + 1] < 100
                    ys, xs = np.nonzero(sub)
                    gx0, gy0, gx1, gy1 = x + xs.min(), y + ys.min(), x + xs.max() + 1, y + ys.max() + 1
                    r_in = min((gy1 - gy0) / 2 + RING_CLEAR + 1, 22)
                else:
                    gx0, gy0, gx1, gy1 = x, y, x + w, y + h
                    r_in = (spec["radius"] or 0) + RING_CLEAR + 1
                off = RING_CLEAR + 1
                X0, Y0, X1, Y1 = gx0 - off - stroke, gy0 - off - stroke, gx1 + off + stroke, gy1 + off + stroke
                html = (f'<div class="ring" id="ring-try" style="left:{X0:.1f}px;top:{Y0:.1f}px;width:{X1 - X0:.1f}px;height:{Y1 - Y0:.1f}px;'
                        f'border-width:{stroke}px;border-color:{TOK[spec["color"]]};border-radius:{r_in + stroke:.1f}px"></div>')
                pad = 50
                wx0, wy0, wx1, wy1 = max(0, int(X0) - pad), max(0, int(Y0) - pad), min(t["W"], int(X1) + pad), min(t["H"], int(Y1) + pad)
                clip = {"x": wx0, "y": wy0, "width": wx1 - wx0, "height": wy1 - wy0}
                # before and after with the same clipped capture, so only the ring differs
                before = Image.open(io.BytesIO(page.screenshot(type="png", clip=clip))).convert("RGB")
                add(page, html)
                ringed = Image.open(io.BytesIO(page.screenshot(type="png", clip=clip))).convert("RGB")
                c = clearance(before, ringed, (X0 - wx0, Y0 - wy0, X1 - wx0, Y1 - wy0), stroke)
                ok = c >= RING_CLEAR and X0 >= 0 and X1 <= t["W"]
                cand = dict(box=[round(X0, 1), round(Y0, 1), round(X1, 1), round(Y1, 1)], stroke=stroke, target=spec["target"], color=spec["color"],
                            on=spec["on"], clearance=round(c, 1), first_choice=spec is alts[0])
                tries.append((spec["target"], stroke, round(c, 1)))
                if ok:
                    page.evaluate("() => document.getElementById('ring-try').removeAttribute('id')")
                    best = cand; break
                page.evaluate("() => document.getElementById('ring-try').remove()")
                if best is None or c > best["clearance"]:
                    best = dict(cand, html=html)
            if best and best.get("clearance", 0) >= RING_CLEAR and "html" not in best:
                break
        if "html" in best:  # nothing passed: draw the best try and let the check report it
            add(page, best.pop("html"))
        best["tries"] = tries
        out.append(best)
    return out


def frame_html(plat, top, screen_png, screen_size):
    t = T[plat]
    sw, sh = screen_size
    return (f'<div class="frame" style="left:{t["frame_x"]}px;top:{top}px;width:{t["frame_w"]}px;height:{t["H"] - top + 10}px">'
            f'<img src="file://{screen_png}" width="{sw}" height="{sh}"></div>')


def finish(page, ctx, plat, name, info, rings=()):
    """Screenshot once without rings (kept for the clearance check), then place the rings (measured) and write the file."""
    t = T[plat]
    page.wait_for_function("() => [...document.images].every(i => i.complete && i.naturalWidth > 0)", timeout=15000)
    page.evaluate("() => document.fonts.ready")
    m = page.evaluate("""() => ({sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight})""")
    assert m["sw"] <= t["W"], (plat, name, m)
    NORING.mkdir(parents=True, exist_ok=True)
    clip = {"x": 0, "y": 0, "width": t["W"], "height": t["H"]}
    nr = NORING / f"{plat}-{name}.png"
    page.screenshot(path=str(nr), type="png", clip=clip)
    info["rings"] = place_rings(page, plat, Image.open(nr).convert("RGB"), rings) if rings else []
    raw = TMP / f"{plat}-{name}-raw.png"
    page.screenshot(path=str(raw), type="png", clip=clip)
    ctx.close()
    im = Image.open(raw).convert("RGB")
    assert im.size == (t["W"], t["H"]), im.size
    dest = OUT / plat / f"{name}.png"; dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "PNG", optimize=True)
    Image.open(nr).convert("RGB").save(nr, "PNG")
    info["noring"] = str(nr)
    METRICS["shots"][f"{plat}/{name}"] = info
    print(plat, name, json.dumps({k: info.get(k) for k in ("content_top", "hero_title_px", "explainers", "bottom_margin", "records")}, default=str)[:700])


def px_sizes(fonts, scale):
    return {k: round(v * scale, 1) for k, v in fonts.items() if v}


# ---------------------------------------------------------------- feed shots 1 to 4: one hero card, at most two below ---------------

BOTTOM_BAND = 60  # canvas px above the bottom edge that must hold no text when something runs off the canvas


def band_free(lines, edge, band):
    """True when no text line (top, bottom) reaches into the band [edge - band, edge] (all in the same units). Lines wholly below
    the edge are cut away and do not count."""
    return not any(l0 < edge and l1 > edge - band for l0, l1, *_ in lines)


def edge_ok(lines, edge, margin=3):
    return not any(l0 - margin < edge < l1 + margin for l0, l1, *_ in lines)


def plan_stack(t, geoms, hero, below, lift_ls, peek_ls):
    """Positions for the hero and the cards below it (all in canvas px). Returns None when the last card cannot be cut cleanly."""
    hg = geoms[hero]
    hero_h = (hg["intent"]["y"] - 1 + 12) * lift_ls
    y = t["content_top"] + hero_h
    out = []
    for i, (title, upto) in enumerate(below):
        g = geoms[title]; last = i == len(below) - 1
        h_css = ((g["intent"]["y"] - 1) if upto == "head" else (g["feedback"]["y"] if g["feedback"] else g["h"])) + 12
        h = h_css * peek_ls
        top = y + t["gap"]
        if last and top + h > t["H"] - BOTTOM_BAND:
            # runs off (or would end too close): nudge the gap so the edge cuts the card body with no text in the last 60 px
            best = None
            for d in sorted(range(-40, 61), key=abs):
                if top + d + h <= t["H"] - BOTTOM_BAND - 4:
                    best = d; break  # ends whole, its outline 60 px or more above the edge
                e = (t["H"] - (top + d)) / peek_ls
                # runs off clearly: at least 60 px of the card is below the edge, and the last 60 px above it hold no text
                if (h - (t["H"] - (top + d))) >= BOTTOM_BAND and e >= g["meta"]["y"] + g["meta"]["h"] + 2 and band_free(g["lines"], e, BOTTOM_BAND / peek_ls):
                    best = d; break
            if best is None:
                return None
            top += best
        out.append(top)
        y = top + h
    return out, max(0, t["H"] - y)


def stack_shot(browser, plat, shot, feed, vws, hero, below, ring=None):
    """hero: title of the hero card (cropped above its explainer). below: [(title, upto)] in feed order; the last one may run off the
    bottom edge (the edge always falls between two lines of text, after its distance line). ring: None | 'distance' | 'title'.
    vws: capture widths tried in order (widest first); the first that fills the canvas (bottom gap <= max_margin) is used."""
    t = T[plat]; name = shot["name"]
    chosen = None
    # first as asked; if no width works, the last card is cropped above its explainer too and must end whole, 60 px or more above
    # the edge (a card that runs off needs 60 px of text-free body at the edge, which a feed card does not have on every canvas)
    layouts = [below] + ([below[:-1] + [(below[-1][0], "head")]] if below and below[-1][1] == "body" else [])
    captures = {}
    for lay in layouts:
        for vw in vws:
            if vw not in captures:
                ctx2, p2, tall = feed_capture(browser, plat, vw, feed)
                geoms = {x: p2.evaluate(CARD_GEOM, x) for x in [hero] + [b[0] for b in below]}
                order = p2.evaluate("() => [...document.querySelectorAll('article.card .alert-title')].map(e => e.textContent)")
                ctx2.close()
                assert all(geoms.values()), geoms
                captures[vw] = (tall, geoms, order)
            tall, geoms, order = captures[vw]
            lift_ls = t["lift_w"] / geoms[hero]["w"]; peek_ls = t["peek_w"] / geoms[hero]["w"]
            plan = plan_stack(t, geoms, hero, lay, lift_ls, peek_ls)
            max_margin = 200 if plat == "ios" else 150
            hh = [round((geoms[x]["intent"]["y"] + 11) * (lift_ls if x == hero else peek_ls)) for x in [hero] + [b[0] for b in lay]]
            print(f"   stack {plat} {name} vw {vw} {[m for _, m in lay]}: {'no clean cut' if not plan else f'bottom margin {plan[1]:.0f}'} head heights {hh}")
            if plan and (plan[1] == 0 or BOTTOM_BAND + 4 <= plan[1] <= max_margin):
                chosen = (vw, tall, geoms, order); below = lay; break
        if chosen: break
    assert chosen, ("no capture width fills the canvas", plat, name)
    vw, tall, geoms, order = chosen
    # the cards appear in the shot in the same order the real feed lists them
    idx = [order.index(x) for x in [hero] + [b[0] for b in below]]
    assert idx == sorted(idx), ("cards out of feed order", order)
    h = card_crop(tall, geoms[hero], "head", f"{plat}-{name}-hero.png", t["lift_w"])
    assert h["ls"] * geoms[hero]["fonts"]["title"] >= t["hero_min"], ("hero title too small", h["ls"] * geoms[hero]["fonts"]["title"])
    tops, _ = plan_stack(t, geoms, hero, below, h["ls"], t["peek_w"] / geoms[hero]["w"])
    ctx, page, hm = header_page(browser, plat, name, shot["head"], shot["sub"], shot["bg"])
    hx = (t["W"] - h["size"][0]) / 2; hy = t["content_top"]
    radius = 16 * h["ls"]
    add(page, img_html(h["path"], hx, hy, h["size"][0], h["size"][1], cls="lift", style=f"border-radius:{radius:.0f}px"))
    placed = [dict(title=hero, role="hero", top=hy, bottom=hy + h["size"][1], width=h["size"][0], explainer_visible=False,
                   title_px=round(h["ls"] * geoms[hero]["fonts"]["title"], 1), sizes=px_sizes(geoms[hero]["fonts"], h["ls"]))]
    y = hy + h["size"][1]
    explainers = 0
    for i, (title, upto) in enumerate(below):
        g = geoms[title]
        c = card_crop(tall, g, upto, f"{plat}-{name}-below{i}.png", t["peek_w"])
        s = c["ls"]; cx = (t["W"] - c["size"][0]) / 2
        top = round(tops[i])
        add(page, img_html(c["path"], cx, top, c["size"][0], c["size"][1], cls="peek", style=f"border-radius:{16 * s:.0f}px"))
        exp_vis = upto == "body" and g["intent"] and top + (g["intent"]["y"] + 8) * s < t["H"]
        explainers += 1 if exp_vis else 0
        placed.append(dict(title=title, role="context", top=top, bottom=round(top + c["size"][1]), width=c["size"][0], upto=upto,
                           runs_off=top + c["size"][1] > t["H"], explainer_visible=bool(exp_vis), title_px=round(s * g["fonts"]["title"], 1),
                           sizes=px_sizes(g["fonts"], s)))
        y = top + c["size"][1]
    assert explainers <= 1, ("explainer sentence shown more than once", plat, name)
    rings = []
    if ring:
        # candidates in order of preference; place_rings keeps the first that clears every text pixel by 12 px
        part = {"distance": "strong", "title": "title", "meta": "meta"}
        names = {"distance": "distance", "title": "title", "meta": "place, time and distance row"}
        rings.append([ring_spec(hx + r["x"] * h["ls"], hy + r["y"] * h["ls"], r["w"] * h["ls"], r["h"] * h["ls"], "accent", names[k])
                      for k in ring for r in [geoms[hero][part[k]]]])
    bottom_margin = max(0, t["H"] - y)
    info = dict(head=hm, content_top=hy, hero_title_px=placed[0]["title_px"], hero_sizes=placed[0]["sizes"], layout=placed, explainers=explainers,
                explainer_on_hero=False, bottom_margin=round(bottom_margin), feed=feed, profile=DATA["profiles"][feed], vw=vw,
                records=records_of(feed, [hero] + [b[0] for b in below]), ui_px=dict(title=placed[0]["title_px"], **{k: v for k, v in placed[0]["sizes"].items() if k != "title"}))
    finish(page, ctx, plat, name, info, rings)


VWS = {"ios": (320, 310, 300, 292, 284, 276, 268, 260), "android": (320, 310, 300, 290, 280, 270, 260, 340, 360)}


def shot01(browser, plat, shot):
    # 60614, roofing: the Roof permit, then the next roofing record in the same feed, a code violation (REPAIR ROOF).
    stack_shot(browser, plat, shot, "01-know-when", VWS[plat],
               "Roof permit in Chicago", [("Code violation in Chicago: REPAIR ROOF", "body")])


def shot02(browser, plat, shot):
    # 33301 Fort Lauderdale, FL: the SPC hail report near Hollywood (7.4 mi), then the Broward warning (3.1 mi) of the same feed.
    stack_shot(browser, plat, shot, "02-storm", VWS[plat],
               "1.00 inch hail reported near 2 W Hollywood, FL", [("Severe Thunderstorm Warning: Broward, FL; Miami-Dade, FL", "body")], ring=("distance", "title"))


def shot03(browser, plat, shot):
    stack_shot(browser, plat, shot, "03-permits", VWS[plat],
               "Plumbing permit in Chicago", [("HVAC permit in Chicago", "head"), ("Window and door permit in Chicago", "body")], ring=("distance", "meta"))


def shot04(browser, plat, shot):
    stack_shot(browser, plat, shot, "04-311", VWS[plat],
               "311 request in Chicago: Tree Emergency", [("Code violation in Chicago: REPAIR PORCH SYSTEM", "body")], ring=("title",))


# ---------------------------------------------------------------- 5: the detail card -----------------------------------------------

def shot05(browser, plat, shot):
    """AlertDetail for the HVAC permit (row 33435, a commercial address). The button opens the city's dataset page, so the headline
    says "source", not "record". The card is captured at the narrowest viewport whose enlarged card still ends 60 to 240 px above
    the bottom edge, starting at the shared content top."""
    t = T[plat]; name = shot["name"]; feed = "05-source-link"
    chosen = None
    for vw in (range(340, 239, -5) if plat == "ios" else range(360, 239, -5)):
        ctx2, p2, errors = open_app(browser, plat, vw, 2400, feed=feed)
        p2.wait_for_selector(".alert-card"); p2.click(".alert-card"); p2.wait_for_selector("text=Open the source record")
        settle(p2); bad_text(p2)
        r = p2.evaluate("""() => { const a = document.querySelector('article.card'); const b = a.getBoundingClientRect();
          const btn = [...a.querySelectorAll('button')].find(x => x.textContent.trim() === 'Open the source record'); const bb = btn.getBoundingClientRect();
          const fs = (s) => { const e = a.querySelector(s); return e ? parseFloat(getComputedStyle(e).fontSize) : null; };
          return {x: b.left, y: b.top, w: b.width, h: bb.bottom + 10 - b.top, btn: {x: bb.left - b.left, y: bb.top - b.top, w: bb.width, h: bb.height},
            btnClass: btn.className, title: a.querySelector('.alert-title').textContent, text: a.innerText,
            fonts: {title: fs('.alert-title'), meta: fs('.meta'), explainer: fs('.intent-line'), source: fs('.source-line'), button: parseFloat(getComputedStyle(btn).fontSize)}}; }""")
        lo, hi = 60, (240 if plat == "ios" else 150)
        # widest card (lift_w down to lift_w - 100) that leaves a 60 to 240 (Android 150) px margin under it
        width = t["lift_w"]
        while width > t["lift_w"] - 100 and t["H"] - t["content_top"] - r["h"] * width / r["w"] < lo:
            width -= 4
        margin = t["H"] - t["content_top"] - r["h"] * width / r["w"]
        if lo <= margin <= hi:
            chosen = (vw, r, p2.screenshot(type="png"), ctx2)
            break
        ctx2.close()
        if margin < lo:
            raise RuntimeError(f"shot 5: no viewport gives a {lo}-{hi} px bottom margin (last {vw}: {margin:.0f})")
    vw, r, png, ctx2 = chosen
    ctx2.close()
    p = TMP / f"{plat}-{name}-tall.png"; p.write_bytes(png)
    tall = Image.open(p).convert("RGB")
    assert "primary" in r["btnClass"], r
    ctx, page, hm = header_page(browser, plat, name, shot["head"], shot["sub"], shot["bg"])
    lp, lsize = save_scaled(crop_css(tall, r), width, f"{plat}-{name}-card.png")
    ls = width / r["w"]
    x = (t["W"] - lsize[0]) / 2; y = t["content_top"]
    add(page, img_html(lp, x, y, lsize[0], lsize[1], cls="lift", style=f"border-radius:{16 * ls:.0f}px"))
    b = r["btn"]
    ring = [ring_spec(x + b["x"] * ls, y + b["y"] * ls, b["w"] * ls, b["h"] * ls, "ink", "Open the source record button", mode="box", radius=b["h"] * ls / 2)]
    info = dict(head=hm, content_top=y, lift_scale=ls, vw=vw, ui_px=px_sizes(r["fonts"], ls),
                bottom_margin=round(t["H"] - y - lsize[1]), records=records_of(feed, [r["title"]]), card_text=r["text"], explainers=1, feed=feed,
                profile=DATA["profiles"][feed])
    finish(page, ctx, plat, name, info, [ring])


# ---------------------------------------------------------------- 6: trades and radius ---------------------------------------------

def shot06(browser, plat, shot):
    """Onboarding form, two crops. Android tries wider capture viewports until the pair fits (chips flow into fewer rows)."""
    tries = [(300, True)] if plat == "ios" else [(vw, extra) for extra in (True, False) for vw in (320, 340, 360, 380, 400, 420)]
    for vw, extra in tries:
        if _shot06_at(browser, plat, shot, vw, extra):
            return
    raise RuntimeError("shot 6 does not fit")


def _shot06_at(browser, plat, shot, vw, extra_row):
    t = T[plat]; name = shot["name"]
    width = t["W"] - 2 * t["M"] if plat == "ios" else 936

    def prep(page):
        page.wait_for_selector("#zip")
        page.wait_for_selector(".chip")
        page.fill("#zip", "60614")
        for label in ("Roofing", "Heating and air (HVAC)", "Plumbing", "Electrical"):
            page.get_by_role("button", name=label, exact=True).click()
        page.evaluate("""() => { const el = document.getElementById('radius'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          set.call(el, '15'); el.dispatchEvent(new Event('input', {bubbles: true})); }""")
        page.wait_for_selector("text=How far you travel: 15 miles")

    ctx2, p2, errors = open_app(browser, plat, vw, 2400, me="onboarding", feed="01-know-when")
    prep(p2); settle(p2); bad_text(p2)
    tall = shot_png(p2, TMP / f"{plat}-{name}-tall.png")
    g = p2.evaluate("""() => { const R = (e) => { const b = e.getBoundingClientRect(); return {x: b.left, y: b.top, w: b.width, h: b.height, b: b.bottom}; };
      const T = (e) => { const r = document.createRange(); r.selectNodeContents(e); const b = r.getBoundingClientRect(); return {x: b.left, y: b.top, w: b.width, h: b.height}; };
      const chips = [...document.querySelectorAll('.chip')].map(c => ({...R(c), on: c.getAttribute('aria-pressed') === 'true', label: c.textContent.trim()}));
      return {chips, trades: R(document.getElementById('trades-label')), zip: R(document.querySelector('label[for=zip]')),
        submit: R(document.querySelector('button[type=submit]')), radiusLabel: T(document.querySelector('label[for=radius]')), slider: R(document.getElementById('radius')),
        zipVal: document.getElementById('zip').value, radius: document.getElementById('radius').value,
        picked: chips.filter(c => c.on).map(c => c.label), vw: window.innerWidth}; }""")
    assert not errors, errors
    ctx2.close()
    assert g["zipVal"] == "60614" and g["radius"] == "15" and len(g["picked"]) == 4, g
    rows = []
    for rb in sorted(c["b"] for c in g["chips"]):
        if not rows or rb - rows[-1] > 6:
            rows.append(rb)
        else:
            rows[-1] = max(rows[-1], rb)
    picked_bottom = max(c["b"] for c in g["chips"] if c["on"])
    if plat == "ios":
        i = next(k for k, rb in enumerate(rows) if rb >= picked_bottom - 1)
        end_row = rows[min(i + 1, len(rows) - 1)]
    else:
        el = next(c["b"] for c in g["chips"] if c["label"] == "Electrical")
        i = next(k for k, rb in enumerate(rows) if rb >= el - 1)
        end_row = rows[min(i + 1, len(rows) - 1)] if extra_row else rows[i]  # one unpicked row too, when it fits
    unpicked_shown = [c["label"] for c in g["chips"] if not c["on"] and c["b"] <= end_row + 1]
    rA = {"x": 0, "y": g["trades"]["y"] - 16, "w": g["vw"], "h": end_row + 7 - (g["trades"]["y"] - 16)}
    rB = {"x": 0, "y": g["zip"]["y"] - 16, "w": g["vw"], "h": g["submit"]["b"] + 16 - (g["zip"]["y"] - 16)}
    ctx, page, hm = header_page(browser, plat, name, shot["head"], shot["sub"], shot["bg"])
    gap = 48 if plat == "ios" else 20
    y0 = t["content_top"]
    min_margin = BOTTOM_BAND
    while True:  # widest that fits below the shared content top with at least 60 px under it
        s = width / g["vw"]
        total = (rA["h"] + rB["h"]) * s + 8 + gap
        if y0 + total + min_margin <= t["H"]:
            break
        width -= 10
        if width * 14 / g["vw"] < (40 if plat == "ios" else 33):  # the 14 px hint would fall under the floor: try a wider viewport
            print(f"   shot 6 {plat} vw {vw} extra_row {extra_row}: no fit (width {width}, crops {rA['h']:.0f}+{rB['h']:.0f} css)")
            ctx.close()
            return False
    if width * 14 / g["vw"] < (40 if plat == "ios" else 33) or not unpicked_shown:
        print(f"   shot 6 {plat} vw {vw} extra_row {extra_row}: no fit (width {width}, crops {rA['h']:.0f}+{rB['h']:.0f} css, unpicked {unpicked_shown})")
        ctx.close()
        return False
    pa, sa = save_scaled(crop_css(tall, rA), width, f"{plat}-{name}-a.png")
    pb, sb = save_scaled(crop_css(tall, rB), width, f"{plat}-{name}-b.png")
    s = width / g["vw"]
    x = (t["W"] - width) / 2
    card = f"border-radius:{t['lift_r']}px;border:2px solid {TOK['line']};overflow:hidden;box-sizing:content-box;"
    add(page, img_html(pa, x - 2, y0, sa[0], sa[1], style=card))
    yb = y0 + sa[1] + 4 + gap
    add(page, img_html(pb, x - 2, yb, sb[0], sb[1], style=card))
    rl = g["radiusLabel"]
    ox, oy = x, yb + 2 - rB["y"] * s
    # the label only: the slider's light track would make a ring around it read as an empty box
    sl = g["slider"]
    ux0 = min(rl["x"], sl["x"]); uy0 = rl["y"]; ux1 = max(rl["x"] + rl["w"], sl["x"] + sl["w"]); uy1 = sl["y"] + sl["h"]
    ring = [ring_spec(ox + ux0 * s, oy + uy0 * s, (ux1 - ux0) * s, (uy1 - uy0) * s, "accent", "radius label and slider", mode="box", radius=20, on="paper"),
            ring_spec(ox + rl["x"] * s, oy + rl["y"] * s, rl["w"] * s, rl["h"] * s, "accent", "radius label", on="paper")]
    info = dict(head=hm, content_top=y0, crop_scale=s, vw=vw, unpicked_shown=unpicked_shown, ui_px=px_sizes({"chip": 15, "label": 15, "hint": 14, "button": 16}, s),
                picked=g["picked"], width=width,
                layout=dict(a=(y0, y0 + sa[1]), b=(yb, yb + sb[1])), bottom_margin=round(t["H"] - (yb + sb[1] + 4)), records=[])
    assert 0 < info["bottom_margin"] <= 240, info
    finish(page, ctx, plat, name, info, [ring])
    return True


# ---------------------------------------------------------------- 7: the push over the Alerts feed ----------------------------------

def push_card_html(plat, push):
    t = T[plat]
    mark = t["push_mark"]
    mark_svg = (f'<svg width="{mark}" height="{mark}" viewBox="0 0 32 32" aria-hidden="true" style="flex:none"><rect width="32" height="32" rx="9" fill="{TOK["accent"]}"/>'
                '<circle cx="16" cy="16" r="3.2" fill="#FFFFFF"/><path d="M21.36 11.5A7 7 0 0 1 21.36 20.5M10.64 11.5A7 7 0 0 0 10.64 20.5" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" fill="none"/>'
                '<path d="M24.81 8.61A11.5 11.5 0 0 1 24.81 23.39M7.19 8.61A11.5 11.5 0 0 0 7.19 23.39" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" opacity="0.7" fill="none"/></svg>')
    nx0, nx1 = t["M"] - 20, t["W"] - t["M"] + 20
    return f'''<div id="push" class="abs" style="left:{nx0}px;top:{t["content_top"]}px;width:{nx1 - nx0}px;box-sizing:border-box;background:{TOK["white"]};
      border:4px solid {TOK["ink"]};border-radius:{t["lift_r"]}px;display:flex;align-items:center;gap:{t["push_pad"] - 8}px;padding:{t["push_vpad"]}px {t["push_pad"]}px;font-family:Geist;color:{TOK["ink"]};z-index:5">
      {mark_svg}<div style="min-width:0"><div id="pt" style="font-weight:600;font-size:{t["push_title"]}px;line-height:1.2;white-space:nowrap">{esc(push["title"])}</div>
      <div id="pb" style="font-weight:400;font-size:{t["push_body"]}px;line-height:1.25;white-space:nowrap">{esc(push["body"])}</div></div></div>'''


def shot07(browser, plat, shot):
    """The real Alerts feed of a windows-and-doors member (60614) in the frame, the matching "Window and door permit in Chicago" card
    first. At the shared content top, a flat card with exactly the text buildNotification() builds for that record; it overlaps the
    frame's top edge and the screen's top bar, never the feed card. The viewport and frame top are chosen so the canvas edge cuts the
    second card after its title and before its explainer (the sentence shows once, on the first card)."""
    t = T[plat]; name = shot["name"]; feed = "07-push"
    push = DATA["push"]
    first = "Window and door permit in Chicago"; second = "HVAC permit in Chicago"
    assert push["body"] == first, push
    ctx, page, hm = header_page(browser, plat, name, shot["head"], shot["sub"], shot["bg"])
    add(page, push_card_html(plat, push))
    pm = page.evaluate("""() => { const d = document.getElementById('push'); const r = d.getBoundingClientRect(); const t = d.lastElementChild;
      return {top: r.top, bottom: r.bottom, h: r.height, sw: t.scrollWidth, cw: t.clientWidth, title: parseFloat(getComputedStyle(document.getElementById('pt')).fontSize),
        body: parseFloat(getComputedStyle(document.getElementById('pb')).fontSize)}; }""")
    assert pm["sw"] <= pm["cw"] + 1, ("push text overflows", pm)
    ctx2, p2, errors = open_app(browser, plat, 300, 1400, feed=feed)
    p2.wait_for_selector(".alert-card"); settle(p2); bad_text(p2)
    pick = None
    # Android needs 60 text-free px above the edge (commander pass 3). On iOS that band only exists between the two feed cards, which
    # would drop the frame far below the push card, so iOS falls back to a 12 px band (the edge between two lines, after the
    # second card's distance line and before its explainer).
    for band in ((BOTTOM_BAND,) if plat == "android" else (BOTTOM_BAND, 12)):
     for vw in range(292, 239, -1):
         p2.set_viewport_size({"width": vw, "height": 1400}); p2.wait_for_timeout(60)
         scale = t["screen_w"] / vw
         a = p2.evaluate(CARD_GEOM, first); b = p2.evaluate(CARD_GEOM, second)
         order = p2.evaluate("() => [...document.querySelectorAll('article.card .alert-title')].map(e => e.textContent)")
         assert order[:2] == [first, second], order
         if a["fonts"]["title"] * scale < t["hero_min"]:
             continue
         if p2.evaluate("() => { const h = document.querySelector('.topbar h1'); return h.scrollWidth > h.clientWidth + 1; }"):
             continue  # the top bar title would be cut to "Al..." at this width
         # the top bar's first glyph (the mark, the title text, the Refresh text; not the 44 px button box)
         bar_top = p2.evaluate("""() => { const tops = [...document.querySelectorAll('.topbar svg')].map(e => e.getBoundingClientRect().top);
           for (const e of document.querySelectorAll('.topbar h1, .topbar button')) { const r = document.createRange(); r.selectNodeContents(e); tops.push(r.getBoundingClientRect().top); }
           return Math.min(...tops); }""")
         bar_bottom = p2.evaluate("() => document.querySelector('.topbar').getBoundingClientRect().bottom")
         slines = p2.evaluate(SCREEN_LINES)
         # the edge cuts the feed above the second card's explainer, with no text in the last 60 canvas px (it may fall in the gap
         # between the two cards, so only the top of the second card shows)
         for e10 in range(round((b["y"] + b["intent"]["y"] - 2) * 10), round((b["y"] - 40) * 10), -5):
             e = e10 / 10
             ft = t["H"] - t["bezel"] - e * scale
             if ft < pm["top"] or not band_free(slines, e, band / scale):
                 continue
             card_room = ft + t["bezel"] + a["y"] * scale - 20  # the push card always ends 20 px or more above the feed card
             # (A) the push card overlaps the frame's top edge by 12 px or more and ends 12 px or more above the top bar's first glyph;
             # (B) the frame's top is hidden under the push card, which covers the whole top bar. It may grow (padding only) by 90 px.
             options = []
             if ft >= pm["top"] + 20:
                 options.append((max(ft + 12, pm["bottom"]), min(ft + t["bezel"] + bar_top * scale - 12, card_room, pm["bottom"] + 90), "on the frame's top edge"))
             options.append((max(ft + t["bezel"] + bar_bottom * scale + 4, pm["bottom"]), min(card_room, pm["bottom"] + 90), "covers the top bar"))
             hit = next((o for o in options if o[0] <= o[1]), None)
             if hit:
                 pick = (vw, round(ft), round(hit[0]), hit[2], band); break
         if pick: break
     if pick: break
    assert pick, "shot 7: no viewport and frame top cut the feed above the second card's explainer with a clear bottom band"
    ctx2.close()
    vw, ft, push_bottom, push_mode, band_used = pick; scale = t["screen_w"] / vw; vis = (t["H"] - ft - t["bezel"]) / scale
    ctx2, p2, errors = open_app(browser, plat, vw, int(vis + 160), feed=feed)
    p2.wait_for_selector(".alert-card"); settle(p2); bad_text(p2)
    a = p2.evaluate(CARD_GEOM, first); b = p2.evaluate(CARD_GEOM, second)
    lines = p2.evaluate(SCREEN_LINES)
    full = shot_png(p2, TMP / f"{plat}-{name}-screen-full.png")
    assert not errors, errors
    ctx2.close()
    # 8 CSS px more than the canvas shows: the frame's white never peeks through under the last row
    sp, ssize = save_scaled(full.crop((0, 0, full.width, round((vis + 8) * DSF))), t["screen_w"], f"{plat}-{name}-screen.png")
    add(page, frame_html(plat, ft, sp, ssize))
    page.evaluate(f"() => {{ document.getElementById('push').style.minHeight = '{push_bottom - pm['top']}px'; }}")
    pm.update(page.evaluate("() => { const r = document.getElementById('push').getBoundingClientRect(); return {top: r.top, bottom: r.bottom, h: r.height}; }"))
    sy = ft + t["bezel"]
    card_top = sy + a["y"] * scale
    assert pm["bottom"] <= card_top - 19 and pm["bottom"] >= ft + 12 and ft >= pm["top"], ("push placement", pm, ft, card_top)
    exp_first = a["intent"] is not None and sy + (a["y"] + a["intent"]["y"]) * scale < t["H"]
    exp_second = sy + (b["y"] + b["intent"]["y"] + 4) * scale < t["H"]
    assert not exp_second
    info = dict(head=hm, content_top=round(pm["top"]), frame_top=ft, scale=scale, vw=vw, hero_title_px=round(a["fonts"]["title"] * scale, 1),
                ui_px=dict(title=round(a["fonts"]["title"] * scale, 1), **{k: v for k, v in px_sizes(a["fonts"], scale).items() if k != "title"}),
                push=dict(text=push, title_px=pm["title"], body_px=pm["body"], top=round(pm["top"]), bottom=round(pm["bottom"]), placement=push_mode, overlap_frame=round(pm["bottom"] - ft)),
                bottom_band=band_used, explainers=int(exp_first) + int(exp_second), cut=[l for l in lines if l[0] - 2 < vis < l[1] + 2], rings=[], bottom_margin=0,
                records=records_of(feed, [first, second]) + [(push["signalId"], "push text", None)], feed=feed, profile=DATA["profiles"][feed])
    finish(page, ctx, plat, name, info, [])


# ---------------------------------------------------------------- 8: price ---------------------------------------------------------

def shot08(browser, plat, shot):
    t = T[plat]; name = shot["name"]
    rings = []
    hd = shot if plat == "ios" else dict(shot, **shot["android"])
    ctx, page, hm = header_page(browser, plat, name, hd["head"], hd["sub"], shot["bg"])
    if plat == "ios":
        # The ringed element is the real trial surface: the Feed's banner for a new account (TRIAL_DAYS left), read from the live app.
        ctx2, p2, tall = feed_capture(browser, plat, 340, "08-price", me="trial")
        n = p2.evaluate("""() => { const e = document.querySelector('.notice.info'); const b = e.getBoundingClientRect();
          return {x: b.left, y: b.top, w: b.width, h: b.height, text: e.innerText, px: parseFloat(getComputedStyle(e).fontSize)}; }""")
        ctx2.close()
        assert n["text"].startswith(f"{TRIAL_DAYS} days left in your free trial.") and "See plans" in n["text"], n
        bp, bsize = save_scaled(crop_css(tall, n), t["lift_w"] - 40, f"{plat}-{name}-banner.png")
        bs = bsize[0] / n["w"]
        bx = (t["W"] - bsize[0]) / 2; by = t["content_top"] + t["ring"] + RING_CLEAR + 1
        add(page, img_html(bp, bx, by, bsize[0], bsize[1], cls="plain", style=f"border-radius:{12 * bs:.0f}px"))
        rings.append([ring_spec(bx, by, bsize[0], bsize[1], "ink", "trial banner", mode="box", radius=12 * bs, on="accent background")])
        cards_top = by + bsize[1] + RING_CLEAR + 1 + t["ring"] + 56
        content_top = round(by - RING_CLEAR - 1 - t["ring"])
        extra = dict(banner_text=n["text"], banner_box=[bx, by, bx + bsize[0], by + bsize[1]])
        ui = dict(banner=round(n["px"] * bs, 1))
    else:
        # Android: no trial banner (its own text says "free trial"); the two plan cards start at the shared content top.
        cards_top = t["content_top"]; content_top = t["content_top"]; extra = {}; ui = {}
    # the real Plans screen's two plan cards (launch state, Monthly picked), whole: Solo, then Pro with its name
    ctx3, p3, errors = open_app(browser, plat, 340, 1600, me="trial", feed="08-price")
    p3.wait_for_selector(".alert-card"); p3.wait_for_function(NAVIGATE, arg=None); p3.evaluate(NAVIGATE, {"name": "paywall"})
    p3.get_by_role("button", name="Monthly", exact=True).click(); p3.wait_for_selector("text=$13.99 a month"); settle(p3); bad_text(p3)
    body = p3.inner_text("body")
    assert "free trial" not in body.lower() and "Subscribe to Solo" in body and "Subscribe to Pro" in body, body
    plans = p3.evaluate("""() => [...document.querySelectorAll('.plan')].map(a => { const b = a.getBoundingClientRect(); const pr = a.querySelector('.price');
      const r = document.createRange(); r.selectNodeContents(pr); const tb = r.getBoundingClientRect();
      return {x: b.left, y: b.top, w: b.width, h: b.height, name: a.querySelector('h3').textContent, text: a.innerText, pricePx: parseFloat(getComputedStyle(pr).fontSize),
        listPx: parseFloat(getComputedStyle(a.querySelector('li')).fontSize), price: {x: tb.left - b.left, y: tb.top - b.top, w: tb.width, h: tb.height}}; })""")
    ptall = shot_png(p3, TMP / f"{plat}-{name}-plans-tall.png")
    assert not errors, errors
    ctx3.close()
    solo = next(x for x in plans if x["name"] == "Solo"); pro = next(x for x in plans if x["name"] == "Pro")
    gap = 40 if plat == "ios" else 32
    avail = t["H"] - BOTTOM_BAND - 40 - (cards_top + gap)  # aim for about 100 px under the Pro card
    cw = min(t["lift_w"], int(avail / (solo["h"] + pro["h"]) * solo["w"]))
    cs = cw / solo["w"]
    ys = round(cards_top); yp = round(ys + solo["h"] * cs + gap)
    cx = (t["W"] - cw) / 2
    for card, y, tag in ((solo, ys, "solo"), (pro, yp, "pro")):
        cp, csize = save_scaled(crop_css(ptall, card), cw, f"{plat}-{name}-{tag}.png")
        add(page, img_html(cp, cx, y, csize[0], csize[1], cls="peek", style=f"border-radius:{16 * cs:.0f}px"))
    bottom = yp + pro["h"] * cs
    assert BOTTOM_BAND <= t["H"] - bottom <= (240 if plat == "ios" else 160), ("shot 8: plan cards do not fit", plat, bottom)
    if plat == "android":
        pr = solo["price"]
        rings.append([ring_spec(cx + pr["x"] * cs, ys + pr["y"] * cs, pr["w"] * cs, pr["h"] * cs, "accent", "Solo price")])
    ui.update(price=round(solo["pricePx"] * cs, 1), list=round(solo["listPx"] * cs, 1))
    extra.update(bottom_margin=round(t["H"] - bottom), plan_width=cw)
    pf = dict(solo=solo, pro=pro, frame_top=None, shift=None, pro_shown="labelled", vw=340)
    info = dict(head=hm, content_top=content_top, frame_top=pf["frame_top"], frame_shift=pf["shift"], ui_px=ui,
                plan_text=pf["solo"]["text"], pro_text=pf["pro"]["text"], pro_shown=pf["pro_shown"], vw=pf.get("vw"), records=[], **extra)
    finish(page, ctx, plat, name, info, rings)


RUN = {"01-know-when": shot01, "02-storm-hail": shot02, "03-permits": shot03, "04-311": shot04, "05-source-link": shot05,
       "06-trade-radius": shot06, "07-push": shot07, "08-price": shot08}


def contact_sheet():
    W, margin, gap, cols = 2400, 60, 50, 4
    cw = (W - 2 * margin - gap * (cols - 1)) // cols
    ch = round(cw * 2868 / 1320)
    label_h = 80
    H = margin * 2 + 2 * (ch + label_h) + gap
    sheet = Image.new("RGB", (W, H), TOK["white"])
    d = ImageDraw.Draw(sheet)
    font = ImageFont.truetype(str(GEIST / "Geist-SemiBold.ttf"), 46)
    for i, s in enumerate(SHOTS):
        r, c = divmod(i, cols)
        x = margin + c * (cw + gap); y = margin + r * (ch + label_h + gap)
        d.text((x, y + 8), str(i + 1), font=font, fill=TOK["ink"])
        im = Image.open(OUT / "ios" / f"{s['name']}.png").convert("RGB").resize((cw, ch), Image.LANCZOS)
        sheet.paste(im, (x, y + label_h))
        d.rectangle([x, y + label_h, x + cw - 1, y + label_h + ch - 1], outline=TOK["line"], width=2)
    sheet.save(OUT / "contact-sheet.png", "PNG", optimize=True)


def thumb_strip():
    """The search-result test: iOS 1 to 3 at 115 px wide (and 230 px below), Lanczos, on white, 100% zoom."""
    pad, gap = 20, 16
    rows = []
    for w in (115, 230):
        ims = [Image.open(OUT / "ios" / f"{s['name']}.png").convert("RGB") for s in SHOTS[:3]]
        rows.append([im.resize((w, round(im.height * w / im.width)), Image.LANCZOS) for im in ims])
    W = pad * 2 + max(sum(i.width for i in r) + gap * (len(r) - 1) for r in rows)
    H = pad * 2 + sum(r[0].height for r in rows) + gap * 2
    strip = Image.new("RGB", (W, H), "#FFFFFF")
    y = pad
    for r in rows:
        x = pad
        for im in r:
            strip.paste(im, (x, y)); x += im.width + gap
        y += r[0].height + gap * 2
    strip.save(OUT / "thumb-strip.png", "PNG", optimize=True)


def main():
    only = sys.argv[1:]
    srv = subprocess.Popen(["node", str(HERE / "mock-api.mjs"), str(PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    try:
        for _ in range(50):
            try: urllib.request.urlopen(f"{BASE}/api/m/config").read(); break
            except Exception: time.sleep(0.1)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--no-sandbox", "--hide-scrollbars", "--allow-file-access-from-files"])
            for plat in ("ios", "android"):
                for s in SHOTS:
                    if only and s["name"] not in only: continue
                    RUN[s["name"]](browser, plat, s)
            browser.close()
        if not only:
            contact_sheet(); thumb_strip()
        prev = json.loads((GEN / "metrics.json").read_text()) if (GEN / "metrics.json").exists() and only else {"shots": {}}
        prev["shots"].update(METRICS["shots"])
        (GEN / "metrics.json").write_text(json.dumps(prev, indent=1, default=str))
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
