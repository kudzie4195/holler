#!/usr/bin/env python3
"""Regenerates the 16 store screenshots + contact sheet.

  1. node store/build-data.mjs                       (real rows -> .gen/data.json)
  2. SHOT_PLATFORM=ios|android ... npx vite build -c store/vite.capture.config.mjs   (see build-captures.sh)
  3. python3 store/make-screenshots.py               (starts store/mock-api.mjs, drives Chrome, composes, writes PNGs)

The app screen in every image is the real built app rendered by Chrome at deviceScaleFactor 3, against mock-api.mjs which serves real
holler_signals rows. Python Playwright + /usr/bin/google-chrome + Pillow are required.
"""
import base64, json, os, subprocess, sys, time, urllib.request
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
OUT = HERE / "screenshots"
TMP = Path("/tmp/holler-shots-work"); TMP.mkdir(exist_ok=True)
PORT = 8799
BASE = f"http://127.0.0.1:{PORT}"
BG, INK, MUTED, LINE = "#FAF8F5", "#191714", "#5C574F", "#DDD3C0"
FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, Roboto, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"  # the app's own stack

SHOTS = [
    ("01-know-when", "Know when your town needs you", "Permits, storms and 311 requests matched to your trade"),
    ("02-storm-hail", "Storm &amp; hail alerts", "Hail and storm reports from NWS and SPC, nationwide"),
    ("03-permits", "New permits near you", "Building permits from cities that publish them"),
    ("04-311", "311 &amp; city requests", "Open 311 and code records from your city or county"),
    ("05-source-link", "Every alert links to its source", "Read the official record before you act"),
    ("06-trade-radius", "Pick your trade &amp; radius", "Set your ZIP code, trades and how far you will drive"),
    ("07-push", "Push alerts, not spam", "Only records that match your trade and area"),
    ("08-price", "$7.99/mo, 14-day free trial", "No card to start. Solo covers 1 area and 5 trades"),
]

# Per target: final image size, app viewport (CSS px, deviceScaleFactor 3), card geometry on the final image.
TARGETS = {
    "ios": dict(W=1320, H=2868, vw=390, vh=756, card_x=75, card_w=1170, card_top=600, head_top=150, head_px=104, sub_px=46, gap=34, pad=75),
    "android": dict(W=1080, H=1920, vw=360, vh=546, card_x=60, card_w=960, card_top=464, head_top=96, head_px=80, sub_px=37, gap=24, pad=60),
}

FIND_NAV = """() => {
  const root = document.getElementById('root');
  const key = Object.keys(root).find(k => k.startsWith('__reactContainer$'));
  const stack = [root[key]];
  while (stack.length) {
    const f = stack.pop();
    if (!f) continue;
    const v = f.memoizedProps && f.memoizedProps.value;
    if (v && typeof v.navigate === 'function' && 'phase' in v) return true;
    if (f.sibling) stack.push(f.sibling);
    if (f.child) stack.push(f.child);
  }
  return false;
}"""
NAVIGATE = """(route) => {
  const root = document.getElementById('root');
  const key = Object.keys(root).find(k => k.startsWith('__reactContainer$'));
  const stack = [root[key]];
  while (stack.length) {
    const f = stack.pop();
    if (!f) continue;
    const v = f.memoizedProps && f.memoizedProps.value;
    if (v && typeof v.navigate === 'function' && 'phase' in v) { v.navigate(route); return true; }
    if (f.sibling) stack.push(f.sibling);
    if (f.child) stack.push(f.child);
  }
  return false;
}"""


BANNER = """() => {
  const mark = document.querySelector('.app svg') ? '' : '';
  const d = document.createElement('div');
  d.setAttribute('data-capture-banner', '1');
  d.style.cssText = 'position:fixed;left:10px;right:10px;top:6px;z-index:9999;background:#fff;border:1px solid #e5dccb;border-radius:18px;padding:8px 12px;display:flex;gap:12px;align-items:center;font-family:inherit;color:#191714';
  d.innerHTML = '<svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" style="flex:none"><rect width="32" height="32" rx="9" fill="#E8590C"/><circle cx="16" cy="16" r="3.2" fill="#fff"/><path d="M21.36 11.5A7 7 0 0 1 21.36 20.5M10.64 11.5A7 7 0 0 0 10.64 20.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none"/><path d="M24.81 8.61A11.5 11.5 0 0 1 24.81 23.39M7.19 8.61A11.5 11.5 0 0 0 7.19 23.39" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity="0.7" fill="none"/></svg>'
    + '<div style="min-width:0"><div style="font-size:15px;font-weight:650;line-height:1.35">New alert near Chicago</div><div style="font-size:15px;line-height:1.35">Window and door permit in Chicago</div></div>';
  document.body.appendChild(d);
}"""


def geom(plat, name):
    """Per-shot capture viewport and card geometry. The app is always captured at deviceScaleFactor 3 and scaled to the card width."""
    t = TARGETS[plat]
    g = dict(card_x=t["card_x"], card_w=t["card_w"], card_top=t["card_top"], vw=t["vw"], fit=False)
    if name == "01-know-when":      # wider layout viewport so three cards (311, permit, NWS) are visible at once
        g["vw"] = 444 if plat == "ios" else 580
    if name == "06-trade-radius":   # 680 css px layout (content column is the app max 640): Roofing chips through the radius slider fit in one view
        g["vw"] = 680
        if plat == "android":
            g.update(card_x=140, card_w=800, card_top=372)
    if name == "05-source-link":
        g["fit"] = True
        if plat == "android":
            g["vw"] = 480
    g["vh"] = round((t["H"] - g["card_top"]) * g["vw"] / g["card_w"])
    return g


def scenario(**kw):
    req = urllib.request.Request(f"{BASE}/__scenario", data=json.dumps(kw).encode(), headers={"Content-Type": "application/json"}, method="POST")
    urllib.request.urlopen(req).read()


def bad_text(page):
    t = page.inner_text("body")
    for needle in ("That did not load", "couldn't", "could not", "Loading Holler", "No alerts yet", "Prices did not load", "Something went wrong"):
        if needle in t:
            raise RuntimeError(f"unexpected text on screen: {needle!r}")
    if page.query_selector(".skeleton"):
        raise RuntimeError("skeleton still on screen")


def capture_app(browser, plat, name):
    g = geom(plat, name)
    t = TARGETS[plat]
    session = {
        "access_token": "capture.token.value", "token_type": "bearer", "expires_in": 315360000,
        "expires_at": int(time.time()) + 315360000, "refresh_token": "capture-refresh",
        "user": {"id": "00000000-0000-4000-8000-0000000000a1", "aud": "authenticated", "role": "authenticated", "email": "member@example.com",
                 "app_metadata": {}, "user_metadata": {}, "created_at": "2026-11-01T00:00:00Z"},
    }
    ctx = browser.new_context(viewport={"width": g["vw"], "height": 1500 if g["fit"] else g["vh"]}, device_scale_factor=3, is_mobile=True, has_touch=True,
                              timezone_id="America/Chicago", locale="en-US")
    ctx.add_init_script(f"localStorage.setItem('holler-auth', {json.dumps(json.dumps(session))});")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    if name in ("01-know-when", "02-storm-hail", "03-permits", "04-311", "05-source-link"):
        scenario(me="paid", feed=name if name != "05-source-link" else "05-source-link")
    elif name == "06-trade-radius":
        scenario(me="onboarding")
    elif name == "07-push":
        scenario(me="paid", feed="01-know-when")
    elif name == "08-price":
        scenario(me="trial", feed="01-know-when")
    page.goto(f"{BASE}/{plat}/index.html")

    if name in ("01-know-when", "02-storm-hail", "03-permits", "04-311"):
        page.wait_for_selector(".alert-card")
    elif name == "05-source-link":
        page.wait_for_selector(".alert-card")
        page.click(".alert-card")
        page.wait_for_selector("text=Open the source record")
        page.wait_for_timeout(300)
        # size the app card to the detail content (topbar + content + tab bar)
        h = page.evaluate("() => document.querySelector('.topbar').offsetHeight + document.querySelector('.content').scrollHeight + document.querySelector('.tabbar').offsetHeight")
        g["vh"] = int(h)
        page.set_viewport_size({"width": g["vw"], "height": g["vh"]})
    elif name == "06-trade-radius":
        page.wait_for_selector("#zip")
        page.wait_for_selector(".chip")
        page.fill("#zip", "60614")
        for label in ("Roofing", "Heating and air (HVAC)", "Plumbing", "Electrical"):
            page.get_by_role("button", name=label, exact=True).click()
        page.evaluate("""() => { const el = document.getElementById('radius'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '15'); el.dispatchEvent(new Event('input', {bubbles: true})); }""")
        page.wait_for_timeout(400)
        bad_text(page)
        sc = "() => document.querySelector('.scroll')"
        page.evaluate("() => document.querySelector('.scroll').scrollTo({top: 0})"); page.wait_for_timeout(200)
        top_png = TMP / f"{plat}-06-top.png"; page.screenshot(path=str(top_png), type="png")
        rows = page.evaluate("""() => { const grid = document.querySelector('.chip-grid'); const b = new Set([...grid.querySelectorAll('.chip')].map(c => Math.round(c.getBoundingClientRect().bottom * 10) / 10));
          const picked = [...document.querySelectorAll('.chip[aria-pressed=true]')].map(c => c.getBoundingClientRect().bottom);
          return {rows: [...b].sort((a, c) => a - c), pickedBottom: Math.max(...picked), vh: window.innerHeight}; }""")
        page.evaluate("() => { const s = document.querySelector('.scroll'); s.scrollTo({top: s.scrollHeight}); }"); page.wait_for_timeout(300)
        bot_png = TMP / f"{plat}-06-bottom.png"; page.screenshot(path=str(bot_png), type="png")
        low = page.evaluate("""() => ({zipLabelTop: document.querySelector('label[for=zip]').getBoundingClientRect().top, vh: window.innerHeight,
          btn: document.querySelector('button[type=submit]').getBoundingClientRect().bottom, zipVal: document.getElementById('zip').value, radius: document.getElementById('radius').value})""")
        assert low["zipVal"] == "60614" and low["radius"] == "15", low
        g["parts"] = dict(top=str(top_png), bottom=str(bot_png), rows=rows, low=low)
    elif name == "07-push":
        scenario(me="paid", feed="01-know-when")
    elif name == "08-price":
        scenario(me="trial", feed="01-know-when")
    page.goto(f"{BASE}/{plat}/index.html")

    if name in ("01-know-when", "02-storm-hail", "03-permits", "04-311"):
        page.wait_for_selector(".alert-card")
    elif name == "05-source-link":
        page.wait_for_selector(".alert-card")
        page.click(".alert-card")
        page.wait_for_selector("text=Open the source record")
        page.wait_for_timeout(300)
        # size the app card to the detail content (topbar + content + tab bar)
        h = page.evaluate("() => document.querySelector('.topbar').offsetHeight + document.querySelector('.content').scrollHeight + document.querySelector('.tabbar').offsetHeight")
        g["vh"] = int(h)
        page.set_viewport_size({"width": g["vw"], "height": g["vh"]})
    elif name == "06-trade-radius":
        page.wait_for_selector("#zip")
        page.wait_for_selector(".chip")
        page.fill("#zip", "60614")
        for label in ("Roofing", "Heating and air (HVAC)", "Plumbing", "Electrical"):
            page.get_by_role("button", name=label, exact=True).click()
        page.evaluate("""() => { const el = document.getElementById('radius'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '15'); el.dispatchEvent(new Event('input', {bubbles: true})); }""")
    elif name == "07-push":
        # The app's own push pre-prompt (PushPrompt) is a short screen that leaves the card half empty, so this shot uses the feed with a
        # flat SIMULATED notification banner. Copy follows the server's push format (lib/push/notify.ts): "New alert near {city}" plus the
        # newest alert's public title (a real holler_signals row, id 33440).
        scenario(me="paid", feed="03-permits")
        page.reload()
        page.wait_for_selector(".alert-card")
        page.evaluate(BANNER)
    elif name == "08-price":
        page.wait_for_selector(".alert-card")
        page.wait_for_function(FIND_NAV)
        page.evaluate(NAVIGATE, {"name": "paywall"})
        page.wait_for_selector("text=Start free trial")
        page.get_by_role("button", name="Monthly", exact=True).click()
        page.wait_for_selector("text=$13.99 a month")
    page.wait_for_timeout(500)
    return ctx, page, errors, g


def scroll_hook(page, name, plat):
    """Per-shot scroll of the app's own scroller, if any."""
    return


def compose(browser, plat, name, head, sub, app_png, g):
    t = TARGETS[plat]
    b64 = base64.b64encode(Path(app_png).read_bytes()).decode()
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{{margin:0;padding:0;background:{BG};}}
    body{{width:{t['W']}px;height:{t['H']}px;overflow:hidden;position:relative;font-family:{FONT};-webkit-font-smoothing:antialiased;}}
    .head{{position:absolute;left:{t['pad']}px;right:{t['pad']}px;top:{t['head_top']}px;}}
    h1{{margin:0;font-size:{t['head_px']}px;line-height:1.08;font-weight:700;letter-spacing:-0.022em;color:{INK};}}
    p{{margin:{t['gap']}px 0 0;font-size:{t['sub_px']}px;line-height:1.3;font-weight:400;color:{MUTED};}}
    .card{{position:absolute;left:{g['card_x']}px;top:{g['card_top']}px;width:{g['card_w']}px;{'' if g['fit'] else 'bottom:0;'}overflow:hidden;
      border:2px solid {LINE};{'' if g['fit'] else 'border-bottom:0;'}border-radius:{round(t['W']*0.04)}px {round(t['W']*0.04)}px {round(t['W']*0.04) if g['fit'] else 0}px {round(t['W']*0.04) if g['fit'] else 0}px;box-shadow:0 10px 50px rgba(25,23,20,0.06);background:#faf8f3;box-sizing:border-box;}}
    .card img{{display:block;width:100%;}}
    </style></head><body><div class="head"><h1>{head}</h1><p>{sub}</p></div><div class="card"><img src="data:image/png;base64,{b64}"></div></body></html>"""
    f = TMP / f"{plat}-{name}.html"; f.write_text(html)
    ctx = browser.new_context(viewport={"width": t["W"], "height": t["H"]}, device_scale_factor=1)
    page = ctx.new_page(); page.goto(f"file://{f}"); page.wait_for_timeout(300)
    # layout checks: text inside the canvas, no horizontal overflow
    m = page.evaluate("""() => { const r = [...document.querySelectorAll('h1,p')].map(e => { const b = e.getBoundingClientRect(); return [b.left, b.right, b.top, b.bottom]; });
      return {sw: document.documentElement.scrollWidth, r}; }""")
    assert m["sw"] <= t["W"], m
    head_bottom = m["r"][1][3]
    if g["fit"]:  # card shorter than the canvas: centre it in the space under the supporting line
        page.evaluate("""([hb, H]) => { const c = document.querySelector('.card'); const im = c.querySelector('img');
          const ch = c.getBoundingClientRect().width * im.naturalHeight / im.naturalWidth; c.style.height = ch + 'px';
          c.style.top = (hb + (H - hb - ch) / 2) + 'px'; }""", [head_bottom, t["H"]])
        cb = page.evaluate("() => document.querySelector('.card').getBoundingClientRect().bottom")
        assert cb < t["H"] - 20, cb
    else:
        assert head_bottom < g["card_top"] - 20, f"{plat} {name}: text bottom {head_bottom} too close to card {g['card_top']}"
    raw = TMP / f"{plat}-{name}-raw.png"
    page.screenshot(path=str(raw), type="png"); ctx.close()
    im = Image.open(raw).convert("RGB")
    assert im.size == (t["W"], t["H"]), im.size
    dest = OUT / plat / f"{name}.png"; dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "PNG", optimize=True)
    return head_bottom


def compose06(browser, plat, head, sub, g):
    """06 is two crops of ONE screen (same state): the top of the onboarding form and its lower part, as two flat cards with a gap."""
    t = TARGETS[plat]; P = g["parts"]; vw = g["vw"]
    top_im = Image.open(P["top"]).convert("RGB"); bot_im = Image.open(P["bottom"]).convert("RGB")
    rows = P["rows"]["rows"]; low = P["low"]
    bot_y0 = int(round((low["zipLabelTop"] - 14) * 3)); bot_crop = bot_im.crop((0, bot_y0, bot_im.width, bot_im.height))
    # header text bottom, measured with the same CSS as compose()
    hb = {"ios": 356, "android": 254}[plat]
    gap = 64 if plat == "ios" else 44
    y0 = hb + (70 if plat == "ios" else 46); bottom_margin = 70 if plat == "ios" else 46
    best = None
    for card_w in range(t["card_w"], 600, -20):
        scale = (card_w - 4) / (vw * 3)
        for n in range(len(rows), 1, -1):
            if n < 2 or rows[n - 1] < P["rows"]["pickedBottom"]:
                continue  # all four selected chips must be inside the top crop
            top_h = int(round((rows[n - 1] + 4) * 3)); h = (top_h + bot_crop.height) * scale + 4 * 2 + gap
            if h <= t["H"] - y0 - bottom_margin:
                best = (card_w, n, top_h); break
        if best: break
    assert best, "06 does not fit"
    card_w, n, top_h = best
    top_crop = top_im.crop((0, 0, top_im.width, top_h))
    def b64(im):
        import io; b = io.BytesIO(); im.save(b, "PNG"); return base64.b64encode(b.getvalue()).decode()
    rad = round(t["W"] * 0.04); x = (t["W"] - card_w) // 2
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{{margin:0;padding:0;background:{BG};}}
    body{{width:{t['W']}px;height:{t['H']}px;overflow:hidden;position:relative;font-family:{FONT};-webkit-font-smoothing:antialiased;}}
    .head{{position:absolute;left:{t['pad']}px;right:{t['pad']}px;top:{t['head_top']}px;}}
    h1{{margin:0;font-size:{t['head_px']}px;line-height:1.08;font-weight:700;letter-spacing:-0.022em;color:{INK};}}
    p{{margin:{t['gap']}px 0 0;font-size:{t['sub_px']}px;line-height:1.3;font-weight:400;color:{MUTED};}}
    .card{{position:absolute;left:{x}px;width:{card_w}px;overflow:hidden;border:2px solid {LINE};border-radius:{rad}px;box-shadow:0 10px 50px rgba(25,23,20,0.06);background:#faf8f3;box-sizing:border-box;}}
    .card img{{display:block;width:100%;}}
    </style></head><body><div class="head"><h1>{head}</h1><p>{sub}</p></div>
    <div class="card" id="a" style="top:{y0}px"><img src="data:image/png;base64,{b64(top_crop)}"></div>
    <div class="card" id="b"><img src="data:image/png;base64,{b64(bot_crop)}"></div></body></html>"""
    f = TMP / f"{plat}-06-two.html"; f.write_text(html)
    ctx = browser.new_context(viewport={"width": t["W"], "height": t["H"]}, device_scale_factor=1)
    page = ctx.new_page(); page.goto(f"file://{f}"); page.wait_for_timeout(300)
    m = page.evaluate("""(gap) => { const a = document.getElementById('a'), b = document.getElementById('b');
      b.style.top = (a.getBoundingClientRect().bottom + gap) + 'px';
      const r = [...document.querySelectorAll('h1,p')].map(e => e.getBoundingClientRect().bottom);
      return {sw: document.documentElement.scrollWidth, headBottom: Math.max(...r), aTop: a.getBoundingClientRect().top, aBottom: a.getBoundingClientRect().bottom, bTop: b.getBoundingClientRect().top, bBottom: b.getBoundingClientRect().bottom}; }""", gap)
    assert m["sw"] <= t["W"] and m["headBottom"] < m["aTop"] - 20 and m["bBottom"] <= t["H"] - 20, m
    raw = TMP / f"{plat}-06-raw.png"; page.screenshot(path=str(raw), type="png"); ctx.close()
    im = Image.open(raw).convert("RGB"); assert im.size == (t["W"], t["H"])
    dest = OUT / plat / "06-trade-radius.png"; im.save(dest, "PNG", optimize=True)
    print(plat, "06 two crops: card_w", card_w, "chip rows in top crop", n, m)


def contact_sheet():
    W, margin, gap, cols = 2400, 60, 50, 4
    cw = (W - 2 * margin - gap * (cols - 1)) // cols
    ch = round(cw * 2868 / 1320)
    label_h = 80
    H = margin * 2 + 2 * (ch + label_h) + gap
    sheet = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(sheet)
    font = ImageFont.truetype("/usr/share/fonts/opentype/inter/Inter-Bold.otf", 46)
    for i, (name, *_ ) in enumerate(SHOTS):
        r, c = divmod(i, cols)
        x = margin + c * (cw + gap); y = margin + r * (ch + label_h + gap)
        d.text((x, y + 8), str(i + 1), font=font, fill=INK)
        im = Image.open(OUT / "ios" / f"{name}.png").convert("RGB").resize((cw, ch), Image.LANCZOS)
        sheet.paste(im, (x, y + label_h))
        d.rectangle([x, y + label_h, x + cw - 1, y + label_h + ch - 1], outline=LINE, width=2)
    sheet.save(OUT / "contact-sheet.png", "PNG", optimize=True)


def main():
    only = sys.argv[1:]  # optional names
    srv = subprocess.Popen(["node", str(HERE / "mock-api.mjs"), str(PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    try:
        for _ in range(50):
            try: urllib.request.urlopen(f"{BASE}/api/m/config").read(); break
            except Exception: time.sleep(0.1)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--no-sandbox", "--hide-scrollbars"])
            for plat in ("ios", "android"):
                for name, head, sub in SHOTS:
                    if only and name not in only: continue
                    ctx, page, errs, g = capture_app(browser, plat, name)
                    scroll_hook(page, name, plat)
                    bad_text(page)
                    if errs: print("PAGE ERRORS", plat, name, errs)
                    if name == "06-trade-radius":
                        ctx.close(); compose06(browser, plat, head, sub, g); continue
                    app_png = TMP / f"{plat}-{name}-app.png"
                    page.screenshot(path=str(app_png), type="png"); ctx.close()
                    hb = compose(browser, plat, name, head, sub, app_png, g)
                    print(plat, name, "ok; text bottom", round(hb))
            browser.close()
        if not only: contact_sheet()
    finally:
        srv.terminate()

if __name__ == "__main__":
    main()
