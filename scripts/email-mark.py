#!/usr/bin/env python3
"""
Make public/email-mark.png, the mark in the email header (lib/email/theme.ts emailHeader).

It is public/icon.svg drawn at 60x60 px, shown at 30x30 in the email so it stays sharp on 2x screens. The corners outside the
rounded tile stay transparent, so the green header band shows through them even in clients that ignore border-radius.
The PNG is a screenshot taken with Chrome through Python playwright; nothing is fetched from the network.

Run from the repo root: python3 -I scripts/email-mark.py
"""
import pathlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'public' / 'icon.svg'
OUT = ROOT / 'public' / 'email-mark.png'
SIZE = 60


def main() -> None:
    svg = SRC.read_text(encoding='utf-8')
    # Draw the 32-unit icon at SIZE px: same drawing, larger box.
    svg = svg.replace('width="32" height="32"', f'width="{SIZE}" height="{SIZE}"', 1)
    if f'width="{SIZE}"' not in svg:
        raise SystemExit('public/icon.svg no longer has width="32" height="32"; update this script')
    html = f'<!doctype html><html><body style="margin:0;background:transparent">{svg}</body></html>'
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/google-chrome')
        page = browser.new_page(viewport={'width': SIZE, 'height': SIZE}, device_scale_factor=1)
        page.set_content(html)
        page.locator('svg').screenshot(path=str(OUT), omit_background=True)
        browser.close()
    print(f'wrote {OUT.relative_to(ROOT)} ({SIZE}x{SIZE})')


if __name__ == '__main__':
    main()
