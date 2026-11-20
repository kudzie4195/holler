"""Capture helpers for the round 11 direction studies. Every pixel of app UI comes from the REAL built app (store/.gen/dist, built
from mobile/src by store/build-captures.sh) rendering real rows from store/fixtures/real-signals.json through store/mock-api.mjs.
Reuses the r10 pipeline (store/make-screenshots.py: open_app, the capture session, the push seed, the error checks) unchanged.

  screen(...)  one whole real viewport (393 CSS px wide, an iPhone-sized height), deviceScaleFactor 4
  element(...) one real element of a real screen (an alert card, a detail card) as it renders, deviceScaleFactor 4
Nothing in the app is changed: no text, no style. A screen may be scrolled by its own scroller, as a member would.
"""
import importlib.util, json, subprocess, time, urllib.request
from contextlib import contextmanager
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
STORE = HERE.parent
_spec = importlib.util.spec_from_file_location("ms", STORE / "make-screenshots.py")
ms = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ms)

CAP = STORE / ".gen" / "directions"          # git-ignored (.gen/)
CAP.mkdir(parents=True, exist_ok=True)
DSF = ms.DSF
VW = 393
VH = 852                                     # an iPhone 15/16 Pro viewport height in CSS px


@contextmanager
def session():
    srv = subprocess.Popen(["node", str(STORE / "mock-api.mjs"), str(ms.PORT), str(ms.DIST)], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(f"{ms.BASE}/api/m/config").read(); break
            except Exception:
                time.sleep(0.1)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
                                         args=["--no-sandbox", "--hide-scrollbars", "--allow-file-access-from-files", "--font-render-hinting=none"])
            try:
                yield browser
            finally:
                browser.close()
    finally:
        srv.terminate()


VISIBLE_TEXT = """(limit) => { const out = []; const walk = document.createTreeWalker(document.querySelector('.app'), NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) { const n = walk.currentNode; if (!n.textContent.trim()) continue; const r = document.createRange();
  r.selectNodeContents(n); const b = r.getBoundingClientRect(); if (b.height && b.top < limit && b.bottom > 0) out.push(n.textContent.trim()); }
  return out; }"""


def _check_feed(feed, page, limit):
    """Every alert title on screen must be a row of the very feed the mock served (ms.records_for raises otherwise)."""
    shown = page.evaluate(ms.VISIBLE_ALERTS, limit)
    return ms.records_for(feed, shown) if feed else []


def screen(browser, key, feed, route=None, ready=".app", me="paid", plat="ios", vh=VH, scroll=None, prep=None):
    """One whole real viewport. scroll: CSS px for the screen's own scroller (a member who scrolled), or a JS expression giving it."""
    ctx, page = ms.open_app(browser, plat, VW, vh, me, feed, route, ready)
    if prep:
        prep(page)
    if scroll is not None:
        y = page.evaluate(scroll) if isinstance(scroll, str) else scroll
        page.evaluate("(y) => { document.querySelector('.scroll').scrollTop = y; }", y)
        page.wait_for_timeout(250)
    text = page.evaluate(VISIBLE_TEXT, vh)
    # where things sit (CSS px): every card, and the bottom of the last line of text in the scroller
    layout = page.evaluate("""() => ({cards: [...document.querySelectorAll('.scroll article.card')].map(e => { const b = e.getBoundingClientRect();
        return {top: b.top, bottom: b.bottom, title: (e.querySelector('.alert-title') || {}).textContent || null}; }),
      textBottom: Math.max(...[...document.querySelectorAll('.scroll p, .scroll a, .scroll button, .scroll dd')].map(e => e.getBoundingClientRect().bottom))})""")
    recs = _check_feed(feed, page, vh) if route is None else []
    path = CAP / f"{key}.png"
    page.screenshot(path=str(path), type="png", clip={"x": 0, "y": 0, "width": VW, "height": vh})
    ctx.close()
    return dict(kind="screen", key=key, path=path, css=(VW, vh), px=Image.open(path).size, text=text, layout=layout, records=recs, feed=feed, route=route)


def element(browser, key, feed, selector, route=None, ready=".app", me="paid", plat="ios", nth=0, vh=1800):
    """One real element as the app renders it on a 393 px wide screen, cut out at its own box. Its corner radius is returned so the
    composition can round the cut the same way (the app's paper shows in the corners otherwise)."""
    ctx, page = ms.open_app(browser, plat, VW, vh, me, feed, route, ready)
    loc = page.locator(selector).nth(nth)
    loc.wait_for()
    info = loc.evaluate("""(e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
      return {x: b.left, y: b.top, w: b.width, h: b.height, radius: parseFloat(s.borderTopRightRadius) || 0,
              title: (e.querySelector('.alert-title') || {}).textContent || null,
              distance: (e.querySelector('.meta-strong') || {}).textContent || null, text: e.innerText}; }""")
    path = CAP / f"{key}.png"
    page.screenshot(path=str(path), type="png", clip={"x": info["x"], "y": info["y"], "width": info["w"], "height": info["h"]})
    ctx.close()
    rec = []
    if feed and info["title"]:
        rec = ms.records_for(feed, [{"title": info["title"], "distance": info["distance"]}])
    return dict(kind="element", key=key, path=path, css=(info["w"], info["h"]), px=Image.open(path).size, radius=info["radius"],
                box=dict(x=info["x"], y=info["y"], w=info["w"], h=info["h"]),
                text=info["text"], records=rec, feed=feed, route=route, selector=selector)
