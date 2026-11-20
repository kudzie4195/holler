#!/usr/bin/env python3
"""Round 11, step 1: three visual directions for the iOS store screenshots, the first three shots of each (brief:
/home/claude/gates/r11/brief-directions.md; contract: /home/claude/gates/r10/CONTEXT.md). Run from mobile/:

    node store/directions/map-data.mjs          # the web site's radius map functions on the fixture rows -> .gen/directions/map.json
    python3 store/directions/make-directions.py # -> /home/claude/gates/r11/directions/{A,B,C}-{1,2,3}.png, sheet.png, thumbs.png

What is real and what is drawn:
  * Every phone screen and every card is the REAL built app (store/.gen/dist) rendering real rows from fixtures/real-signals.json
    through store/mock-api.mjs, captured at deviceScaleFactor 4 by capture.py (the r10 pipeline, unchanged). Cards are cut out at their
    own box; nothing in the app is edited. Every record shown is checked against the very feed the mock served.
  * The map (direction B) is the web site's radius map: records picked and labelled by lib/seo/home-map.ts and home-label.ts from the
    fixture rows, distances from lib/geo. Here each dot sits at its record's TRUE compass bearing from the ZIP (the site uses free
    angles), so the drawing is to scale in distance and direction and needs no caveat.
  * Big figures (direction C) are copied from the very card beside them, read from the captured app text at run time.
  * The script draws only: flat backgrounds, eyebrow, headline, supporting line, phone frames, one soft shadow under a lifted card,
    the map, and the big figures. No gradients, glows, badges, arrows or OS chrome.
"""
import json, re, sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import capture as cap  # noqa: E402

ms = cap.ms
OUT = Path("/home/claude/gates/r11/directions")
OUT.mkdir(parents=True, exist_ok=True)
WORK = cap.CAP
MAP = json.loads((WORK / "map.json").read_text())
W, H = 1320, 2868
EDGE = 64                      # drawn text stays this far from every edge (CONTEXT store specs)

# Brand tokens (app/globals.css). Every colour drawn is one of these, except civic_deep: the site has sky-deep and sage-deep tints
# but no deeper civic tint, so civic_deep is derived the same way (the civic tint taken the same step toward its mark).
T = dict(green="#1E3A2C", deep="#14291E", raised="#24443A", ring="#7A9A85", paper="#F5F4EF", surface="#FFFFFF", sand="#ECEAE2",
         ink="#14201A", muted="#5B635D", brand_text="#2E5A41", on_brand="#F5F4EF", on_brand_muted="#C9D6CD", on_brand_faint="#A9BDB0",
         signal="#D9F046", sky="#DDE8EC", sky_deep="#C9DCE5", storm="#4C7FA6", storm_ink="#1F4A63", sage="#E3EFE6", sage_deep="#CFE3D5",
         sage_mark="#3F8A5C", sage_ink="#24513A", civic="#EFEAF7", civic_deep="#E1D8F0", civic_mark="#8A68BF", civic_ink="#5B3F86",
         permit_on_brand="#6FB38A", civic_on_brand="#C9A8F0", weather_on_brand="#8FBBD9")

# Grid (kept from r10 as a system): margins, eyebrow, headline and supporting-line sizes and tops. Only the hero moves.
G = dict(M=110, eyebrow_top=176, eyebrow_px=34, head_gap=30, head_px=156, head_lh=0.9, sub_gap=34, sub_px=46)
HEAD_TOP = G["eyebrow_top"] + round(G["eyebrow_px"] * 1.2) + G["head_gap"]
SUB_TOP = round(HEAD_TOP + 2 * G["head_px"] * G["head_lh"] + G["sub_gap"])
SHADOW = "0 30px 70px rgba(20,32,26,0.30), 0 6px 16px rgba(20,32,26,0.16)"   # the one shadow, used only under a lifted card

# Text colours per background: eyebrow, headline, supporting line.
BG_TEXT = {
    "green": ("signal", "on_brand", "on_brand_muted"),
    "deep": ("signal", "on_brand", "on_brand_muted"),
    "sky_deep": ("storm_ink", "ink", "storm_ink"),
    "sage_deep": ("sage_ink", "ink", "sage_ink"),
    "civic": ("civic_ink", "ink", "civic_ink"),
    "civic_deep": ("civic_ink", "ink", "civic_ink"),
    "paper": ("brand_text", "ink", "muted"),
    "ink": ("signal", "on_brand", "on_brand_muted"),
}


def lum(h):
    h = h.lstrip("#"); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# ---------------------------------------------------------------- captures (all real app) ------------------------------------------

def take_captures():
    A = {}
    with cap.session() as b:
        # the roofer's feed in 60614 (311 tree emergency 4.9 mi, roof permit 2.6 mi, code violation 5 mi)
        A["feed"] = cap.screen(b, "feed", "01-records", ready=".alert-card")
        A["feed_permit"] = cap.element(b, "feed-permit", "01-records", "article.card.stripe-permit", ready=".alert-card")
        A["feed_311"] = cap.element(b, "feed-311", "01-records", "article.card.stripe-civic", ready=".alert-card", nth=0)
        # storms around 33301 (1.00 inch hail 7.4 mi, severe thunderstorm warning 3.1 mi)
        A["storm_feed"] = cap.screen(b, "storm-feed", "02-storms", ready=".alert-card")
        A["storm_hail"] = cap.element(b, "storm-hail", "02-storms", "article.card", ready=".alert-card", nth=0)
        A["storm_warn"] = cap.element(b, "storm-warn", "02-storms", "article.card", ready=".alert-card", nth=1)
        A["hail_detail"] = cap.screen(b, "hail-detail", "02-storms", {"name": "alert", "signalId": 24614}, "article.card .alert-title")
        A["hail_detail_card"] = cap.element(b, "hail-detail-card", "02-storms", "article.card", {"name": "alert", "signalId": 24614}, "article.card .alert-title")
        # 311 and code details for the same member
        A["d311"] = cap.screen(b, "detail-311", "01-records", {"name": "alert", "signalId": 45354}, "article.card .alert-title")
        A["dcode"] = cap.screen(b, "detail-code", "01-records", {"name": "alert", "signalId": 4291}, "article.card .alert-title")
        A["droof"] = cap.screen(b, "detail-roof", "01-records", {"name": "alert", "signalId": 33439}, "article.card .alert-title")
        # the member's own settings for what is near: work ZIP and radius (scrolled by the screen's own scroller to the ZIP field)
        A["zip_radius"] = cap.screen(b, "zip-radius", "03-radius", {"name": "profile"}, "#zip",
                                     scroll="(() => { const s = document.querySelector('.scroll'); const z = document.getElementById('zip'); return z.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop - 120; })()")
        A["droof_card"] = cap.element(b, "detail-roof-card", "01-records", "article.card", {"name": "alert", "signalId": 33439}, "article.card .alert-title")
        # HVAC permit with its job value and the Open the source button
        A["hvac_card"] = cap.element(b, "hvac-card", "04-source", "article.card", {"name": "alert", "signalId": 33435}, "article.card .alert-title")
        A["hvac_detail"] = cap.screen(b, "hvac-detail", "04-source", {"name": "alert", "signalId": 33435}, "article.card .alert-title")
    # where each feed card sits on the feed screen (CSS px), for lifting it out in place
    # detail screens: the record must be the one asked for, from the served data
    for k, feed, sid in (("hail_detail", "02-storms", 24614), ("d311", "01-records", 45354), ("dcode", "01-records", 4291),
                         ("droof", "01-records", 33439), ("hvac_detail", "04-source", 33435)):
        it = ms.DATA["alerts"][f"{feed}:{sid}"]
        assert it["title"] in A[k]["text"] or any(it["title"].startswith(t) for t in A[k]["text"]), (k, it["title"])
        assert it["distanceLabel"] in A[k]["text"], (k, it["distanceLabel"], A[k]["text"])
        A[k]["records"] = [dict(signalId=sid, title=it["title"], distance=it["distanceLabel"])]
    for k, feed, sid in (("hail_detail_card", "02-storms", 24614), ("droof_card", "01-records", 33439), ("hvac_card", "04-source", 33435)):
        it = ms.DATA["alerts"][f"{feed}:{sid}"]
        assert it["title"] in A[k]["text"] and it["distanceLabel"] in A[k]["text"], (k, A[k]["text"])
        A[k]["records"] = [dict(signalId=sid, title=it["title"], distance=it["distanceLabel"])]
    return A


# ---------------------------------------------------------------- drawing pieces ---------------------------------------------------

def phone(c, x, y, sw, z=1, clip_h=None, shadow=False):
    """A flat ink phone frame with even bezels around one real screen capture. sw: screen width on the canvas. clip_h: show only the
    top clip_h px of the screen (the frame then runs off the canvas or ends square under it, never drawn as a cut-off phone)."""
    vw, vh = c["css"]
    s = sw / vw
    sh = round(vh * s)
    bez = max(16, round(sw * 0.026))
    r_in = round(36 * s)
    r_out = r_in + bez
    h = sh if clip_h is None else clip_h
    return (f'<div class="phone" style="left:{x}px;top:{y}px;width:{sw}px;height:{h}px;border:{bez}px solid {T["ink"]};'
            f'border-radius:{r_out}px;z-index:{z};{"box-shadow:" + SHADOW + ";" if shadow else ""}">'
            f'<div style="width:{sw}px;height:{h}px;border-radius:{r_in}px;overflow:hidden;background:{T["paper"]}">'
            f'<img src="file://{c["path"]}" style="width:{sw}px;height:{sh}px"></div></div>'), dict(x=x, y=y, w=sw + 2 * bez, h=h + 2 * bez, bez=bez, s=s)


def card(c, x, y, w, z=2, shadow=True, crop_h=None):
    """One real card cut out at its own box, its own corner radius kept."""
    cw, ch = c["css"]
    s = w / cw
    h = round(ch * s) if crop_h is None else crop_h
    r = round(c["radius"] * s)
    return (f'<div class="card" style="left:{x}px;top:{y}px;width:{w}px;height:{h}px;border-radius:{r}px;z-index:{z};'
            f'{"box-shadow:" + SHADOW + ";" if shadow else ""}">'
            f'<img src="file://{c["path"]}" style="width:{w}px;height:{round(ch * s)}px"></div>'), dict(x=x, y=y, w=w, h=h, s=s)


def text_block(bg, eyebrow, head, sub, x=None, width=None, colors=None):
    e, hcol, scol = [T[k] for k in (colors or BG_TEXT[bg])]
    x = G["M"] if x is None else x
    width = (W - 2 * G["M"]) if width is None else width
    assert contrast(scol, T[bg]) >= 4.5, ("supporting line contrast", bg, contrast(scol, T[bg]))
    assert contrast(hcol, T[bg]) >= 3.0, ("headline contrast", bg)
    if bg not in ("green", "deep", "ink"):
        assert e != T["signal"], "no lime text on a light background"
    return (f'<p class="t eyebrow" style="left:{x}px;width:{width}px;top:{G["eyebrow_top"]}px;color:{e}">{esc(eyebrow)}</p>'
            f'<h1 class="t head" style="left:{x}px;width:{width}px;top:{HEAD_TOP}px;color:{hcol}">{"".join(f"<span>{esc(l)}</span>" for l in head)}</h1>'
            f'<p class="t sub" style="left:{x}px;width:{width}px;top:{SUB_TOP}px;color:{scol}">{esc(sub)}</p>')


def css():
    return f"""{ms.font_faces()}
    html,body{{margin:0;padding:0}} body{{position:relative;overflow:hidden;-webkit-font-smoothing:antialiased}}
    .t{{position:absolute;margin:0;white-space:nowrap}}
    .eyebrow{{font-family:'JetBrains Mono';font-weight:500;font-size:{G['eyebrow_px']}px;line-height:1.2;letter-spacing:0.08em;text-transform:uppercase}}
    .head{{font-family:'Barlow Condensed';font-weight:700;font-size:{G['head_px']}px;line-height:{G['head_lh']};text-transform:uppercase}}
    .head span{{display:block}}
    .sub{{font-family:'Inter';font-weight:500;font-size:{G['sub_px']}px;line-height:1.25}}
    .phone,.card{{position:absolute;box-sizing:content-box;overflow:hidden}} .card{{background:{T['surface']}}}
    .phone > div{{overflow:hidden}} img{{display:block}}
    .fig{{position:absolute;margin:0;font-family:'JetBrains Mono';font-weight:500;white-space:nowrap;letter-spacing:-0.04em;line-height:1}}
    .ring{{position:absolute;border-radius:50%;box-sizing:border-box;transform:translate(-50%,-50%)}}
    .dot{{position:absolute;box-sizing:border-box;transform:translate(-50%,-50%)}}
    .lab{{position:absolute;white-space:nowrap;font-family:'JetBrains Mono';font-weight:500;letter-spacing:0;transform:translateY(-50%)}}
    .cap{{position:absolute;white-space:nowrap;font-family:'JetBrains Mono';font-weight:500;transform:translate(-50%,-50%)}}
    .chip{{position:absolute;white-space:nowrap;font-family:'JetBrains Mono';font-weight:500;transform:translate(-50%,-50%)}}
    """


# ---------------------------------------------------------------- the map ----------------------------------------------------------

FAM_ON_GREEN = {"permit": T["permit_on_brand"], "civic": T["civic_on_brand"], "weather": T["weather_on_brand"]}
FAM_ON_LIGHT = {"permit": T["sage_mark"], "civic": T["civic_mark"], "weather": T["storm"]}


def radius_map(cx, cy, px_per_mi, rings, recs, zip_, u, light=False, sides=None):
    """The site's radius map, drawn at unit u (site px -> canvas px). recs: dicts with family, text, mi, bearing (deg from north).
    Dashed rings with mono captions, the ZIP chip in lime, square permit and weather dots, round 311 and code dots, labels in chips."""
    ring_c = T["ring"] if not light else T["storm"]
    cap_bg = T["green"] if not light else T["sky_deep"]
    cap_fg = T["on_brand_faint"] if not light else T["storm_ink"]
    out = []
    for mi in rings:
        d = 2 * mi * px_per_mi
        out.append(f'<div class="ring" style="left:{cx}px;top:{cy}px;width:{d}px;height:{d}px;border:{1.5 * u:.1f}px dashed {ring_c}"></div>')
        out.append(f'<span class="cap" style="left:{cx}px;top:{cy - mi * px_per_mi}px;font-size:{13 * u:.1f}px;line-height:{20 * u:.1f}px;'
                   f'padding:0 {6 * u:.1f}px;background:{cap_bg};color:{cap_fg}">{mi} MI</span>')
    import math
    placed = []
    for i, r in enumerate(recs):
        b = math.radians(r["bearing"])
        x = cx + r["mi"] * px_per_mi * math.sin(b)
        y = cy - r["mi"] * px_per_mi * math.cos(b)
        side = (sides or {}).get(r["id"], "right" if x < cx else "left")
        fam = r["family"]
        col = FAM_ON_GREEN[fam] if not light else FAM_ON_LIGHT[fam]
        rad = "50%" if fam == "civic" else f"{5 * u:.1f}px"
        border = T["on_brand"] if not light else T["surface"]
        out.append(f'<span class="dot" style="left:{x:.1f}px;top:{y:.1f}px;width:{22 * u:.1f}px;height:{22 * u:.1f}px;border-radius:{rad};'
                   f'background:{col};border:{2.5 * u:.1f}px solid {border}"></span>')
        lx = x + 16 * u if side == "right" else x - 16 * u
        tr = "translateY(-50%)" if side == "right" else "translate(-100%,-50%)"
        lab_bg = T["deep"] if not light else T["surface"]
        lab_fg = T["on_brand"] if not light else T["ink"]
        out.append(f'<span class="lab" style="left:{lx:.1f}px;top:{y:.1f}px;transform:{tr};font-size:{13 * u:.1f}px;line-height:{20 * u:.1f}px;'
                   f'padding:{3 * u:.1f}px {7 * u:.1f}px;border-radius:{6 * u:.1f}px;background:{lab_bg};color:{lab_fg}">{esc(r["text"])}</span>')
        placed.append(dict(id=r["id"], x=x, y=y, side=side))
    out.append(f'<span class="chip" style="left:{cx}px;top:{cy}px;font-size:{13 * u:.1f}px;line-height:{20 * u:.1f}px;padding:{6 * u:.1f}px {10 * u:.1f}px;'
               f'border-radius:{6 * u:.1f}px;background:{T["signal"]};color:{T["ink"]}">{esc(zip_)}</span>')
    return "".join(out), placed


def chicago_records():
    m = MAP["maps"]["60614"]
    return [dict(id=r["id"], family=r["family"], text=r["text"], mi=r["mi"], bearing=r["bearing"]) for r in m["records"]]


def storm_records():
    """Around the storm member's ZIP 33301: the rows the server's matchOne sends to that member, with the server's distance."""
    p = MAP["points"]["02-storms"]
    served = {it["signalId"] for it in ms.DATA["feeds"]["02-storms"]}
    out = []
    for r in p["rows"]:
        if r["matched"] and r["id"] in served:
            out.append(dict(id=str(r["id"]), family=r["family"], text=f'{r["label"]} {r["matchMi"]:.1f} MI', mi=r["matchMi"], bearing=r["bearing"]))
    return out


# ---------------------------------------------------------------- render -----------------------------------------------------------

def render(browser, name, bg, body, width=W):
    html = f'<!doctype html><html><head><meta charset="utf-8"><style>{css()} body{{width:{width}px;height:{H}px;background:{T[bg]}}}</style></head><body>{body}</body></html>'
    f = WORK / f"dir-{name}.html"; f.write_text(html)
    ctx = browser.new_context(viewport={"width": width, "height": H}, device_scale_factor=1)
    page = ctx.new_page(); page.goto(f"file://{f}")
    page.evaluate("() => Promise.all(['700 40px \"Barlow Condensed\"', '500 40px Inter', '500 40px \"JetBrains Mono\"'].map(f => document.fonts.load(f)))")
    page.evaluate("() => document.fonts.ready")
    page.wait_for_function("() => [...document.images].every(i => i.complete && i.naturalWidth > 0)", timeout=20000)
    page.wait_for_timeout(150)
    # every drawn text line stays inside the canvas with the 64 px edge, measured in Chrome
    # (map text clipped by its panel or under a phone is not seen, so it is not counted)
    boxes = page.evaluate("""() => [...document.querySelectorAll('.t, .fig, .lab, .chip, .cap')].filter(e => { const b = e.getBoundingClientRect();
        const h = document.elementFromPoint(Math.min(Math.max(b.left + b.width / 2, 0), innerWidth - 1), Math.min(Math.max(b.top + b.height / 2, 0), innerHeight - 1));
        return h && (h === e || e.contains(h)); }).map(e => { const r = document.createRange(); r.selectNodeContents(e);
        const rs = [...r.getClientRects()]; return {cls: e.className, text: e.innerText, x0: Math.min(...rs.map(q => q.left)), x1: Math.max(...rs.map(q => q.right)),
        y0: Math.min(...rs.map(q => q.top)), y1: Math.max(...rs.map(q => q.bottom))}; })""")
    raw = WORK / f"dir-{name}-raw.png"
    page.screenshot(path=str(raw), type="png", clip={"x": 0, "y": 0, "width": width, "height": H})
    ctx.close()
    return Image.open(raw).convert("RGB"), boxes


def check_edges(name, boxes, offset=0, width=W):
    for b in boxes:
        x0, x1 = b["x0"] - offset, b["x1"] - offset
        if x1 < 0 or x0 > width:
            continue
        assert x0 >= EDGE - 0.5 and x1 <= width - EDGE + 0.5 and b["y0"] >= EDGE - 0.5 and b["y1"] <= H - EDGE + 0.5, (name, b)


def save(im, name):
    assert im.size == (W, H) and im.mode == "RGB", (name, im.size, im.mode)
    p = OUT / f"{name}.png"
    im.save(p, "PNG", optimize=True)
    assert p.stat().st_size < 8 * 1024 * 1024
    return p


# ---------------------------------------------------------------- direction A: colour by record family ----------------------------

def dir_a(browser, A):
    shots = {}
    M = G["M"]
    # A-1 field green, phone centred, the roof permit lifted out of the feed in place, wider than the phone.
    sw = 840
    ph, pg = phone(A["feed"], (W - sw) // 2 - 22, 860, sw)
    c = A["feed_permit"]; at = c["box"]
    cw = 1150
    cy_in_phone = pg["y"] + pg["bez"] + (at["y"] + at["h"] / 2) * pg["s"]
    _, cg = card(c, 0, 0, cw)
    cd, cg = card(c, (W - cw) // 2, round(cy_in_phone - cg["h"] / 2), cw)
    body = text_block("green", "Permits, 311, storms", ("Public records", "near your work"), "Sorted for your trade, with the distance") + ph + cd
    shots["A-1"] = ("green", body, [c, A["feed"]])

    # A-2 sky, phone offset right with the hail report; the other storm record lifted over its left edge, where the screen is empty.
    sw = 770
    ph, pg = phone(A["hail_detail"], W - sw - 2 * 20 - 60, 840, sw)
    c = A["storm_warn"]
    cw = 960
    art = A["hail_detail"]["layout"]["cards"][0]
    cd, cg = card(c, W - M - 40 - cw, round(pg["y"] + pg["bez"] + (art["bottom"] + 8) * pg["s"]), cw)
    assert cg["y"] + cg["h"] <= H - 120, cg
    body = text_block("sky_deep", "Weather", ("Storm and hail", "reports nearby"), "Hail size, place and miles from you") + ph + cd
    shots["A-2"] = ("sky_deep", body, [c, A["hail_detail"]])

    # A-3 purple, two phones: the 311 request and the code case, each its own detail screen, staggered.
    sw = 690
    p1, g1 = phone(A["d311"], M - 40, 840, sw, z=1)
    # the second phone starts below the first one's text, so it covers only the first screen's empty paper; it runs off the canvas
    top2 = round(g1["y"] + g1["bez"] + (A["d311"]["layout"]["textBottom"] + 30) * g1["s"])
    p2, g2 = phone(A["dcode"], W - sw - 2 * g1["bez"] - M + 40, top2, sw, z=2, shadow=True)
    body = text_block("civic_deep", "311 and code", ("City requests", "and code cases"), "From the city's open data, with distance") + p1 + p2
    shots["A-3"] = ("civic_deep", body, [A["d311"], A["dcode"]])
    for n, (bg, body, used) in shots.items():
        im, boxes = render(browser, n, bg, body)
        check_edges(n, boxes)
        save(im, n)
        RECORD[n] = dict(bg=T[bg], records=[r for u in used for r in u["records"]])


# ---------------------------------------------------------------- direction B: the map --------------------------------------------

def dir_b(browser, A):
    M = G["M"]
    # B-1 and B-2 are one panorama, 2640 px wide, cut at 1320. The map's centre (ZIP 60614) is in shot 1, where all six records fall
    # (they lie west of the ZIP; east is the lake); its rings run on into shot 2, behind the phone.
    u = 2.5
    ppm = 118                                  # 6 mi = 708 px
    cx, cy = 1130, 1420
    recs = chicago_records()
    mp, placed = radius_map(cx, cy, ppm, MAP["rings"], recs, "60614", u, sides=B_SIDES)
    # shot 1: the member's own feed beside the map, running off the canvas; shot 2: the member's ZIP and radius over the rings
    ph1, g1 = phone(A["feed"], M - 20, 2030, 640, z=3, shadow=True)
    ph2, g2 = phone(A["zip_radius"], W + W - M - 760 - 40 + 20, 1000, 760, z=3, shadow=True)
    body = (text_block("green", "60614 · Chicago", ("Public records", "around your ZIP"), "Permits and 311 calls, drawn to scale")
            + text_block("green", "Your work area", ("Pick how far", "you drive"), "Miles from your work ZIP", x=W + M)
            + mp + ph1 + ph2)
    im, boxes = render(browser, "B-12", "green", body, width=2 * W)
    for i, n in enumerate(("B-1", "B-2")):
        check_edges(n, boxes, offset=i * W)
        save(im.crop((i * W, 0, (i + 1) * W, H)), n)
    RECORD["B-1"] = dict(bg=T["green"], map=recs, records=A["feed"]["records"])
    RECORD["B-2"] = dict(bg=T["green"], map=recs, records=[], screen="profile: ZIP and radius", text=A["zip_radius"]["text"])

    # B-3 a crop of the storm member's map (ZIP 33301, rings to the member's 15 mi radius) in the site's raised panel, the hail
    # report's real screen in front of it.
    srecs = storm_records()
    px0, py0, pw, ph_ = M, 790, W - 2 * M, 1240
    mp, _ = radius_map(560, 190, 90, [5, 10, 15], srecs, "33301", 2.7)
    panel = (f'<div style="position:absolute;left:{px0}px;top:{py0}px;width:{pw}px;height:{ph_}px;border-radius:40px;overflow:hidden;'
             f'background:{T["raised"]}">{mp.replace("background:" + T["green"], "background:" + T["raised"])}</div>')
    ph, g = phone(A["hail_detail"], W - 720 - 2 * 19 - M + 60, 1650, 720, z=3, shadow=True)
    body = text_block("green", "Weather · 33301", ("Storm and hail", "reports nearby"), "Hail size, place and miles from you") + panel + ph
    im, boxes = render(browser, "B-3", "green", body)
    check_edges("B-3", boxes)
    save(im, "B-3")
    RECORD["B-3"] = dict(bg=T["green"], map=srecs, records=A["hail_detail"]["records"])


B_SIDES = {"47080": "left", "33439": "left", "46979": "left", "45354": "left"}   # labels clear of the canvas edge, the chip and the ring captions


# ---------------------------------------------------------------- direction C: editorial ------------------------------------------

def figure_from(c, pattern):
    """A figure copied from the captured card's own text."""
    m = re.search(pattern, c["text"])
    assert m, (pattern, c["text"])
    return m.group(1)


def dir_c(browser, A):
    M = G["M"]
    # C-1 green, no phone: the distance as a huge mono figure, the card it came from under it.
    c = A["feed_permit"]
    mi = figure_from(c, r"([\d.]+) mi away")
    fig = (f'<p class="fig" style="left:{M - 16}px;top:1020px;font-size:470px;color:{T["on_brand"]}">{esc(mi)}'
           f'<span style="font-size:140px;letter-spacing:0.02em;margin-left:34px;color:{T["on_brand_muted"]}">MI</span></p>')
    cd, cg = card(c, M, 1640, W - 2 * M, shadow=False)
    body = text_block("green", "Roof permit, Chicago", ("Public records", "near your work"), "Each one with its distance from you") + fig + cd
    im, boxes = render(browser, "C-1", "green", body)
    check_edges("C-1", boxes); save(im, "C-1")
    RECORD["C-1"] = dict(bg=T["green"], figure=f"{mi} MI", records=c["records"])

    # C-2 paper: the record's own words as a pull quote, the screen it came from under it at a different scale
    h = A["hail_detail"]
    quote = next(t for t in h["text"] if t.startswith("Quarter size hail"))
    i = h["text"].index("Source:")
    src = h["text"][i + 1]
    assert src.startswith("NOAA"), src
    dist = ms.DATA["alerts"]["02-storms:24614"]["distanceLabel"]
    q = (f'<div style="position:absolute;left:{M}px;top:800px;width:{W - 2 * M}px">'
         f'<p class="t" style="position:static;white-space:normal;font-family:Inter;font-weight:600;font-size:84px;'
         f'line-height:1.14;letter-spacing:-0.02em;color:{T["ink"]}">{esc(quote)}</p>'
         f'<p class="t" style="position:static;margin-top:44px;font-family:\'JetBrains Mono\';font-weight:500;font-size:30px;letter-spacing:0.04em;'
         f'text-transform:uppercase;color:{T["muted"]}">{esc(src)} · {esc(dist.replace(" away", ""))}</p></div>')
    ph, g = phone(h, W - M + 40 - 820, 1500, 780)
    body = text_block("paper", "Weather", ("Storm and hail", "reports nearby"), "Hail size, place and miles from you") + q + ph
    im, boxes = render(browser, "C-2", "paper", body)
    check_edges("C-2", boxes); save(im, "C-2")
    RECORD["C-2"] = dict(bg=T["paper"], quote=quote, records=h["records"])

    # C-3 sage, the permit card high, its job value as the hero figure along the bottom
    c = A["hvac_card"]
    val = figure_from(c, r"(\$[\d,]+) job value")
    cd, cg = card(c, M + 100, 820, W - 2 * M - 100)
    fig = f'<p class="fig" style="left:{M - 10}px;top:{cg["y"] + cg["h"] + 150}px;font-size:248px;color:{T["ink"]}">{esc(val)}</p>'
    body = text_block("sage_deep", "Permits", ("The job value", "on the permit"), "Read from the city's own permit data") + cd + fig
    im, boxes = render(browser, "C-3", "sage_deep", body)
    check_edges("C-3", boxes); save(im, "C-3")
    RECORD["C-3"] = dict(bg=T["sage_deep"], figure=val, records=c["records"])


# ---------------------------------------------------------------- sheet ------------------------------------------------------------

NAMES = {"A": "A  Record colours: each shot in its family's colour, one real card lifted out of the phone",
         "B": "B  The radius map: the site's map of real records, a panorama across 1 and 2, a crop behind the phone",
         "C": "C  Editorial: big type and real numbers, mixed scales, not every shot a phone"}


def sheet(browser):
    hgt = 1000; w = round(hgt * W / H)
    rows = ""
    for d in "ABC":
        cells = "".join(f'<figure><figcaption>{d}-{i}</figcaption><img src="file://{OUT / f"{d}-{i}.png"}" width="{w}" height="{hgt}"></figure>' for i in (1, 2, 3))
        rows += f'<h2>{esc(NAMES[d])}</h2><div class="row">{cells}</div>'
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>{ms.font_faces()}
      body{{margin:0;padding:48px 56px;background:#FFFFFF;font-family:Inter;color:{T['ink']};width:max-content}}
      h2{{font-family:Inter;font-weight:600;font-size:30px;margin:0 0 18px;color:{T['ink']}}}
      .row{{display:flex;gap:36px;margin-bottom:56px}} figure{{margin:0}}
      figcaption{{font-family:'JetBrains Mono';font-weight:500;font-size:24px;margin-bottom:10px;color:{T['muted']}}}
      img{{display:block;outline:1px solid {T['line'] if 'line' in T else '#DEDCD2'}}}</style></head><body>{rows}</body></html>"""
    f = WORK / "dir-sheet.html"; f.write_text(html)
    ctx = browser.new_context(viewport={"width": 1800, "height": 1200}, device_scale_factor=1)
    page = ctx.new_page(); page.goto(f"file://{f}")
    page.evaluate("() => document.fonts.ready")
    page.wait_for_function("() => [...document.images].every(i => i.complete && i.naturalWidth > 0)", timeout=20000)
    page.screenshot(path=str(OUT / "sheet.png"), type="png", full_page=True)
    ctx.close()
    Image.open(OUT / "sheet.png").convert("RGB").save(OUT / "sheet.png", "PNG", optimize=True)


def thumbs():
    """The search-result test: every shot at 230 px wide (2x of the store's 115 px), Lanczos, on white."""
    tw = 230; th = round(H * tw / W); gap = 16
    im = Image.new("RGB", (3 * tw + 2 * gap + 2 * gap + 40, 3 * th + 4 * gap), "white")
    for r, d in enumerate("ABC"):
        for i in (1, 2, 3):
            t = Image.open(OUT / f"{d}-{i}.png").resize((tw, th), Image.LANCZOS)
            im.paste(t, (gap + (i - 1) * (tw + gap), gap + r * (th + gap)))
    im.save(OUT / "thumbs-230.png")


RECORD = {}


def main():
    A = take_captures()
    with cap.session() as b:
        only = sys.argv[1:]
        if not only or "A" in only:
            dir_a(b, A)
        if not only or "B" in only:
            dir_b(b, A)
        if not only or "C" in only:
            dir_c(b, A)
        if all((OUT / f"{d}-{i}.png").exists() for d in "ABC" for i in (1, 2, 3)):
            sheet(b)
            thumbs()
    prev = json.loads((OUT / "records.json").read_text()) if (OUT / "records.json").exists() else {}
    prev.update(RECORD)
    (OUT / "records.json").write_text(json.dumps(prev, indent=1, default=str))
    for k, v in RECORD.items():
        print(k, v.get("bg"), [(r["signalId"], r.get("distance")) for r in v.get("records", [])], v.get("figure", ""))


if __name__ == "__main__":
    main()
