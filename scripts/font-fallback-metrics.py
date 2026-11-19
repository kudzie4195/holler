#!/usr/bin/env python3
"""
Compute the metric-matched fallback face for Barlow Condensed 700 (the display font) in app/globals.css.

Method (same idea as next/font's fallback faces):
  size-adjust     = average advance width of Barlow Condensed Bold / average advance width of the fallback (Arial Bold),
                    each weighted by English letter frequency. Display text is always uppercase, so the average is
                    taken over the uppercase letters A to Z plus the space, which is what a headline actually contains.
  ascent-override = Barlow ascent / unitsPerEm / size-adjust   (Barlow sets USE_TYPO_METRICS, so the typo values)
  descent-override, line-gap-override: same.

Liberation Sans Bold has the same advance widths as Arial Bold by design (metric compatible), so it stands in for Arial
Bold here. The woff (zlib) file is read, not the woff2, so no brotli module is needed.

Run: python3 scripts/font-fallback-metrics.py
"""
from fontTools.ttLib import TTFont

BARLOW = 'node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff'
ARIAL_BOLD = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'

# English letter frequency (percent), plus the space at about one character in six.
FREQ = {
    'E': 12.7, 'T': 9.06, 'A': 8.17, 'O': 7.51, 'I': 6.97, 'N': 6.75, 'S': 6.33, 'H': 6.09, 'R': 5.99, 'D': 4.25,
    'L': 4.03, 'C': 2.78, 'U': 2.76, 'M': 2.41, 'W': 2.36, 'F': 2.23, 'G': 2.02, 'Y': 1.97, 'P': 1.93, 'B': 1.29,
    'V': 0.98, 'K': 0.77, 'J': 0.15, 'X': 0.15, 'Q': 0.10, 'Z': 0.07, ' ': 20.0,
}


def avg_width(font: TTFont) -> float:
    cmap = font.getBestCmap()
    hmtx = font['hmtx']
    upm = font['head'].unitsPerEm
    total = sum(FREQ.values())
    return sum(hmtx[cmap[ord(ch)]][0] / upm * w for ch, w in FREQ.items()) / total


def main() -> None:
    barlow = TTFont(BARLOW)
    arial = TTFont(ARIAL_BOLD)
    b, a = avg_width(barlow), avg_width(arial)
    size_adjust = b / a
    os2 = barlow['OS/2']
    upm = barlow['head'].unitsPerEm
    use_typo = bool(os2.fsSelection & 128)
    if use_typo:
        asc, desc, gap = os2.sTypoAscender, -os2.sTypoDescender, os2.sTypoLineGap
    else:
        hhea = barlow['hhea']
        asc, desc, gap = hhea.ascent, -hhea.descent, hhea.lineGap
    print(f'average width (em): Barlow Condensed 700 {b:.4f}, Arial Bold {a:.4f}')
    print(f'Barlow metrics ({"typo" if use_typo else "hhea"}): ascent {asc}, descent {desc}, line gap {gap}, upm {upm}')
    print(f'size-adjust: {size_adjust * 100:.2f}%')
    print(f'ascent-override: {asc / upm / size_adjust * 100:.2f}%')
    print(f'descent-override: {desc / upm / size_adjust * 100:.2f}%')
    print(f'line-gap-override: {gap / upm / size_adjust * 100:.2f}%')


if __name__ == '__main__':
    main()
