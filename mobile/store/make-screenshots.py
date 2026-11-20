#!/usr/bin/env python3
"""Builds the store screenshot set (round 11: /home/claude/gates/r11/brief-directions.md, the owner's pick of the three directions;
contract /home/claude/gates/r10/CONTEXT.md). Run from mobile/:  sh store/build-captures.sh, which does

  1. node store/build-data.mjs        real holler_signals rows -> .gen/data.json (one member profile per scenario, server matchOne)
  2. node store/map-data.mjs          the web site's radius map functions on the same rows -> .gen/map.json (shot 1)
  3. capture builds of the real app   SHOT_PLATFORM=ios|android npx vite build -c store/vite.capture.config.mjs
  4. python3 store/make-screenshots.py, then python3 store/check-screenshots.py

What is real and what is drawn:
  * Every phone screen and every lifted card is the REAL built app (mobile/src, untouched) rendered by /usr/bin/google-chrome at
    deviceScaleFactor 4 against store/mock-api.mjs, which serves real rows from fixtures/real-signals.json to one member profile per
    scenario. A screen may be scrolled by its own scroller (a member who scrolled), chosen so that no line, paragraph or control is cut
    at the top bar, at the tab bar or at the canvas edge. A lifted card is the very element on that screen, cut out at its own box
    (or, for the "Data from" line, the real screen around it), drawn larger with one soft shadow.
  * The map on shot 1 is the web site's radius map: records picked and labelled by lib/seo/home-map.ts and home-label.ts from the
    fixture rows, distances by lib/geo. Each dot sits at its record's true compass bearing and distance from the ZIP.
  * The big figure on shot 4 is copied at run time from the text of the card beside it.
  * This script draws only: flat backgrounds (brand tokens), eyebrow, headline, supporting line, flat ink phone frames with even bezels,
    one soft shadow under a lifted card or a front phone, the map and the figure. No status bar, no OS screens, no badges or arrows.
  * Prices and the trial length are read at run time from the web lib files (lib/stripe/plans.ts, lib/auth/membership.ts through
    lib/plan/public-prices.ts into .gen/data.json); the script stops if the two disagree. No price, trial length or plan limit is typed here.
Fonts: Barlow Condensed 700, Inter (variable), JetBrains Mono (variable) from the web project's node_modules.
Writes store/screenshots/{ios,android}/NN-name.png, contact-sheet.png, thumb-strip.png and store/.gen/metrics.json (read by the checker).
"""
import json, math, os, re, shutil, subprocess, sys, time, urllib.request
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
MOBILE = HERE.parent
REPO = MOBILE.parent
OUT = Path(os.environ.get("SHOTS_OUT", HERE / "screenshots"))
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

# Brand tokens (app/globals.css; r9 CONTEXT "Design tokens"). Only these colours are drawn by the script.
TOK = dict(green="#1E3A2C", deep="#14291E", raised="#24443A", ring="#7A9A85", paper="#F5F4EF", surface="#FFFFFF", ink="#14201A",
           muted="#5B635D", brand_text="#2E5A41", on_brand="#F5F4EF", on_brand_muted="#C9D6CD", on_brand_faint="#A9BDB0", signal="#D9F046",
           line="#DEDCD2", sky="#DDE8EC", sky_deep="#C9DCE5", storm="#4C7FA6", storm_ink="#1F4A63", sage="#E3EFE6", sage_deep="#CFE3D5",
           sage_mark="#3F8A5C", sage_ink="#24513A", civic="#EFEAF7", civic_mark="#8A68BF", civic_ink="#5B3F86",
           permit_on_brand="#6FB38A", civic_on_brand="#C9A8F0", weather_on_brand="#8FBBD9")
# Backgrounds a shot may use (field green, paper and the family tints), and the text colours on each: eyebrow, headline, supporting.
BACKGROUNDS = ("green", "paper", "sky", "sky_deep", "sage", "sage_deep", "civic")
TEXT = {"green": dict(eyebrow="signal", head="on_brand", sub="on_brand_muted"),
        "paper": dict(eyebrow="brand_text", head="ink", sub="muted"),
        "sky": dict(eyebrow="storm_ink", head="ink", sub="storm_ink"),
        "sky_deep": dict(eyebrow="storm_ink", head="ink", sub="storm_ink"),
        "sage": dict(eyebrow="sage_ink", head="ink", sub="sage_ink"),
        "sage_deep": dict(eyebrow="sage_ink", head="ink", sub="sage_ink"),
        "civic": dict(eyebrow="civic_ink", head="ink", sub="civic_ink")}
SHADOW = "0 30px 70px rgba(20,32,26,0.30), 0 6px 16px rgba(20,32,26,0.16)"   # the one shadow, the same everywhere it is used

DATA = json.loads((GEN / "data.json").read_text())
MAP = json.loads((GEN / "map.json").read_text()) if (GEN / "map.json").exists() else None


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
MAP_ZIP = MAP["maps"] and next(iter(MAP["maps"])) if MAP else None

# ---------------------------------------------------------------- the set ------------------------------------------------------------
# name, eyebrow, headline (exactly two lines), supporting line, background, composition. "android" overrides text for the Android file.
# The composition changes from shot to shot; the type and margins (G) never do. No two neighbours share background and composition.
SHOTS = [
    dict(name="01-map", eyebrow=f"{MAP_ZIP} · Chicago" if MAP_ZIP else "", head=("Public records", "around your ZIP"),
         sub="Permits and 311 calls, drawn to scale", bg="green", comp="map and phone"),
    dict(name="02-storms", eyebrow="Weather", head=("Storm and hail", "reports nearby"), sub="Hail size, place and miles from you",
         bg="sky_deep", comp="phone, card lifted"),
    dict(name="03-civic", eyebrow="311 and code", head=("City requests", "and code cases"), sub="From the city's open data, with distance",
         bg="civic", comp="two phones"),
    dict(name="04-value", eyebrow="Permits", head=("The job value", "on the permit"), sub="Read from the city's own permit data",
         bg="sage_deep", comp="card and figure"),
    dict(name="05-source", eyebrow="Public data", head=("Each alert links", "to its source"), sub="Open the public data it came from",
         bg="green", comp="phone, card lifted"),
    dict(name="06-trades", eyebrow="Your work", head=("Pick the trades", "you work in"), sub="Then your ZIP and how far you drive",
         bg="paper", comp="phone, part of it lifted"),
    dict(name="07-alerts", eyebrow="Alerts", head=("At most one", "push an hour"), sub="Email digest too, switch either off",
         bg="sky_deep", comp="one large phone"),
    dict(name="08-plans", eyebrow="Plans", head=(f"{FACTS['trial_days']} days free,", "no card needed"),
         sub=f"Then {FACTS['solo_name']}, {FACTS['solo_monthly']} a month in the app", bg="green", comp="phone, card lifted",
         # Google Play: no price and no "free" in the image text; the plans themselves are the app's own screen
         android=dict(head=("Solo or Pro,", "month or year"), sub="Pro adds areas, trades and keyword watches")),
]
NAMES = [s["name"] for s in SHOTS]

# One type and margin system. The checker reads these back from metrics.json and measures the PNGs.
G = {
    "ios": dict(W=1320, H=2868, M=110, edge=64, eyebrow_top=176, eyebrow_px=34, head_gap=30, head_px=156, head_lh=0.9, sub_gap=34, sub_px=46,
                min_card_px=34, min_phone_px=20),
    "android": dict(W=1080, H=1920, M=80, edge=52, eyebrow_top=104, eyebrow_px=27, head_gap=22, head_px=128, head_lh=0.9, sub_gap=24, sub_px=36,
                    min_card_px=28, min_phone_px=16),
}
for g in G.values():
    g["head_top"] = g["eyebrow_top"] + round(g["eyebrow_px"] * 1.2) + g["head_gap"]
    g["sub_top"] = round(g["head_top"] + 2 * g["head_px"] * g["head_lh"] + g["sub_gap"])
PLATFORMS = tuple(os.environ.get("SHOTS_PLATFORMS", "ios,android").split(","))
VW, VH = 393, 852          # the phone viewport in CSS px (an iPhone 15/16 Pro; the same on both platforms, as in round 10)

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
SCREEN_LINES = """() => { const out = []; const sc = document.querySelector('.scroll'); let k = 0;
  const walk = document.createTreeWalker(document.querySelector('.app') || document.body, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) { const n = walk.currentNode; if (!n.textContent.trim() || n.parentElement.closest('.ptr:not(.show)')) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    const block = n.parentElement.closest('p, li, h1, h2, h3, dd, dt, label, button, a') || n.parentElement; k++;
    // a heading whose items follow it: a trade group label in a form, a Settings section label
    const head = !!n.parentElement.closest('form p.small.muted, .section-label');
    for (const b of r.getClientRects()) out.push([b.top, b.bottom, n.textContent.trim().slice(0, 50), !!(sc && sc.contains(n)), block.dataset.k || (block.dataset.k = 'b' + k), head]); }
  for (const e of document.querySelectorAll('.app svg, .app .btn, .app .chip, .app input, .app select')) { const b = e.getBoundingClientRect();
    if (b.height) out.push([b.top, b.bottom, '<' + e.tagName + '>', !!(sc && sc.contains(e)), 'e' + (k++), false]); }
  // containers: never cut at the top of the scroller (they may run off the canvas edge, like the last feed card)
  for (const e of document.querySelectorAll('.app .card, .app .plan, .app .segmented, .app .notice, .app .settings-list, .app button:not(.btn):not(.chip)')) { const b = e.getBoundingClientRect();
    if (b.height) out.push([b.top, b.bottom, '<BOX>', !!(sc && sc.contains(e)), 'x' + (k++), false]); }
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

# This phone already agreed to push for this account and holds its token (push/push.ts keeps these per account), so the app opens on
# the feed, not on the push prompt, and Settings shows push on. The native plugin is shims/messaging-mock.ts.
_uid = SESSION["user"]["id"]
PUSH_SEED = (f"localStorage.setItem('holler-push-token:{_uid}', 'capture-fcm-token');"
             f"localStorage.setItem('holler-push-consent:{_uid}', '1');localStorage.setItem('holler-push-prompt-seen:{_uid}', '1');")

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
    ctx.add_init_script(f"localStorage.setItem('holler-auth', {json.dumps(json.dumps(SESSION))});" + PUSH_SEED)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{BASE}/{plat}/index.html")
    page.wait_for_function(NAVIGATE, arg=None)
    page.wait_for_selector(".app")
    if route:
        # the member is loaded and on the feed; then go where the shot needs
        page.wait_for_function("() => document.querySelector('.alert-card') || document.body.innerText.includes('No alerts yet')")
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

def first_row(lines, off, st):
    """The first whole line of text in the scroller, its text nodes joined in DOM order."""
    rows = [(l0 - off, lab) for l0, l1, lab, ins, *_ in lines if ins and not lab.startswith('<') and l0 - off >= st - 0.5]
    if not rows:
        return ""
    top = min(r[0] for r in rows)
    return " ".join(lab for y, lab in rows if y - top < 1).replace(" .", ".")


# ---------------------------------------------------------------- real screens and real cards ---------------------------------------

def bezel(sw):
    return max(16, round(sw * 0.026))


def text_lines_visible(page, limit):
    return page.evaluate("(limit) => { const out = []; const walk = document.createTreeWalker(document.querySelector('.app'), NodeFilter.SHOW_TEXT);"
                         " while (walk.nextNode()) { const n = walk.currentNode; if (!n.textContent.trim() || n.parentElement.closest('.ptr:not(.show)')) continue;"
                         " const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect();"
                         " if (b.height && b.top < limit && b.bottom > 0) out.push(n.textContent.trim()); } return out; }", limit)


def phone_capture(browser, plat, key, sw, y, feed, route=None, ready=".app", me="paid", prep=None, anchor=None, first_text=None,
                  from_end=False, records=True, anchor_span=60, y_slack=48):
    """A phone that runs off the canvas may move by up to y_slack px up or twice that down (4 px steps, nearest first) to find a clean
    cut; the y used is returned."""
    err = None
    for dy in sorted(range(-y_slack, 2 * y_slack + 1, 4), key=lambda d: (abs(d), d)):
        try:
            c = _phone_capture(browser, plat, key, sw, y + dy, feed, route, ready, me, prep, anchor, first_text, from_end, records, anchor_span)
            c["y"] = y + dy
            return c
        except NoCleanCut as e:
            err = e
    raise err


class NoCleanCut(RuntimeError):
    pass


def c_whole(plat, sw, y):
    s = sw / VW
    return (G[plat]["H"] - (y + bezel(sw))) / s >= VH + bezel(sw) / s


def _phone_capture(browser, plat, key, sw, y, feed, route, ready, me, prep, anchor, first_text, from_end, records, anchor_span):
    """One real screen for a phone frame of screen width `sw` whose top is at canvas y. If the whole phone fits on the canvas it is
    drawn whole (tab bar and bottom bezel included) and the cut that matters is the app's own tab bar; otherwise the frame runs off the
    canvas and the canvas edge is the cut. Either way the screen's own scroller is moved by the fewest CSS px that keep every line,
    paragraph and control whole at both ends (the round 10 rules), and that keep `first_text` as the first line when asked."""
    H = G[plat]["H"]
    s = sw / VW
    bez = bezel(sw)
    vis_canvas = (H - (y + bez)) / s
    whole = vis_canvas >= VH + bez / s
    ctx, page = open_app(browser, plat, VW, VH if whole else math.ceil(vis_canvas) + 140, me, feed, route, ready)
    if prep:
        prep(page)
    tab_h = page.evaluate("() => { const t = document.querySelector('.tabbar'); return t ? t.getBoundingClientRect().height : 0; }")
    vh = VH if whole else math.ceil(vis_canvas + tab_h) + 2
    page.set_viewport_size({"width": VW, "height": vh})
    page.wait_for_timeout(300)
    st = page.evaluate("() => { const s = document.querySelector('.scroll'); return s ? s.getBoundingClientRect().top : 0; }")
    sb = page.evaluate("() => { const s = document.querySelector('.scroll'); return s ? s.getBoundingClientRect().bottom : innerHeight; }")
    vis = sb if whole else vis_canvas
    max_off = page.evaluate("() => { const s = document.querySelector('.scroll'); return s ? s.scrollHeight - s.clientHeight : 0; }")
    lines0 = page.evaluate(SCREEN_LINES)

    def ok(off, need):
        hidden, shown = set(), set()
        for l0, l1, label, ins, blk, *_ in lines0:
            if ins:
                l0, l1 = l0 - off, l1 - off
                if l0 < st - 0.5 and l1 > st + 0.5:
                    return False
                (hidden if l1 <= st + 0.5 else shown).add(blk)
            if label != '<BOX>' and (ins or not whole) and l0 - need < vis < l1 + need:
                return False
        if hidden & shown:  # a paragraph is either all under the top bar or all in view, never cut in two
            return False
        if first_text and not first_row(lines0, off, st).startswith(tuple(first_text) if isinstance(first_text, (list, tuple)) else first_text):
            return False
        above, below = set(), set()
        for l0, l1, label, ins, blk, *_ in lines0:
            if label == '<BOX>' or (whole and not ins):
                continue
            if ins:
                l0, l1 = l0 - off, l1 - off
            (above if l1 <= vis else below).add(blk)
        if above & below:  # nor at the bottom cut: the last paragraph in view is whole
            return False
        last = max(((l1 - (off if ins else 0), hd) for l0, l1, label, ins, blk, hd in lines0 if label != '<BOX>' and not label.startswith('<')
                    and (ins or not whole) and l1 - (off if ins else 0) <= vis and l0 - (off if ins else 0) >= st - 0.5), default=(0, False))
        return not last[1]

    if anchor:
        a0 = int(round(page.evaluate(anchor) - st))
        order = [o for o in range(a0 + 6, a0 - anchor_span - 1, -1) if 0 <= o <= max_off]
    else:
        order = list(range(int(max_off), -1, -1)) if from_end else list(range(0, int(max_off) + 1))

    def top_gap(o):
        ys = [l0 - o for l0, l1, lab, ins, *_ in lines0 if ins and l0 - o >= st - 0.5 and l1 - o > st]
        return min(ys) - st if ys else 99
    cands = [(i + (0 if ok(o, 6) else 60) + (0 if top_gap(o) >= 8 else 100) - 3 * min(max(top_gap(o), 0), 8), o) for i, o in enumerate(order) if ok(o, 2)]
    if not cands:
        ctx.close()
        raise NoCleanCut(f"{plat}/{key}: no scroll position keeps every line whole at both ends (y {y}, sw {sw})")
    off = min(cands)[1]
    if off:
        page.evaluate("(y) => { document.querySelector('.scroll').scrollTop = y; }", off)
        page.wait_for_timeout(200)
    scrolled = page.evaluate("() => { const s = document.querySelector('.scroll'); return s ? s.scrollTop : 0; }")
    assert abs(scrolled - off) < 0.5, (scrolled, off)
    after = page.evaluate(SCREEN_LINES)
    sel = [(l0, l1, lab, ins, b, hd) for l0, l1, lab, ins, b, hd in after if lab != '<BOX>' and (ins or not whole)]
    split_at_edge = sorted({b for l0, l1, lab, ins, b, hd in sel if l1 <= vis} & {b for l0, l1, lab, ins, b, hd in sel if l0 >= vis})
    vis_lines = [(l1, lab, hd) for l0, l1, lab, ins, b, hd in sel if not lab.startswith('<') and l1 <= vis and l0 >= (st - 0.5 if ins else -1)]
    last_line = max(vis_lines, default=(0, None, False))
    edge_clear = min((min(abs(vis - l0), abs(vis - l1)) for l0, l1, lab, ins, b, hd in sel if l1 > st), default=99)
    page.wait_for_timeout(150)
    shown_h = VH if whole else vis_canvas
    shown = page.evaluate(VISIBLE_ALERTS, vis)
    text = text_lines_visible(page, shown_h if whole else vis)
    min_font = page.evaluate(MIN_FONT, shown_h)
    form = page.evaluate("""(limit) => { const z = document.getElementById('zip'), r = document.getElementById('radius'); if (!z || !r) return null;
      const vis = (e) => { const b = e.getBoundingClientRect(); return b.top >= 0 && b.bottom <= limit; };
      const picked = [...document.querySelectorAll('.chip[aria-pressed=true]')].filter(vis).map(c => c.textContent.trim());
      const rects = [...document.querySelectorAll('.chip[aria-pressed=true]')].filter(vis).map(c => { const b = c.getBoundingClientRect(); return [b.top, b.bottom, b.left, b.right]; });
      return {zip: z.value, radius: r.value, zipVisible: vis(z), radiusVisible: vis(r), pickedVisible: picked, pickedRects: rects}; }""", vis)
    switches = page.evaluate("(limit) => [...document.querySelectorAll('input[role=switch]')].filter(e => e.getBoundingClientRect().bottom <= limit).map(e => ({label: e.getAttribute('aria-label'), on: e.checked}))", vis)
    chips_css = page.evaluate("() => [...document.querySelectorAll('.scroll .chip')].map(e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; })")
    cards_css = page.evaluate("() => [...document.querySelectorAll('.scroll article.card')].map(e => { const b = e.getBoundingClientRect(); const f = e.querySelector('.feedback'); return [b.top, b.bottom, f ? f.getBoundingClientRect().top : b.bottom]; })")
    bottom_text = page.evaluate("() => { const s = document.querySelector('.scroll'); if (!s) return 0; return Math.max(0, ...[...s.querySelectorAll('p, a, button, dd, h3, li, label')].map(e => e.getBoundingClientRect().bottom)); }")
    im = to_png(page, {"x": 0, "y": 0, "width": VW, "height": math.ceil(shown_h) + (0 if whole else 1)})
    ctx.close()
    im = im.crop((0, 0, VW * DSF, round(shown_h * DSF)))
    p = WORK / f"{plat}-{key}.png"; im.save(p)
    for needle in ("That is everything for now.",):
        assert needle not in text, (plat, key, "the screen shows the feed's end-of-list line")
    recs = records_for(feed, shown) if (records and feed) else []
    return dict(kind="phone", key=key, path=p, sw=sw, s=s, bez=bez, whole=whole, shown_css=round(shown_h, 1), visible_css=round(vis, 1),
                vw=VW, vh=vh, scrolled=scrolled, shown=shown, screen_text=text, min_font_px=round(min_font * s, 1), edge_clear_css=round(edge_clear, 1),
                form=form, switches=switches, split_at_edge=split_at_edge, first_in_scroll=first_row(after, 0, st), top_gap_css=round(top_gap(off), 1),
                last_line=last_line[1], last_line_is_heading=last_line[2], text_bottom_css=round(bottom_text, 1), cards_css=cards_css, chips_css=chips_css, scroll_top_css=st,
                lines_css=sorted({(round(l0, 1), round(l1, 1)) for l0, l1, lab, ins, b, hd in after if ins and not lab.startswith('<')}), feed=feed if records else None,
                route=route, member=me, records=recs)


def element_capture(browser, plat, key, feed, selector, route=None, ready=".app", me="paid", nth=0, has_text=None, pad=0, prep=None,
                    records=True, through=None):
    """One real element as the app renders it on a 393 px wide screen, cut out at its own box (plus `pad` CSS px of the real screen
    around it). Its corner radius is returned so the cut is rounded the same way."""
    ctx, page = open_app(browser, plat, VW, 3200, me, feed, route, ready)   # tall enough that nothing sits under the tab bar
    if prep:
        prep(page)
    loc = page.locator(selector)
    if has_text:
        loc = loc.filter(has_text=has_text)
    loc = loc.nth(nth)
    loc.wait_for()
    # through: a second element; the cut then runs from the first element's top to the second one's bottom (one region of the screen)
    info = loc.evaluate("""(e, through) => { const b0 = e.getBoundingClientRect(); const s = getComputedStyle(e);
      const t = through ? document.querySelector(through) : null; const b1 = t ? t.getBoundingClientRect() : b0;
      const b = {left: Math.min(b0.left, b1.left), top: b0.top, width: Math.max(b0.right, b1.right) - Math.min(b0.left, b1.left), height: b1.bottom - b0.top};
      const nodes = t ? [e, t] : [e];
      let m = 99; for (const root of nodes) { const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walk.nextNode()) { const n = walk.currentNode; if (n.textContent.trim()) m = Math.min(m, parseFloat(getComputedStyle(n.parentElement).fontSize)); } }
      return {x: b.left, y: b.top, w: b.width, h: b.height, radius: parseFloat(s.borderTopRightRadius) || 0, minFont: m,
              title: (e.querySelector('.alert-title') || {}).textContent || null, distance: (e.querySelector('.meta-strong') || {}).textContent || null,
              text: nodes.map(n => n.innerText).join('\\n')}; }""", through)
    clip = {"x": info["x"] - pad, "y": info["y"] - pad, "width": info["w"] + 2 * pad, "height": info["h"] + 2 * pad}
    im = to_png(page, clip)
    ctx.close()
    p = WORK / f"{plat}-{key}.png"; im.save(p)
    recs = []
    if records and feed and info["title"]:
        recs = records_for(feed, [{"title": info["title"], "distance": info["distance"]}])
    return dict(kind="card", key=key, path=p, css=(clip["width"], clip["height"]), radius=info["radius"] if not pad else 12, pad=pad,
                box_css=dict(x=info["x"], y=info["y"], w=info["w"], h=info["h"]), text=info["text"], min_font_css=info["minFont"],
                feed=feed if records else None, route=route, member=me, records=recs, selector=selector)


def pick_monthly(page):
    page.get_by_role("button", name="Monthly", exact=True).click()
    page.wait_for_timeout(400)


# ---------------------------------------------------------------- drawing --------------------------------------------------------------

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


class Canvas:
    """Collects the drawn objects of one shot and their boxes on the canvas (written to metrics.json)."""

    def __init__(self, plat, shot):
        self.plat, self.shot, self.g = plat, shot, G[plat]
        self.html, self.objects = [], []

    def phone(self, c, x, y, z=1, shadow=False):
        sw, s, bez = c["sw"], c["s"], c["bez"]
        r_in = round(36 * s); r_out = r_in + bez
        H = self.g["H"]
        if c["whole"]:
            h = round(VH * s)
            frame = f'height:{h}px;border:{bez}px solid {TOK["ink"]};border-radius:{r_out}px;'
            inner = f'border-radius:{r_in}px;'
        else:
            h = H - (y + bez) + 2
            frame = f'height:{h}px;border:{bez}px solid {TOK["ink"]};border-bottom:0;border-radius:{r_out}px {r_out}px 0 0;'
            inner = f'border-radius:{r_in}px {r_in}px 0 0;'
        img_h = round(c["shown_css"] * s)
        self.html.append(f'<div class="phone" style="left:{x}px;top:{y}px;width:{sw}px;{frame}z-index:{z};{"box-shadow:" + SHADOW + ";" if shadow else ""}">'
                         f'<div style="width:{sw}px;height:{h}px;{inner}overflow:hidden;background:{TOK["paper"]}"><img src="file://{c["path"]}" style="width:{sw}px;height:{img_h}px"></div></div>')
        box = [x, y, x + sw + 2 * bez, y + h + (2 * bez if c["whole"] else bez)]
        self.objects.append(dict(c, path=str(c["path"]), box=box, x=x, y=y))
        return dict(x=x, y=y, sx=x + bez, sy=y + bez, s=s, bez=bez, w=sw + 2 * bez, h=box[3] - y)

    def card(self, c, x, y, w, z=4, shadow=True):
        cw, ch = c["css"]
        s = w / cw
        h = round(ch * s)
        r = round(c["radius"] * s)
        bg = TOK["surface"] if not c["pad"] else TOK["paper"]
        self.html.append(f'<div class="card" style="left:{x}px;top:{y}px;width:{w}px;height:{h}px;border-radius:{r}px;z-index:{z};background:{bg};'
                         f'{"box-shadow:" + SHADOW + ";" if shadow else ""}"><img src="file://{c["path"]}" style="width:{w}px;height:{h}px"></div>')
        self.objects.append(dict(c, path=str(c["path"]), box=[x, y, x + w, y + h], scale=s, min_font_px=round(c["min_font_css"] * s, 1), x=x, y=y))
        return dict(x=x, y=y, w=w, h=h, s=s)

    def size_of(self, c, w):
        cw, ch = c["css"]
        return round(ch * w / cw)

    def figure(self, text, x, y, px, color, source):
        self.html.append(f'<p class="fig" style="left:{x}px;top:{y}px;font-size:{px}px;color:{TOK[color]}">{esc(text)}</p>')
        self.objects.append(dict(kind="figure", text=text, px=px, color=TOK[color], source=source, box=[x, y, None, None]))


def radius_map(cv, cx, cy, ppm, rings, recs, zip_, u, sides=None):
    """The site's radius map on field green, drawn at unit u (site px -> canvas px): dashed rings with mono captions, the ZIP chip in
    lime, square permit dots, round 311 and code dots, labels in deep green chips. Each dot at its record's true bearing and distance."""
    fam_col = {"permit": TOK["permit_on_brand"], "civic": TOK["civic_on_brand"], "weather": TOK["weather_on_brand"]}
    out = []
    for mi in rings:
        d = 2 * mi * ppm
        out.append(f'<div class="ring" style="left:{cx}px;top:{cy}px;width:{d}px;height:{d}px;border:{1.5 * u:.1f}px dashed {TOK["ring"]}"></div>')
        out.append(f'<span class="cap" style="left:{cx}px;top:{cy - mi * ppm}px;font-size:{13 * u:.1f}px;line-height:{20 * u:.1f}px;'
                   f'padding:0 {6 * u:.1f}px;background:{TOK["green"]};color:{TOK["on_brand_faint"]}">{mi} MI</span>')
    placed = []
    for r in recs:
        b = math.radians(r["bearing"])
        x = cx + r["mi"] * ppm * math.sin(b)
        y = cy - r["mi"] * ppm * math.cos(b)
        side = (sides or {}).get(r["id"], "right" if x < cx else "left")
        rad = "50%" if r["family"] == "civic" else f"{5 * u:.1f}px"
        out.append(f'<span class="dot" style="left:{x:.1f}px;top:{y:.1f}px;width:{22 * u:.1f}px;height:{22 * u:.1f}px;border-radius:{rad};'
                   f'background:{fam_col[r["family"]]};border:{2.5 * u:.1f}px solid {TOK["on_brand"]}"></span>')
        lx = x + 16 * u if side == "right" else x - 16 * u
        tr = "translateY(-50%)" if side == "right" else "translate(-100%,-50%)"
        out.append(f'<span class="lab" style="left:{lx:.1f}px;top:{y:.1f}px;transform:{tr};font-size:{13 * u:.1f}px;line-height:{20 * u:.1f}px;'
                   f'padding:{3 * u:.1f}px {7 * u:.1f}px;border-radius:{6 * u:.1f}px;background:{TOK["deep"]};color:{TOK["on_brand"]}">{esc(r["text"])}</span>')
        placed.append(dict(r, x=round(x, 1), y=round(y, 1), side=side))
    out.append(f'<span class="chip" style="left:{cx}px;top:{cy}px;font-size:{13 * u:.1f}px;line-height:{20 * u:.1f}px;padding:{6 * u:.1f}px {10 * u:.1f}px;'
               f'border-radius:{6 * u:.1f}px;background:{TOK["signal"]};color:{TOK["ink"]}">{esc(zip_)}</span>')
    cv.html.append("".join(out))
    R = max(rings) * ppm + 10 * u   # the outer ring with its caption
    cv.objects.append(dict(kind="map", box=[round(max(cx - R, 0)), round(cy - R), round(min(cx + R, cv.g["W"])), round(min(cy + R, cv.g["H"]))], zip=zip_, centre=[cx, cy], px_per_mi=ppm, rings=list(rings), unit=u, label_px=round(13 * u, 1), records=placed))


def map_records():
    m = MAP["maps"][MAP_ZIP]
    return [dict(id=r["id"], family=r["family"], text=r["text"], mi=r["mi"], bearing=r["bearing"], title=r["title"]) for r in m["records"]]


# ---------------------------------------------------------------- the seven compositions ---------------------------------------------
# Numbers per platform. iOS 1320 x 2868, Android 1080 x 1920: the same idea in each, placed for that canvas.

# labels clear of the canvas edge, the chip, the ring captions and each other (checked by eye at full size on both platforms)
MAP_SIDES = {"ios": {"47080": "left", "33439": "left", "46979": "left", "45354": "left"},
             "android": {"47080": "left", "33439": "left", "46979": "left", "45354": "left", "33427": "left"}}


def build_01(b, cv, plat):
    g = cv.g; M = g["M"]
    L = dict(ios=dict(u=2.62, ppm=118, cx=1130, cy=1430, sw=640, px=M - 20, py=2040),
             android=dict(u=2.1, ppm=95, cx=900, cy=1092, sw=490, px=M - 16, py=1440))[plat]
    radius_map(cv, L["cx"], L["cy"], L["ppm"], MAP["rings"], map_records(), MAP_ZIP, L["u"], MAP_SIDES[plat])
    # the member's own feed in that ZIP, beside the map: 311 tree emergency, roof permit, code violation
    c = phone_capture(b, plat, "01-feed", L["sw"], L["py"], "01-records", ready=".alert-card", first_text=("311 request",))
    cv.phone(c, L["px"], c["y"], z=3, shadow=True)


def build_02(b, cv, plat):
    g = cv.g; M = g["M"]; W, H = g["W"], g["H"]
    # iOS: the lifted card sits on the phone's empty paper under the hail report. Android has less height: the card covers the report's
    # feedback row instead (the card spans the whole screen width there, so nothing of that row shows around it).
    L = dict(ios=dict(sw=770, right=60, y=840, cw=960, cx=W - M - 40 - 960, under="card"),
             android=dict(sw=520, right=50, y=560, cw=780, cx=W - M + 30 - 780, under="feedback"))[plat]
    bez = bezel(L["sw"])
    px = W - L["sw"] - 2 * bez - L["right"]
    c = phone_capture(b, plat, "02-hail", L["sw"], L["y"], "02-storms", {"name": "alert", "signalId": 24614}, "article.card .alert-title")
    ph = cv.phone(c, px, L["y"])
    # the other storm record of the same member, from that member's feed
    k = element_capture(b, plat, "02-warning", "02-storms", "article.card", ready=".alert-card", nth=1)
    top_css = c["cards_css"][0][1] + 16 if L["under"] == "card" else c["cards_css"][0][2] - 10
    y = round(ph["sy"] + top_css * ph["s"])
    h = cv.size_of(k, L["cw"])
    assert y + h <= H - 60, (plat, "lifted card runs off the canvas", y, h)
    if L["under"] == "feedback":
        assert L["cx"] <= px and L["cx"] + L["cw"] >= px + 2 * bez + L["sw"], "the card must cover the feedback row across the screen"
    cv.card(k, L["cx"], y, L["cw"])


def build_03(b, cv, plat):
    g = cv.g; M = g["M"]; W = g["W"]
    L = dict(ios=dict(sw=690, dx=40, y=840), android=dict(sw=500, dx=30, y=560))[plat]
    bez = bezel(L["sw"])
    c1 = phone_capture(b, plat, "03-311", L["sw"], L["y"], "01-records", {"name": "alert", "signalId": 45354}, "article.card .alert-title")
    p1 = cv.phone(c1, M - L["dx"], L["y"], z=1)
    # the code case starts below the 311 screen's last line, so it covers only that screen's empty paper; it runs off the canvas
    y2 = round(p1["sy"] + (c1["text_bottom_css"] + 30) * p1["s"]) - bez
    c2 = phone_capture(b, plat, "03-code", L["sw"], y2, "01-records", {"name": "alert", "signalId": 4291}, "article.card .alert-title")
    cv.phone(c2, W - L["sw"] - 2 * bez - M + L["dx"], c2["y"], z=2, shadow=True)


def build_04(b, cv, plat):
    g = cv.g; M = g["M"]; W = g["W"]
    L = dict(ios=dict(cx=M + 100, cy=820, gap=150, fpx=248), android=dict(cx=M + 134, cy=560, gap=64, fpx=180))[plat]
    k = element_capture(b, plat, "04-hvac", "04-source", "article.card", {"name": "alert", "signalId": 33435}, "article.card .alert-title")
    cd = cv.card(k, L["cx"], L["cy"], W - M - L["cx"])
    m = re.search(r"(\$[\d,]+) job value", k["text"])
    assert m, k["text"]
    cv.figure(m.group(1), M - round(L["fpx"] * 0.025), cd["y"] + cd["h"] + L["gap"], L["fpx"], "ink", source=dict(card=k["key"], text=m.group(0)))


def build_05(b, cv, plat):
    g = cv.g; M = g["M"]; W = g["W"]
    L = dict(ios=dict(sw=760, dx=20, y=840, lw=970), android=dict(sw=540, dx=16, y=560, lw=790))[plat]
    c = phone_capture(b, plat, "05-roof", L["sw"], L["y"], "01-records", {"name": "alert", "signalId": 33439}, "article.card .alert-title")
    ph = cv.phone(c, M - L["dx"], L["y"])
    # the "Data from" line of the very screen, with the real screen around it, lifted in place over the phone's right edge
    k = element_capture(b, plat, "05-datafrom", "01-records", "p.small.muted", {"name": "alert", "signalId": 33439}, "article.card .alert-title",
                        has_text="Data from", pad=16, records=False)
    assert "Data from" in k["text"] and "Open the source" in " ".join(c["screen_text"]), (k["text"], c["screen_text"])
    yc = ph["sy"] + (k["box_css"]["y"] + k["box_css"]["h"] / 2 - c["scrolled"]) * ph["s"]
    h = cv.size_of(k, L["lw"])
    # in place: it starts just left of the phone's own line and is larger, so it covers that line and breaks out over the frame
    x = round(ph["sx"] + (k["box_css"]["x"] - k["pad"]) * ph["s"]) - 24
    assert x + L["lw"] > ph["x"] + ph["w"] + 60, "the lifted line must break out of the phone"
    cv.card(k, x, round(yc - h / 2), L["lw"])


def build_06(b, cv, plat):
    g = cv.g; M = g["M"]; W, H = g["W"], g["H"]
    L = dict(ios=dict(sw=700, dx=40, y=840, lw=980, low=160), android=dict(sw=540, dx=30, y=560, lw=800, low=110))[plat]
    # the roofer's own trade picker (round 10 members: iOS roofing + tree service, Android roofing + HVAC), "Home and property" first
    key = "03-radius" if plat == "ios" else "03-radius-android"
    anchor = "() => [...document.querySelectorAll('form p.small.muted')].find(e => e.textContent.trim() === 'Home and property').getBoundingClientRect().top - 8"
    first = ("Home and property", "Pick up to", "Your trades")
    c = phone_capture(b, plat, "06-trades", L["sw"], L["y"], key, {"name": "profile"}, "#trades-label", anchor=anchor, first_text=first, records=False,
                      anchor_span=200)
    c["profile_key"] = key
    ph = cv.phone(c, M - L["dx"], L["y"])
    prof = DATA["profiles"][key]
    labels = {t["id"]: t["label"] for t in DATA["config"]["trades"]}
    assert c["form"]["pickedVisible"] == [labels[x] for x in prof["trades"]], (c["form"], prof)
    # the same screen's ZIP and radius fields (further down the same form), with the real screen around them, lifted over the phone
    k = element_capture(b, plat, "06-zip-radius", key, ".field:has(#zip)", {"name": "profile"}, "#trades-label", pad=16, records=False,
                        through=".field:has(#radius)")
    assert "ZIP code you work from" in k["text"] and "How far you travel" in k["text"], k["text"]
    h = cv.size_of(k, L["lw"])
    x = W - M + 30 - L["lw"]
    # its top edge falls in a gap between chip rows, so no chip shows as a sliver above it
    def clear(yy):
        for c0, t0, c1, b0 in c["chips_css"]:
            cx0, cx1 = ph["sx"] + c0 * ph["s"], ph["sx"] + c1 * ph["s"]
            ct, cb = ph["sy"] + t0 * ph["s"], ph["sy"] + b0 * ph["s"]
            if cx1 > x and ct - 3 < yy < cb + 3:
                return False
        return True
    picked_bottom = max(ph["sy"] + r[1] * ph["s"] for r in c["form"]["pickedRects"])
    # nearest to the planned bottom margin (at least 70 px), below the ticked trades, top edge between chip rows
    lows = sorted(range(70, L["low"] + 200, 2), key=lambda lo: abs(lo - L["low"]))
    y = next(H - lo - h for lo in lows if clear(H - lo - h) and H - lo - h > picked_bottom + 20)
    # the ticked trades stay in view: the lifted part sits below them
    assert y > picked_bottom + 20, (plat, "the lifted fields cover a ticked trade", y, picked_bottom)
    k["form"] = dict(zip=prof["zip"], radius=prof["radiusMi"])
    cv.card(k, x, y, L["lw"])


def build_07(b, cv, plat):
    g = cv.g; M = g["M"]; W = g["W"]
    L = dict(ios=dict(sw=1000, y=820), android=dict(sw=800, y=560))[plat]
    bez = bezel(L["sw"])
    # Settings with push and the email digest on and a plainly sample address, one large phone running off the canvas
    c = phone_capture(b, plat, "07-settings", L["sw"], L["y"], "01-records", {"name": "settings"}, "input[role=switch]", records=False,
                      first_text=("Account",))
    assert any(t.endswith("@example.com") for t in c["screen_text"]), c["screen_text"]
    sw_ = {x["label"]: x["on"] for x in c["switches"]}
    assert sw_ == {"Push notifications": True, "Email digest": True}, c["switches"]
    assert not any(t in ("Sign out", "Delete account") for t in c["screen_text"]), c["screen_text"]
    cv.phone(c, (W - L["sw"] - 2 * bez) // 2, c["y"])


def build_08(b, cv, plat):
    g = cv.g; W = g["W"]
    L = dict(ios=dict(sw=820, y=840, cw=1130), android=dict(sw=580, y=560, cw=880))[plat]
    bez = bezel(L["sw"])
    c = phone_capture(b, plat, "08-plans", L["sw"], L["y"], "06-plans", {"name": "paywall"}, ".plan", me="trial", prep=pick_monthly, records=False)
    ph = cv.phone(c, (W - L["sw"] - 2 * bez) // 2, L["y"])
    k = element_capture(b, plat, "08-solo", "06-plans", ".plan", {"name": "paywall"}, ".plan", me="trial", prep=pick_monthly, records=False)
    assert k["text"].strip().startswith(FACTS["solo_name"]) and FACTS["solo_monthly"] in k["text"].replace(" A MONTH", ""), k["text"]
    # in place over the phone's Solo card, its top just under the app's top bar so nothing of the screen shows between the two, and
    # its width (so its height) chosen near the plan so its bottom edge falls between two lines of the screen, never through one
    y = round(ph["sy"] + c["scroll_top_css"] * ph["s"]) + 6
    lines = [(ph["sy"] + t * ph["s"], ph["sy"] + b_ * ph["s"]) for t, b_ in c["lines_css"]]
    ok_w = [w for w in sorted(range(L["cw"] - 120, L["cw"] + 61, 2), key=lambda w: abs(w - L["cw"]))
            if not any(t - 3 < y + cv.size_of(k, w) < b_ + 3 for t, b_ in lines)]
    assert ok_w, (plat, y, [(round(t), round(b_)) for t, b_ in lines], [y + cv.size_of(k, w) for w in (L["cw"] - 120, L["cw"] + 60)])
    cw = ok_w[0]
    h = cv.size_of(k, cw)
    assert y + h >= ph["sy"] + (k["box_css"]["y"] + k["box_css"]["h"] - c["scrolled"]) * ph["s"], "the lifted card must cover the phone's own"
    cv.card(k, (W - cw) // 2, y, cw)


BUILD = {"01-map": build_01, "02-storms": build_02, "03-civic": build_03, "04-value": build_04, "05-source": build_05,
         "06-trades": build_06, "07-alerts": build_07, "08-plans": build_08}


# ---------------------------------------------------------------- composition -------------------------------------------------------

def css(g):
    return f"""{font_faces()}
    html,body{{margin:0;padding:0}} body{{position:relative;overflow:hidden;-webkit-font-smoothing:antialiased;width:{g['W']}px;height:{g['H']}px}}
    .t{{position:absolute;left:{g['M']}px;width:{g['W'] - 2 * g['M']}px;margin:0;white-space:nowrap}}
    #eyebrow{{top:{g['eyebrow_top']}px;font-family:'JetBrains Mono';font-weight:500;font-size:{g['eyebrow_px']}px;line-height:1.2;letter-spacing:0.08em;text-transform:uppercase}}
    #head{{top:{g['head_top']}px;font-family:'Barlow Condensed';font-weight:700;font-size:{g['head_px']}px;line-height:{g['head_lh']};text-transform:uppercase;letter-spacing:0}}
    #head span{{display:block}}
    #sub{{top:{g['sub_top']}px;font-family:'Inter';font-weight:500;font-size:{g['sub_px']}px;line-height:1.25}}
    .phone,.card{{position:absolute;box-sizing:content-box;overflow:hidden}} img{{display:block}}
    .fig{{position:absolute;margin:0;font-family:'JetBrains Mono';font-weight:500;white-space:nowrap;letter-spacing:-0.04em;line-height:1}}
    .ring{{position:absolute;border-radius:50%;box-sizing:border-box;transform:translate(-50%,-50%)}}
    .dot{{position:absolute;box-sizing:border-box;transform:translate(-50%,-50%)}}
    .lab{{position:absolute;white-space:nowrap;font-family:'JetBrains Mono';font-weight:500;letter-spacing:0}}
    .cap,.chip{{position:absolute;white-space:nowrap;font-family:'JetBrains Mono';font-weight:500;transform:translate(-50%,-50%)}}
    """


def compose(browser, plat, shot):
    g = G[plat]
    t = text_of(plat, shot)
    bg = shot["bg"]; assert bg in BACKGROUNDS, bg
    col = {k: TOK[v] for k, v in TEXT[bg].items()}
    cv = Canvas(plat, shot)
    BUILD[shot["name"]](browser, cv, plat)
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>{css(g)} body{{background:{TOK[bg]}}}
    #eyebrow{{color:{col['eyebrow']}}} #head{{color:{col['head']}}} #sub{{color:{col['sub']}}}</style></head><body>
    <p class="t" id="eyebrow">{esc(t['eyebrow'])}</p>
    <h1 class="t" id="head">{''.join(f'<span>{esc(l)}</span>' for l in t['head'])}</h1>
    <p class="t" id="sub">{esc(t['sub'])}</p>
    {''.join(cv.html)}</body></html>"""
    f = WORK / f"{plat}-{shot['name']}.html"; f.write_text(html)
    ctx = browser.new_context(viewport={"width": g["W"], "height": g["H"]}, device_scale_factor=1)
    page = ctx.new_page(); page.goto(f"file://{f}")
    page.evaluate("() => Promise.all(['700 40px \"Barlow Condensed\"', '500 40px Inter', '500 40px \"JetBrains Mono\"'].map(f => document.fonts.load(f)))")
    page.evaluate("() => document.fonts.ready")
    page.wait_for_function("() => [...document.images].every(i => i.complete && i.naturalWidth > 0)", timeout=20000)
    page.wait_for_timeout(150)
    m = page.evaluate("""() => { const box = (id) => { const e = document.getElementById(id); const r = document.createRange(); r.selectNodeContents(e);
        const rs = [...r.getClientRects()]; return {x0: Math.min(...rs.map(q => q.left)), x1: Math.max(...rs.map(q => q.right)), y0: Math.min(...rs.map(q => q.top)),
          y1: Math.max(...rs.map(q => q.bottom)), lines: new Set(rs.map(q => Math.round(q.top))).size, text: e.innerText.replace(/\\n/g, ' / '),
          px: parseFloat(getComputedStyle(e).fontSize), family: getComputedStyle(e).fontFamily, weight: getComputedStyle(e).fontWeight}; };
      const spans = [...document.querySelectorAll('#head span')].map(s => { const r = document.createRange(); r.selectNodeContents(s); const b = r.getBoundingClientRect(); return {x0: b.left, x1: b.right, w: b.width}; });
      // every drawn text a viewer can see (map text under a phone or a card is not seen)
      const drawn = [...document.querySelectorAll('.t, .fig, .lab, .chip, .cap')].filter(e => { const b = e.getBoundingClientRect();
          const h = document.elementFromPoint(Math.min(Math.max(b.left + b.width / 2, 0), innerWidth - 1), Math.min(Math.max(b.top + b.height / 2, 0), innerHeight - 1));
          return h && (h === e || e.contains(h)); }).map(e => { const r = document.createRange(); r.selectNodeContents(e); const rs = [...r.getClientRects()];
          return {cls: e.className || e.id, text: e.innerText, x0: Math.min(...rs.map(q => q.left)), x1: Math.max(...rs.map(q => q.right)),
                  y0: Math.min(...rs.map(q => q.top)), y1: Math.max(...rs.map(q => q.bottom))}; });
      const figs = [...document.querySelectorAll('.fig')].map(e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; });
      return {eyebrow: box('eyebrow'), head: box('head'), sub: box('sub'), headSpans: spans, drawn, figs,
        fontsOk: document.fonts.check('700 20px "Barlow Condensed"') && document.fonts.check('500 20px Inter') && document.fonts.check('500 20px "JetBrains Mono"')}; }""")
    assert m["fontsOk"], m
    W, H, M = g["W"], g["H"], g["M"]
    assert len(m["headSpans"]) == 2 and all(s["x1"] <= W - M + 0.5 for s in m["headSpans"]), ("headline does not fit in two lines", plat, shot["name"], m["headSpans"])
    assert m["sub"]["lines"] == 1 and m["sub"]["x1"] <= W - M + 0.5, ("supporting line does not fit on one line", plat, shot["name"], m["sub"])
    for d in m["drawn"]:
        assert d["x0"] >= g["edge"] - 0.5 and d["x1"] <= W - g["edge"] + 0.5 and d["y0"] >= g["edge"] - 0.5 and d["y1"] <= H - g["edge"] + 0.5, ("drawn text at the edge", plat, shot["name"], d)
    for o, fb in zip([o for o in cv.objects if o["kind"] == "figure"], m["figs"]):
        o["box"] = [round(v) for v in fb]
    hero_top = min(o["box"][1] for o in cv.objects)
    assert hero_top >= m["sub"]["y1"] + 40, ("the hero runs into the supporting line", plat, shot["name"], hero_top, m["sub"])
    raw = WORK / f"{plat}-{shot['name']}-raw.png"
    page.screenshot(path=str(raw), type="png", clip={"x": 0, "y": 0, "width": W, "height": H})
    ctx.close()
    im = Image.open(raw).convert("RGB")
    assert im.size == (W, H), im.size
    dest = OUT / plat / f"{shot['name']}.png"; dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "PNG", optimize=True)
    info = dict(text=dict(eyebrow=t["eyebrow"], head=list(t["head"]), sub=t["sub"]), bg=bg, bg_hex=TOK[bg], colors=col, comp=shot["comp"], layout=m,
                hero_top=hero_top, objects=[{k: (str(v) if isinstance(v, Path) else v) for k, v in o.items()} for o in cv.objects])
    METRICS["shots"][f"{plat}/{shot['name']}"] = info
    print(f"{plat}/{shot['name']}: {shot['comp']} on {bg}; " + "; ".join(
        f"{o['kind']} {o.get('key', '')} {[(r.get('signalId', r.get('id')), r.get('distance', r.get('text'))) for r in o.get('records', [])]}" for o in cv.objects))


# ---------------------------------------------------------------- review sheets (Chrome, so the brand fonts are used) ---------------

def sheet(browser, path, html, w, h):
    f = WORK / (Path(path).stem + ".html"); f.write_text(html)
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
    page = ctx.new_page(); page.goto(f"file://{f}")
    page.evaluate("() => document.fonts.ready")
    page.wait_for_function("() => [...document.images].every(i => i.complete && i.naturalWidth > 0)", timeout=20000)
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
    sheet(browser, OUT / "contact-sheet.png", html, 3600, 2200)


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
    assert MAP, "run node store/map-data.mjs first"
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
            for plat in PLATFORMS:
                for s in SHOTS:
                    if only and s["name"] not in only:
                        continue
                    compose(browser, plat, s)
            if not only:
                # files from earlier sets that this script no longer makes
                for plat in ("ios", "android"):
                    for p in (OUT / plat).glob("*.png"):
                        if p.stem not in NAMES:
                            p.unlink(); print("removed old file", p.name)
                contact_sheet(browser); thumb_strip(browser)
            browser.close()
        prev = json.loads((GEN / "metrics.json").read_text()) if only and (GEN / "metrics.json").exists() else {"shots": {}}
        prev.update({k: v for k, v in METRICS.items() if k != "shots"})
        prev["shots"] = {k: v for k, v in prev.get("shots", {}).items() if k.split("/", 1)[1] in NAMES}
        prev["shots"].update(METRICS["shots"])
        (GEN / "metrics.json").write_text(json.dumps(prev, indent=1, default=str))
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
