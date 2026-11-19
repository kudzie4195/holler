// Build gate 8c: a large price with cents on the plan cards rendered as "9 . 99" because it used the monospace face (each "." took
// a full digit-wide cell). Prices now use the body font with no monospace or tabular digits.
// Round 7: prices got longer ($13.99, $139.99). The price row must wrap on a 320px phone instead of overflowing the card.
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
    const rows = [...html.matchAll(/<p class="([^"]*)"><span data-price="[^"]*" class="text-5xl/g)].map((m) => m[1]);
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
    // 320px viewport: section px-5 (20px each side) and card p-6 (24px each side) leave 232px. text-5xl is 48px; a digit or "$" in
    // the body face is at most 0.62em and "." about 0.3em, so the widest big price is bounded below.
    const big = priceSpans.filter((m) => /text-5xl/.test(m[2] ?? '')).map((m) => m[3]);
    const widest = Math.max(...big.map((p) => [...p].reduce((w, ch) => w + (ch === '.' ? 0.3 : 0.62) * 48, 0)));
    expect(big).toEqual(['$7.99', '$13.99']);
    expect(widest).toBeLessThan(232);
  });
});
