#!/usr/bin/env python3
"""Builds the store screenshot set (round 10 art direction, /home/claude/gates/r10/CONTEXT.md; plan in /home/claude/gates/r10/shot-plan.md).

  1. node store/build-data.mjs        real holler_signals rows -> .gen/data.json (one member profile per scenario, server matchOne)
  2. capture builds of the real app   SHOT_PLATFORM=ios|android npx vite build -c store/vite.capture.config.mjs   (build-captures.sh)
  3. python3 store/make-screenshots.py

What is real and what is drawn:
  * Every hero is the REAL built app (mobile/src, untouched) rendered by /usr/bin/google-chrome at deviceScaleFactor 4 against
    store/mock-api.mjs, which serves real rows from fixtures/real-signals.json to one member profile per scenario, then downscaled with
    Lanczos to its exact size on the canvas. A hero is either one phone screen (the top of the real viewport, in a flat frame that runs
    off the bottom edge) or one real card cropped from a real screen.
  * This script draws only: the flat background, the eyebrow, the headline, the supporting line, the phone frame, and for a card the
    card's own border repeated along the crop's bottom edge (a frame). No rings, no outlines around text, no badges, no shadow.
  * Prices and the trial length are read at run time from the web lib files (lib/stripe/plans.ts, lib/auth/membership.ts through
    lib/plan/public-prices.ts into .gen/data.json); the script stops if the two disagree. No price, trial length or plan limit is typed here.
Fonts: Barlow Condensed 700, Inter (variable), JetBrains Mono (variable) from the web project's node_modules.
Writes store/screenshots/{ios,android}/NN-name.png, contact-sheet.png, thumb-strip.png and store/.gen/metrics.json (read by the checker).
"""
import json, math, re, shutil, subprocess, sys, time, urllib.request
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
MOBILE = HERE.parent
REPO = MOBILE.parent
OUT = HERE / "screenshots"
GEN = HERE / ".gen"
WORK = GEN / "work"
DIST = GEN / "dist"
PORT = 8799
BASE = f"http://127.0.0.1:{PORT}"
DSF = 4

NM = REPO / "node_modules"
FONTS = {
    "barlow": NM / "@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2",
    "inter": NM / "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
    "mono": NM / "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
}
for f in FONTS.values():
    assert f.exists(), f"font file missing: {f}"

# Brand tokens (r9 CONTEXT "Design tokens"). Only these colours are drawn by the script.
TOK = dict(green="#1E3A2C", paper="#F5F4EF", ink="#14201A", muted="#5B635D", brand_text="#2E5A41", on_brand="#F5F4EF",
           on_brand_muted="#C9D6CD", signal="#D9F046", line="#DEDCD2")
# Text colours per background: eyebrow, headline, supporting line.
TEXT = {"green": dict(eyebrow="signal", head="on_brand", sub="on_brand_muted"),
        "paper": dict(eyebrow="brand_text", head="ink", sub="muted")}

DATA = json.loads((GEN / "data.json").read_text())


# ---------------------------------------------------------------- facts read from the web lib files --------------------------------

def format_usd(cents):
    """Same rule as lib/stripe/plans.ts formatUsd: whole dollars drop the cents."""
    d, r = divmod(cents, 100)
    return f"${d}" if r == 0 else f"${d}.{r:02d}"


def lib_facts():
    plans = (REPO / "lib/stripe/plans.ts").read_text()
    m = re.search(r"PRICES_CENTS[^=]*=\s*\{\s*starter:\s*\{\s*monthly:\s*(\d+),\s*annual:\s*(\d+)\s*\}", plans)
    assert m, "PRICES_CENTS not found in lib/stripe/plans.ts"
    solo_cents = int(m.group(1))
    mem = (REPO / "lib/auth/membership.ts").read_text()
    t = re.search(r"export const TRIAL_DAYS = (\d+);", mem)
    assert t, "TRIAL_DAYS not found in lib/auth/membership.ts"
    trial = int(t.group(1))
    cfg = DATA["config"]
    # .gen/data.json is built from lib/plan/public-prices.ts by build-data.mjs; both routes must agree
    assert cfg["trialDays"] == trial, (cfg["trialDays"], trial)
    assert cfg["plans"]["solo"]["monthly"]["cents"] == solo_cents, (cfg["plans"]["solo"]["monthly"], solo_cents)
    assert cfg["plans"]["solo"]["monthly"]["display"] == format_usd(solo_cents)
    return dict(trial_days=trial, solo_monthly=cfg["plans"]["solo"]["monthly"]["display"], solo_name=cfg["plans"]["solo"]["name"])


FACTS = lib_facts()

# ---------------------------------------------------------------- the set ------------------------------------------------------------
# name, eyebrow, headline (exactly two lines), supporting line, background, hero. "android" overrides text for the Android file.
SHOTS = [
    dict(name="01-records", eyebrow="01 / Public records", head=("Public records", "near your work"), sub="Permits, storms and 311 for your trade",
         bg="green", hero="phone"),
    dict(name="02-storms", eyebrow="02 / Storms", head=("Hail and storm", "reports near you"), sub="Hail size, place and distance from you",
         bg="green", hero="card"),
    dict(name="03-radius", eyebrow="03 / Your area", head=("Only records", "inside your miles"), sub="You set the ZIP and how far",
         bg="green", hero="card"),
    dict(name="04-source", eyebrow="04 / The source", head=("Every alert", "shows its source"), sub="Open the city data it came from",
         bg="green", hero="card"),
    dict(name="05-push", eyebrow="05 / Alerts", head=("At most one", "push an hour"), sub="Email alerts too, if you want them",
         bg="green", hero="phone"),
    dict(name="06-plans", eyebrow="06 / Price", head=(f"{FACTS['trial_days']} days free,", "no card needed"),
         sub=f"Then {FACTS['solo_name']} is {FACTS['solo_monthly']} a month", bg="green", hero="phone",
         # Google Play: no price and no "free" in the image text; the plans themselves are the app's own screen
         android=dict(eyebrow="06 / Plans", head=("Solo or Pro,", "by month or year"), sub="Pro adds areas, trades and keyword watches")),
]
NAMES = [s["name"] for s in SHOTS]

# One grid. Everything is derived from these numbers; the checker reads them back from metrics.json and measures the PNGs.
G = {
    "ios": dict(W=1320, H=2868, M=110, eyebrow_top=176, eyebrow_px=34, head_gap=30, head_px=176, head_lh=0.9, sub_gap=34, sub_px=46,
                hero_top=760, bezel=26, frame_r=120, phone_vw=393, card_vw=344),
    "android": dict(W=1080, H=1920, M=80, eyebrow_top=104, eyebrow_px=27, head_gap=22, head_px=128, head_lh=0.9, sub_gap=24, sub_px=36,
                    hero_top=540, bezel=18, frame_r=88, phone_vw=400, card_vw=344),
}
for g in G.values():
    g["box_w"] = g["W"] - 2 * g["M"]                     # hero box = the text column
    g["screen_w"] = g["box_w"] - 2 * g["bezel"]
    g["phone_scale"] = g["screen_w"] / g["phone_vw"]

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

# Every visible text line (text nodes) plus buttons, chips, inputs and icons: [top, bottom, label, inScroll] in CSS px.
SCREEN_LINES = """() => { const out = []; const sc = document.querySelector('.scroll');
  const walk = document.createTreeWalker(document.querySelector('.app') || document.body, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) { const n = walk.currentNode; if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n);
    for (const b of r.getClientRects()) out.push([b.top, b.bottom, n.textContent.trim().slice(0, 50), !!(sc && sc.contains(n))]); }
  for (const e of document.querySelectorAll('.app svg, .app .btn, .app .chip, .app input, .app select')) { const b = e.getBoundingClientRect();
    if (b.height) out.push([b.top, b.bottom, '<' + e.tagName + '>', !!(sc && sc.contains(e))]); }
  return out; }"""

# Smallest computed font size of any visible text node above `limit` (CSS px).
MIN_FONT = """(limit) => { let m = 99; const walk = document.createTreeWalker(document.querySelector('.app') || document.body, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) { const n = walk.currentNode; if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n);
    const b = r.getBoundingClientRect(); if (!b.height || b.top >= limit) continue; const st = getComputedStyle(n.parentElement);
    if (st.visibility === 'hidden' || n.parentElement.closest('.sr-only')) continue; m = Math.min(m, parseFloat(st.fontSize)); }
  return m; }"""

# Feed cards visible above `limit`: title, distance label as rendered.
VISIBLE_ALERTS = """(limit) => [...document.querySelectorAll('.alert-title')].filter(e => e.getBoundingClientRect().top < limit).map(e => {
  const card = e.closest('article') || e.parentElement; const d = card.querySelector('.meta-strong');
  return {title: e.textContent, distance: d ? d.textContent : null, top: e.getBoundingClientRect().top}; })"""

METRICS = {"grid": G, "facts": FACTS, "shots": {}}


def scenario(**kw):
    req = urllib.request.Request(f"{BASE}/__scenario", data=json.dumps(kw).encode(), headers={"Content-Type": "application/json"}, method="POST")
    urllib.request.urlopen(req).read()


BAD_TEXT = ("That did not load", "couldn't", "could not", "Loading", "No alerts yet", "Prices did not load", "Something went wrong",
            "not ready", "Try again", "Not available in this build")


def bad_text(page):
    t = page.inner_text("body")
    for needle in BAD_TEXT:
        if needle in t:
            raise RuntimeError(f"unexpected text on screen: {needle!r}")
    if page.query_selector(".skeleton"):
        raise RuntimeError("skeleton still on screen")


def open_app(browser, plat, vw, vh, me, feed, route=None, ready=None):
    scenario(me=me, feed=feed)
    ctx = browser.new_context(viewport={"width": vw, "height": vh}, device_scale_factor=DSF, is_mobile=True, has_touch=True,
                              timezone_id="America/Chicago", locale="en-US", reduced_motion="reduce")
    ctx.add_init_script(f"localStorage.setItem('holler-auth', {json.dumps(json.dumps(SESSION))});")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{BASE}/{plat}/index.html")
    page.wait_for_function(NAVIGATE, arg=None)
    page.wait_for_selector(".app")
    if route:
        page.wait_for_selector(".alert-card")  # the member is loaded and on the feed; then go where the shot needs
        page.wait_for_timeout(300)
        page.evaluate(NAVIGATE, route)
    if ready:
        page.wait_for_selector(ready)
    page.evaluate("() => document.fonts.ready")
    page.wait_for_timeout(700)
    bad_text(page)
    if errors:
        raise RuntimeError(f"page errors: {errors}")
    return ctx, page


def to_png(page, clip):
    path = WORK / "cap.png"
    page.screenshot(path=str(path), type="png", clip=clip)
    return Image.open(path).convert("RGB")


def save(im, name):
    p = WORK / name
    im.save(p, "PNG")
    return p


def records_for(feed, shown):
    """[(signal id, title, distance shown, distance served)] for the alert titles seen on screen, from the very feed the mock served."""
    by = {i["title"]: i for i in DATA["feeds"][feed]}
    out = []
    for s in shown:
        it = by.get(s["title"])
        if not it:
            raise RuntimeError(f"{feed}: {s['title']!r} is not in the served feed")
        out.append(dict(signalId=it["signalId"], title=s["title"], distance=s["distance"], served=it["distanceLabel"]))
    return out


# ---------------------------------------------------------------- heroes ------------------------------------------------------------

def phone_hero(browser, plat, name, me, feed, route=None, ready=".app", prep=None):
    """The top of one real viewport, exactly as tall as the frame shows. The viewport is taller than what shows (the tab bar stays
    below the canvas); if a line of text would be cut by the canvas edge, the screen's own scroller is moved down by the fewest CSS px
    (at most 48) that put the edge between two lines."""
    g = G[plat]
    s = g["phone_scale"]
    vis = (g["H"] - g["hero_top"] - g["bezel"]) / s
    vh = math.ceil(vis) + 140
    ctx, page = open_app(browser, plat, g["phone_vw"], vh, me, feed, route, ready)
    if prep:
        prep(page)
    scrolled = 0
    for off in range(0, 49):
        if off:
            page.evaluate("(y) => { const s = document.querySelector('.scroll'); if (s) s.scrollTop = y; }", off)
            page.wait_for_timeout(40)
        lines = page.evaluate(SCREEN_LINES)
        if not any(l0 - 4 < vis < l1 + 4 for l0, l1, *_ in lines):
            scrolled = page.evaluate("() => { const s = document.querySelector('.scroll'); return s ? s.scrollTop : 0; }")
            break
    else:
        raise RuntimeError(f"{plat}/{name}: no scroll offset keeps the canvas edge between two lines")
    page.wait_for_timeout(200)
    shown = page.evaluate(VISIBLE_ALERTS, vis)
    text = page.evaluate("(limit) => { const out = []; const walk = document.createTreeWalker(document.querySelector('.app'), NodeFilter.SHOW_TEXT);"
                         " while (walk.nextNode()) { const n = walk.currentNode; if (!n.textContent.trim()) continue; const r = document.createRange();"
                         " r.selectNodeContents(n); const b = r.getBoundingClientRect(); if (b.height && b.top < limit && b.bottom > 0) out.push(n.textContent.trim()); }"
                         " return out; }", vis)
    min_font = page.evaluate(MIN_FONT, vis)
    im = to_png(page, {"x": 0, "y": 0, "width": g["phone_vw"], "height": math.ceil(vis) + 1})
    ctx.close()
    sh = g["H"] - g["hero_top"] - g["bezel"]
    im = im.crop((0, 0, g["phone_vw"] * DSF, round(vis * DSF))).resize((g["screen_w"], sh), Image.LANCZOS)
    p = save(im, f"{plat}-{name}-screen.png")
    return dict(kind="phone", path=p, size=(g["screen_w"], sh), scale=s, vw=g["phone_vw"], vh=vh, visible_css=round(vis, 1), scrolled=scrolled,
                shown=shown, screen_text=text, min_font_px=round(min_font * s, 1))


CARD_GEOM = """(sel) => { const c = document.querySelector(sel); if (!c) return null; const b = c.getBoundingClientRect(); const st = getComputedStyle(c);
  const bw = (k) => parseFloat(st['border' + k + 'Width']) || 0;
  return {x: b.left, y: b.top, w: b.width, h: b.height, radius: parseFloat(st.borderTopLeftRadius) || 0, padBottom: parseFloat(st.paddingBottom) || 0,
    border: {top: bw('Top'), right: bw('Right'), bottom: bw('Bottom'), left: bw('Left'), color: st.borderBottomColor, leftColor: st.borderLeftColor},
    bg: st.backgroundColor}; }"""


def card_hero(browser, plat, name, me, feed, route, ready, card_sel, cut_js, prep=None, pad_css=None):
    """One real card (or one block of a real screen) cut below the element cut_js returns. The bottom edge gets the card's own
    border; nothing inside is changed."""
    g = G[plat]
    ctx, page = open_app(browser, plat, g["card_vw"], 2400, me, feed, route, ready)
    if prep:
        prep(page)
        page.wait_for_timeout(300)
    c = page.evaluate(CARD_GEOM, card_sel)
    assert c, (plat, name, card_sel)
    cut = page.evaluate(cut_js)  # {bottom, next}: bottom of the last element kept, top of the first element left out (CSS px, viewport)
    pad = pad_css if pad_css is not None else c["padBottom"]
    gap = (cut["next"] - cut["bottom"] - 1) if cut.get("next") else pad
    bottom = cut["bottom"] + max(0, min(pad, gap))
    h = min(bottom - c["y"], c["h"] - c["border"]["bottom"])
    lines = page.evaluate(SCREEN_LINES)
    inside = [l for l in lines if l[0] >= c["y"] - 1 and l[1] <= c["y"] + h + 1]
    text = page.evaluate("([sel, limit]) => { const out = []; const walk = document.createTreeWalker(document.querySelector(sel), NodeFilter.SHOW_TEXT);"
                         " while (walk.nextNode()) { const n = walk.currentNode; if (!n.textContent.trim()) continue; const r = document.createRange();"
                         " r.selectNodeContents(n); const b = r.getBoundingClientRect(); if (b.height && b.bottom <= limit + 1) out.push(n.textContent.trim()); }"
                         " return out; }", [card_sel, c["y"] + h])
    min_font = page.evaluate(MIN_FONT, c["y"] + h)
    shown = page.evaluate(VISIBLE_ALERTS, c["y"] + h)
    im = to_png(page, {"x": c["x"], "y": c["y"], "width": c["w"], "height": h})
    ctx.close()
    s = g["box_w"] / c["w"]
    out_h = round(h * s)
    im = im.resize((g["box_w"], out_h), Image.LANCZOS)
    p = save(im, f"{plat}-{name}-card.png")
    return dict(kind="card", path=p, size=(g["box_w"], out_h), scale=s, vw=g["card_vw"], card=c, cut_css=round(h, 1), lines_in=len(inside),
                shown=shown, screen_text=text, min_font_px=round(min_font * s, 1))


def pick_monthly(page):
    page.get_by_role("button", name="Monthly", exact=True).click()
    page.wait_for_timeout(400)


DETAIL_CUT_BUTTON = """() => { const a = document.querySelector('article.card');
  const btn = [...a.querySelectorAll('button, a')].find(x => x.textContent.trim().startsWith('Open the source'));
  const b = btn.getBoundingClientRect(); const fb = a.querySelector('.feedback');
  return {bottom: b.bottom, next: fb ? fb.getBoundingClientRect().top : null, label: btn.textContent.trim()}; }"""

DETAIL_CUT_DL = """() => { const a = document.querySelector('article.card'); const dl = a.querySelector('dl'); const b = dl.getBoundingClientRect();
  let n = dl.nextElementSibling; while (n && !n.getBoundingClientRect().height) n = n.nextElementSibling;
  return {bottom: b.bottom, next: n ? n.getBoundingClientRect().top : null}; }"""

# The settings form: from the "ZIP code you work from" field to the Save button.
FORM_SEL = "form"
FORM_CUT = """() => { const f = document.querySelector('form'); const btn = f.querySelector('button[type=submit]'); const b = btn.getBoundingClientRect();
  return {bottom: b.bottom, next: null}; }"""


def hero_for(browser, plat, shot):
    n = shot["name"]
    if n == "01-records":
        h = phone_hero(browser, plat, n, "paid", "01-records", None, ".alert-card")
        h["records"] = records_for("01-records", h["shown"])
        h["feed"] = "01-records"
    elif n == "02-storms":
        sid = 24614
        h = card_hero(browser, plat, n, "paid", "02-storms", {"name": "alert", "signalId": sid}, "article.card .alert-title", "article.card", DETAIL_CUT_DL)
        h["records"] = records_for("02-storms", h["shown"]); h["feed"] = "02-storms"
        assert [r["signalId"] for r in h["records"]] == [sid], h["records"]
    elif n == "03-radius":
        h = form_hero(browser, plat, n)
        h["records"] = []; h["feed"] = "01-records"
    elif n == "04-source":
        sid = 33435
        h = card_hero(browser, plat, n, "paid", "04-source", {"name": "alert", "signalId": sid}, "article.card .alert-title", "article.card", DETAIL_CUT_BUTTON)
        h["records"] = records_for("04-source", h["shown"]); h["feed"] = "04-source"
        assert [r["signalId"] for r in h["records"]] == [sid], h["records"]
        assert any(t.startswith("Open the source") for t in h["screen_text"]), h["screen_text"]
    elif n == "05-push":
        h = phone_hero(browser, plat, n, "paid", "01-records", {"name": "push-prompt"}, "text=Get a push")
        assert any("At most one an hour" in t for t in h["screen_text"]), h["screen_text"]
        h["records"] = []; h["feed"] = None
    elif n == "06-plans":
        h = phone_hero(browser, plat, n, "trial", "06-plans", {"name": "paywall"}, ".plan", prep=pick_monthly)
        body = " ".join(h["screen_text"])
        assert FACTS["solo_monthly"] in body, body
        h["records"] = []; h["feed"] = "06-plans"
    else:
        raise KeyError(n)
    return h


def form_hero(browser, plat, name):
    """The member's own settings form ("Your alerts"), from the ZIP field to Save: the two numbers the match uses (ZIP, miles)."""
    g = G[plat]
    ctx, page = open_app(browser, plat, g["card_vw"], 2400, "paid", "01-records", {"name": "profile"}, "#radius")
    r = page.evaluate("""() => { const z = document.querySelector('label[for=zip]').closest('.field') || document.querySelector('label[for=zip]').parentElement;
      const zb = z.getBoundingClientRect(); const btn = document.querySelector('form button[type=submit]'); const bb = btn.getBoundingClientRect();
      const app = document.querySelector('.scroll').getBoundingClientRect();
      return {x: app.left, w: app.width, top: zb.top - 16, bottom: bb.bottom + 16, zip: document.getElementById('zip').value,
        radius: document.getElementById('radius').value, label: document.querySelector('label[for=radius]').textContent}; }""")
    prof = DATA["profiles"]["01-records"]
    assert r["zip"] == prof["zip"] and int(r["radius"]) == prof["radiusMi"], (r, prof)
    h = r["bottom"] - r["top"]
    text = page.evaluate("([t, b]) => { const out = []; const walk = document.createTreeWalker(document.querySelector('form'), NodeFilter.SHOW_TEXT);"
                         " while (walk.nextNode()) { const n = walk.currentNode; if (!n.textContent.trim()) continue; const r = document.createRange();"
                         " r.selectNodeContents(n); const q = r.getBoundingClientRect(); if (q.height && q.top >= t && q.bottom <= b) out.push(n.textContent.trim()); }"
                         " return out; }", [r["top"], r["bottom"]])
    min_font = page.evaluate("""([t, b]) => { let m = 99; for (const e of document.querySelectorAll('form *')) { const q = e.getBoundingClientRect();
      if (!q.height || q.top < t || q.bottom > b || ![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      m = Math.min(m, parseFloat(getComputedStyle(e).fontSize)); } return m; }""", [r["top"], r["bottom"]])
    bg = page.evaluate("() => getComputedStyle(document.querySelector('.scroll')).backgroundColor || getComputedStyle(document.body).backgroundColor")
    body_bg = page.evaluate("() => getComputedStyle(document.body).backgroundColor")
    radius = page.evaluate("() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--radius')) || 16")
    im = to_png(page, {"x": r["x"], "y": r["top"], "width": r["w"], "height": h})
    ctx.close()
    s = g["box_w"] / r["w"]
    out_h = round(h * s)
    im = im.resize((g["box_w"], out_h), Image.LANCZOS)
    p = save(im, f"{plat}-{name}-form.png")
    card = dict(radius=radius, border=dict(top=0, right=0, bottom=0, left=0, color="transparent", leftColor="transparent"), bg=bg if bg != "rgba(0, 0, 0, 0)" else body_bg)
    return dict(kind="card", path=p, size=(g["box_w"], out_h), scale=s, vw=g["card_vw"], card=card, form=r, shown=[], screen_text=text,
                min_font_px=round(min_font * s, 1), block="settings form, ZIP field to Save")


# ---------------------------------------------------------------- composition -------------------------------------------------------

def font_faces():
    return (f"@font-face{{font-family:'Barlow Condensed';src:url('file://{FONTS['barlow']}') format('woff2');font-weight:700;}}"
            f"@font-face{{font-family:'Inter';src:url('file://{FONTS['inter']}') format('woff2');font-weight:100 900;}}"
            f"@font-face{{font-family:'JetBrains Mono';src:url('file://{FONTS['mono']}') format('woff2');font-weight:100 800;}}")


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def text_of(plat, shot):
    t = dict(eyebrow=shot["eyebrow"], head=shot["head"], sub=shot["sub"])
    if plat == "android" and "android" in shot:
        t.update(shot["android"])
    return t


def compose(browser, plat, shot, hero):
    g = G[plat]
    t = text_of(plat, shot)
    bg = shot["bg"]; col = {k: TOK[v] for k, v in TEXT[bg].items()}
    head_top = g["eyebrow_top"] + round(g["eyebrow_px"] * 1.2) + g["head_gap"]
    line_h = g["head_px"] * g["head_lh"]
    sub_top = round(head_top + 2 * line_h + g["sub_gap"])
    if hero["kind"] == "phone":
        hx = g["M"]; hy = g["hero_top"]
        hero_html = (f'<div id="hero" class="frame" style="left:{hx}px;top:{hy}px;width:{g["box_w"]}px;height:{g["H"] - hy + 40}px;'
                     f'border:{g["bezel"]}px solid {TOK["ink"]};border-bottom:0;border-radius:{g["frame_r"]}px {g["frame_r"]}px 0 0;">'
                     f'<img src="file://{hero["path"]}" width="{hero["size"][0]}" height="{hero["size"][1]}"></div>')
    else:
        c = hero["card"]; s = hero["scale"]; b = c["border"]
        r = round(c["radius"] * s)
        hx = g["M"]; hy = g["hero_top"]
        # the card's own borders are in the crop on top, left and right; the frame repeats its bottom border along the cut edge
        bb = max(b["bottom"], 0) * s
        frame = (f'<div class="edge" style="left:0;right:0;bottom:0;height:{r}px;border:{bb:.2f}px solid {c["border"]["color"]};border-top:0;'
                 f'border-left:{b["left"] * s:.2f}px solid {b["leftColor"]};border-right:{b["right"] * s:.2f}px solid {c["border"]["color"]};'
                 f'border-radius:0 0 {r}px {r}px;"></div>') if bb else ""
        hero_html = (f'<div id="hero" class="card" style="left:{hx}px;top:{hy}px;width:{hero["size"][0]}px;height:{hero["size"][1]}px;'
                     f'border-radius:{r}px;background:{c["bg"]};"><img src="file://{hero["path"]}" width="{hero["size"][0]}" height="{hero["size"][1]}">{frame}</div>')
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>{font_faces()}
    html,body{{margin:0;padding:0;}}
    body{{width:{g['W']}px;height:{g['H']}px;overflow:hidden;position:relative;background:{TOK[bg]};-webkit-font-smoothing:antialiased;}}
    .t{{position:absolute;left:{g['M']}px;width:{g['box_w']}px;margin:0;white-space:nowrap;}}
    #eyebrow{{top:{g['eyebrow_top']}px;font-family:'JetBrains Mono';font-weight:500;font-size:{g['eyebrow_px']}px;line-height:1.2;letter-spacing:0.08em;
      text-transform:uppercase;color:{col['eyebrow']};}}
    #head{{top:{head_top}px;font-family:'Barlow Condensed';font-weight:700;font-size:{g['head_px']}px;line-height:{g['head_lh']};text-transform:uppercase;
      letter-spacing:0;color:{col['head']};}}
    #head span{{display:block;}}
    #sub{{top:{sub_top}px;font-family:'Inter';font-weight:500;font-size:{g['sub_px']}px;line-height:1.25;color:{col['sub']};}}
    .frame,.card{{position:absolute;box-sizing:border-box;overflow:hidden;}}
    .edge{{position:absolute;box-sizing:border-box;}}
    img{{display:block;}}
    </style></head><body>
    <p class="t" id="eyebrow">{esc(t['eyebrow'])}</p>
    <h1 class="t" id="head">{''.join(f'<span>{esc(l)}</span>' for l in t['head'])}</h1>
    <p class="t" id="sub">{esc(t['sub'])}</p>
    {hero_html}</body></html>"""
    f = WORK / f"{plat}-{shot['name']}.html"; f.write_text(html)
    ctx = browser.new_context(viewport={"width": g["W"], "height": g["H"]}, device_scale_factor=1)
    page = ctx.new_page(); page.goto(f"file://{f}")
    page.evaluate("() => Promise.all(['700 40px \"Barlow Condensed\"', '500 40px Inter', '500 40px \"JetBrains Mono\"'].map(f => document.fonts.load(f)))")
    page.evaluate("() => document.fonts.ready")
    page.wait_for_function("() => [...document.images].every(i => i.complete && i.naturalWidth > 0)", timeout=15000)
    page.wait_for_timeout(150)
    m = page.evaluate("""() => { const box = (id) => { const e = document.getElementById(id); const r = document.createRange(); r.selectNodeContents(e);
        const rs = [...r.getClientRects()]; return {x0: Math.min(...rs.map(q => q.left)), x1: Math.max(...rs.map(q => q.right)), y0: Math.min(...rs.map(q => q.top)),
          y1: Math.max(...rs.map(q => q.bottom)), lines: new Set(rs.map(q => Math.round(q.top))).size, text: e.innerText.replace(/\\n/g, ' / '),
          px: parseFloat(getComputedStyle(e).fontSize), family: getComputedStyle(e).fontFamily, weight: getComputedStyle(e).fontWeight}; };
      const spans = [...document.querySelectorAll('#head span')].map(s => { const r = document.createRange(); r.selectNodeContents(s); const b = r.getBoundingClientRect(); return {x0: b.left, x1: b.right, w: b.width}; });
      const h = document.getElementById('hero').getBoundingClientRect();
      return {eyebrow: box('eyebrow'), head: box('head'), sub: box('sub'), headSpans: spans, hero: {x0: h.left, y0: h.top, x1: h.right, y1: Math.min(h.bottom, innerHeight)},
        fontsOk: document.fonts.check('700 20px "Barlow Condensed"') && document.fonts.check('500 20px Inter') && document.fonts.check('500 20px "JetBrains Mono"'),
        sw: document.documentElement.scrollWidth}; }""")
    assert m["fontsOk"], m
    assert len(m["headSpans"]) == 2 and all(s["x1"] <= g["W"] - g["M"] + 0.5 for s in m["headSpans"]), ("headline does not fit in two lines", plat, shot["name"], m["headSpans"])
    assert m["sub"]["lines"] == 1 and m["sub"]["x1"] <= g["W"] - g["M"] + 0.5, ("supporting line does not fit on one line", plat, shot["name"], m["sub"])
    assert m["sub"]["y1"] <= g["hero_top"] - 40, ("supporting line runs into the hero", plat, shot["name"], m["sub"])
    raw = WORK / f"{plat}-{shot['name']}-raw.png"
    page.screenshot(path=str(raw), type="png", clip={"x": 0, "y": 0, "width": g["W"], "height": g["H"]})
    ctx.close()
    im = Image.open(raw).convert("RGB")
    assert im.size == (g["W"], g["H"]), im.size
    dest = OUT / plat / f"{shot['name']}.png"; dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "PNG", optimize=True)
    info = dict(text=dict(eyebrow=t["eyebrow"], head=list(t["head"]), sub=t["sub"]), bg=bg, bg_hex=TOK[bg], colors=col, layout=m,
                head_top=head_top, sub_top=sub_top,
                hero={k: (str(v) if isinstance(v, Path) else v) for k, v in hero.items() if k not in ("card",)} | {"box": [m["hero"]["x0"], m["hero"]["y0"], m["hero"]["x1"], m["hero"]["y1"]]})
    METRICS["shots"][f"{plat}/{shot['name']}"] = info
    print(f"{plat}/{shot['name']}: hero {hero['kind']} scale {hero['scale']:.2f} size {hero['size']} min app text {hero['min_font_px']}px "
          f"records {[(r['signalId'], r['distance']) for r in hero.get('records', [])]}")


# ---------------------------------------------------------------- review sheets (Chrome, so the brand fonts are used) ---------------

def sheet(browser, path, html, w, h):
    f = WORK / (Path(path).stem + ".html"); f.write_text(html)
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
    page = ctx.new_page(); page.goto(f"file://{f}")
    page.evaluate("() => document.fonts.ready")
    page.wait_for_function("() => [...document.images].every(i => i.complete && i.naturalWidth > 0)", timeout=15000)
    page.wait_for_timeout(200)
    page.screenshot(path=str(path), type="png", full_page=True)
    ctx.close()
    Image.open(path).convert("RGB").save(path, "PNG", optimize=True)


def contact_sheet(browser):
    """Both platforms, numbered, iOS on the first row and Android on the second, each image at the same height."""
    hgt = 900
    rows = ""
    for plat in ("ios", "android"):
        g = G[plat]; w = round(hgt * g["W"] / g["H"])
        cells = "".join(f'<figure><figcaption>{i + 1}</figcaption><img src="file://{OUT / plat / (s["name"] + ".png")}" width="{w}" height="{hgt}"></figure>'
                        for i, s in enumerate(SHOTS))
        rows += f'<h2>{"iOS 1320 x 2868" if plat == "ios" else "Android 1080 x 1920"}</h2><div class="row">{cells}</div>'
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>{font_faces()}
      body{{margin:0;padding:48px;background:#FFFFFF;font-family:Inter;color:{TOK['ink']};width:max-content;}}
      h2{{font-family:'JetBrains Mono';font-weight:500;font-size:22px;letter-spacing:.06em;text-transform:uppercase;margin:0 0 16px;color:{TOK['muted']};}}
      .row{{display:flex;gap:28px;margin-bottom:48px;}} figure{{margin:0;}} figcaption{{font-family:'JetBrains Mono';font-weight:500;font-size:28px;margin-bottom:10px;}}
      img{{display:block;outline:1px solid {TOK['line']};}}</style></head><body>{rows}</body></html>"""
    sheet(browser, OUT / "contact-sheet.png", html, 3400, 2200)


def thumb_strip(browser):
    """The search-result test: iOS 1 to 3 at 115 px wide (the App Store search result at 1x) and at 230 px (2x), Lanczos, on white."""
    rows = []
    for w in (115, 230):
        cells = []
        for s in SHOTS[:3]:
            im = Image.open(OUT / "ios" / f"{s['name']}.png").convert("RGB")
            th = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
            p = WORK / f"thumb-{w}-{s['name']}.png"; th.save(p)
            cells.append(f'<img src="file://{p}" width="{th.width}" height="{th.height}">')
        rows.append(f'<div class="row">{"".join(cells)}</div>')
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>body{{margin:0;padding:20px;background:#FFFFFF;width:max-content;}}
      .row{{display:flex;gap:12px;margin-bottom:24px;}} img{{display:block;image-rendering:auto;}}</style></head><body>{''.join(rows)}</body></html>"""
    sheet(browser, OUT / "thumb-strip.png", html, 800, 600)


def main():
    only = sys.argv[1:]
    WORK.mkdir(parents=True, exist_ok=True)
    srv = subprocess.Popen(["node", str(HERE / "mock-api.mjs"), str(PORT), str(DIST)], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    try:
        for _ in range(80):
            try:
                urllib.request.urlopen(f"{BASE}/api/m/config").read(); break
            except Exception:
                time.sleep(0.1)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
                                         args=["--no-sandbox", "--hide-scrollbars", "--allow-file-access-from-files", "--font-render-hinting=none"])
            for plat in ("ios", "android"):
                for s in SHOTS:
                    if only and s["name"] not in only:
                        continue
                    compose(browser, plat, s, hero_for(browser, plat, s))
            if not only:
                # files from earlier sets that this script no longer makes
                for plat in ("ios", "android"):
                    for p in (OUT / plat).glob("*.png"):
                        if p.stem not in NAMES:
                            p.unlink(); print("removed old file", p.relative_to(HERE))
                contact_sheet(browser); thumb_strip(browser)
            browser.close()
        prev = json.loads((GEN / "metrics.json").read_text()) if only and (GEN / "metrics.json").exists() else {"shots": {}}
        prev.update({k: v for k, v in METRICS.items() if k != "shots"})
        prev.setdefault("shots", {}).update(METRICS["shots"])
        (GEN / "metrics.json").write_text(json.dumps(prev, indent=1, default=str))
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
