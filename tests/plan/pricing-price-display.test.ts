// Build gate 8c: a large price with cents on the plan cards rendered as "9 . 99" because it used the monospace face (each "." took
// a full digit-wide cell). Prices now use the body font with no monospace or tabular digits.
// Round 7: prices got longer ($13.99, $139.99). The price row must wrap on a 320px phone instead of overflowing the card.
// Round 9: the big price is Barlow Condensed 700 at 72 px (font-display, not monospace), in cards with 30 px padding.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Pricing } from '@/components/pricing';

describe('Pricing price display', () => {
  const html = renderToStaticMarkup(createElement(Pricing));
  const priceSpans = [...html.matchAll(/<span data-price="[^"]*"( class="([^"]*)")?>([^<]*)<\/span>/g)];
  it('shows every price as one plain string', () => {
    expect(priceSpans.map((m) => m[3])).toEqual(['$7.99', '$79.99', '$13.99', '$139.99']);
  });
  it('no monospace face, tabular digits or wide letter-spacing on a price', () => {
    for (const m of priceSpans) {
      const cls = m[2] ?? '';
      expect(cls).not.toMatch(/font-mono|tabular-nums|tracking-wide|tracking-wider|tracking-widest/);
    }
  });
  it('mobile width: the big price row wraps, nothing forces a width, and the longest big price fits a 320px card', () => {
    const rows = [...html.matchAll(/<p class="([^"]*)"><span data-price="[^"]*" class="font-display text-\[72px\]/g)].map((m) => m[1]);
    expect(rows).toHaveLength(2);
    for (const cls of rows) {
      expect(cls).toContain('flex-wrap'); // "a month" drops under the price instead of pushing the card wider
      expect(cls).not.toMatch(/nowrap|min-w-|w-\[/);
    }
    expect(html).not.toMatch(/min-w-\[/);
    // The card buttons ("Start free, pick Pro later" is about 220px at 16px) may wrap: the base button is nowrap, the card overrides it.
    const buttons = [...html.matchAll(/<a class="([^"]*)" href="\/signup">/g)].map((m) => m[1]);
    expect(buttons).toHaveLength(2);
    for (const cls of buttons) expect(cls).toContain('whitespace-normal!');
    // 320px viewport: section px-6 (24px each side) and card p-[30px] (30px each side) leave 212px. The big price is Barlow Condensed
    // 700 at 72px; its advance widths, read from node_modules/@fontsource/barlow-condensed (barlow-condensed-latin-700-normal.woff)
    // with fontTools, are below in em.
    const BARLOW: Record<string, number> = { $: 0.444, '0': 0.453, '1': 0.284, '2': 0.438, '3': 0.436, '4': 0.484, '5': 0.439, '6': 0.44, '7': 0.407, '8': 0.44, '9': 0.435, '.': 0.223 };
    const big = priceSpans.filter((m) => /font-display/.test(m[2] ?? '')).map((m) => m[3]);
    const widest = Math.max(...big.map((p) => [...p].reduce((w, ch) => w + (BARLOW[ch] ?? 0.5) * 72, 0)));
    expect(big).toEqual(['$7.99', '$13.99']);
    expect(widest).toBeLessThan(212);
  });
});
