// Build gate 8c: the large "$9.99" on the plan cards rendered as "$9 . 99" because it used the monospace face (each "." took a
// full digit-wide cell). Prices now use the body font with no monospace or tabular digits.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Pricing } from '@/components/pricing';

describe('Pricing price display', () => {
  const html = renderToStaticMarkup(createElement(Pricing));
  const priceSpans = [...html.matchAll(/<span data-price="[^"]*"( class="([^"]*)")?>([^<]*)<\/span>/g)];
  it('shows every price as one plain string', () => {
    expect(priceSpans.map((m) => m[3])).toEqual(['$5', '$48', '$9.99', '$96']);
  });
  it('no monospace face, tabular digits or wide letter-spacing on a price', () => {
    for (const m of priceSpans) {
      const cls = m[2] ?? '';
      expect(cls).not.toMatch(/font-mono|tabular-nums|tracking-wide|tracking-wider|tracking-widest/);
    }
  });
});
