#!/usr/bin/env python3
"""
Regenerate the brand files in public/ from one drawing of the mark:

  public/icon.svg              32x32 favicon: signal tile, ink arcs (the same drawing as components/logo.tsx LogoMark)
  public/apple-touch-icon.png  180x180, full bleed (iOS rounds the corners itself)
  public/og.png                1200x630 share image: field green, the lockup, the tagline in the display face

The PNGs are screenshots of small HTML pages taken with Chrome through Python playwright. Fonts come from the installed
@fontsource packages (file:// URLs), so nothing is fetched from the network.

Run from the repo root: python3 -I scripts/brand-assets.py
"""
import asyncio
import pathlib
import tempfile

from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / 'public'
FONTS = ROOT / 'node_modules'
BARLOW = (FONTS / '@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2').as_uri()
INTER = (FONTS / '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2').as_uri()
MONO = (FONTS / '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2').as_uri()

BRAND = '#1E3A2C'
BRAND_RAISED = '#24443A'
SIGNAL = '#D9F046'
INK = '#14201A'
ON_BRAND = '#F5F4EF'
ON_BRAND_MUTED = '#C9D6CD'
RING = '#7A9A85'
PERMIT_ON_BRAND = '#6FB38A'
CIVIC_ON_BRAND = '#C9A8F0'
WEATHER_ON_BRAND = '#8FBBD9'

# The arcs, drawn on a 24-unit grid (same paths as the design's nav mark).
ARCS = 'M8 8a5.7 5.7 0 0 0 0 8M16 8a5.7 5.7 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14'


def mark_svg(size: int, radius: float, *, xmlns: bool = True) -> str:
    """Tile of `size` px with the arcs scaled to 0.59 of it (20 of 34 in the design), centred."""
    glyph = size * 20 / 34
    scale = glyph / 24
    off = (size - glyph) / 2
    ns = ' xmlns="http://www.w3.org/2000/svg"' if xmlns else ''
    return (
        f'<svg{ns} width="{size}" height="{size}" viewBox="0 0 {size} {size}" fill="none">'
        f'<rect width="{size}" height="{size}" rx="{radius:g}" fill="{SIGNAL}"/>'
        f'<g transform="translate({off:.3f} {off:.3f}) scale({scale:.4f})" stroke="{INK}" stroke-width="2.4" stroke-linecap="round">'
        f'<circle cx="12" cy="12" r="2"/><path d="{ARCS}"/></g></svg>'
    )


FONT_CSS = f"""
@font-face {{ font-family: 'Barlow Condensed'; font-weight: 700; src: url('{BARLOW}') format('woff2'); }}
@font-face {{ font-family: 'Inter'; font-weight: 100 900; src: url('{INTER}') format('woff2'); }}
@font-face {{ font-family: 'JetBrains Mono'; font-weight: 100 800; src: url('{MONO}') format('woff2'); }}
html, body {{ margin: 0; padding: 0; }}
"""


def og_html() -> str:
    # Decorative radius rings and family dots (square for permits and weather, round for 311), no labels and no data.
    dots = [
        (62, 30, PERMIT_ON_BRAND, '5px'),
        (78, 62, CIVIC_ON_BRAND, '50%'),
        (40, 70, WEATHER_ON_BRAND, '5px'),
        (30, 38, CIVIC_ON_BRAND, '50%'),
        (57, 82, PERMIT_ON_BRAND, '5px'),
    ]
    dot_html = ''.join(
        f'<span style="position:absolute;left:{x}%;top:{y}%;width:30px;height:30px;transform:translate(-50%,-50%);'
        f'background:{c};border:3.5px solid {ON_BRAND};border-radius:{r};box-sizing:border-box"></span>'
        for x, y, c, r in dots
    )
    rings = ''.join(
        f'<span style="position:absolute;left:50%;top:50%;width:{w}%;height:{w}%;transform:translate(-50%,-50%);'
        f'border-radius:50%;border:2px dashed {RING}"></span>'
        for w in (92, 61.3, 30.7)
    )
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{FONT_CSS}</style></head>
<body><div style="width:1200px;height:630px;background:{BRAND};color:{ON_BRAND};box-sizing:border-box;padding:64px 72px;
display:flex;gap:56px;align-items:center;font-family:Inter,sans-serif;overflow:hidden">
  <div style="flex:1 1 auto;display:flex;flex-direction:column;gap:36px;min-width:0">
    <div style="display:flex;align-items:center;gap:16px">
      {mark_svg(64, 12, xmlns=False)}
      <span style="font-family:'Barlow Condensed';font-weight:700;font-size:58px;line-height:1;letter-spacing:.01em">HOLLER</span>
    </div>
    <div style="font-family:'Barlow Condensed';font-weight:700;font-size:112px;line-height:.9;text-transform:uppercase">
      Know when your town needs you.</div>
    <div style="font-family:'JetBrains Mono';font-weight:500;font-size:24px;letter-spacing:.06em;color:{SIGNAL}">LOCALHOLLER.COM</div>
  </div>
  <div style="flex:0 0 400px;height:400px;position:relative;background:{BRAND_RAISED};border-radius:28px;overflow:hidden">
    {rings}{dot_html}
    <span style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:26px;height:26px;border-radius:50%;
      background:{SIGNAL}"></span>
  </div>
</div></body></html>"""


def touch_html() -> str:
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{FONT_CSS}</style></head>
<body>{mark_svg(180, 0, xmlns=False)}</body></html>"""


async def shoot(browser, html: str, width: int, height: int, out: pathlib.Path) -> None:
    page = await browser.new_page(viewport={'width': width, 'height': height}, device_scale_factor=1)
    # A file:// page, so the file:// fonts load (a page made with set_content is about:blank and may not read them).
    with tempfile.TemporaryDirectory() as tmp:
        src = pathlib.Path(tmp) / 'asset.html'
        src.write_text(html)
        await page.goto(src.as_uri(), wait_until='load')
        await page.evaluate('document.fonts.ready')
        loaded = await page.evaluate("[...document.fonts].filter(f => f.status === 'loaded').map(f => f.family)")
        if html.count('Barlow Condensed') > 1 and 'Barlow Condensed' not in loaded:
            raise SystemExit(f'Barlow Condensed did not load for {out.name}: {loaded}')
        await page.screenshot(path=str(out), clip={'x': 0, 'y': 0, 'width': width, 'height': height})
    await page.close()


async def main() -> None:
    (PUBLIC / 'icon.svg').write_text(mark_svg(32, 6) + '\n')
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        await shoot(browser, touch_html(), 180, 180, PUBLIC / 'apple-touch-icon.png')
        await shoot(browser, og_html(), 1200, 630, PUBLIC / 'og.png')
        await browser.close()
    print('wrote public/icon.svg, public/apple-touch-icon.png, public/og.png')


if __name__ == '__main__':
    asyncio.run(main())
