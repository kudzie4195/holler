import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CheckForm } from '@/components/check-form';

// Final verify P2-9: with no people-asking key (the test environment has none) childcare and beauty cannot receive anything,
// so the trade list leaves them out, as onboarding disables them. A trade already in the URL stays selectable.
describe('CheckForm trade list', () => {
  it('omits trades that cannot receive alerts on this deployment, keeps the rest', () => {
    const html = renderToStaticMarkup(createElement(CheckForm));
    expect(html).not.toContain('value="childcare"');
    expect(html).not.toContain('value="beauty"');
    expect(html).toContain('value="roofing"');
  });
  it('keeps a coming-soon trade that arrived in the URL', () => {
    const html = renderToStaticMarkup(createElement(CheckForm, { trade: 'childcare' }));
    expect(html).toContain('value="childcare"');
  });
});

// Build gate 8b: in the ~520px home hero column the trade select shrank to a sliver beside the long button. The layout now follows
// the form's own width (container queries): one column when narrow, ZIP and trade side by side with the button on its own row from
// 24rem, all three in one row only from 48rem. Props and behaviour are unchanged (plain GET form to /check, same fields).
describe('CheckForm layout', () => {
  const html = renderToStaticMarkup(createElement(CheckForm, { idPrefix: 'hero' }));
  it('sizes itself by its container, never a fixed flex row beside the button', () => {
    expect(html).toMatch(/<div class="@container"><form/);
    expect(html).toContain('grid-cols-1');
    expect(html).toContain('@sm:grid-cols-[8rem_minmax(0,1fr)]');
    expect(html).toContain('@3xl:grid-cols-[8rem_minmax(0,1fr)_auto]');
    expect(html).toContain('@sm:col-span-2'); // button gets its own row in the hero-width container
    expect(html).not.toContain('sm:flex-row');
  });
  it('keeps the same form contract', () => {
    expect(html).toContain('action="/check"');
    expect(html).toContain('method="get"');
    expect(html).toContain('name="zip"');
    expect(html).toContain('name="trade"');
    expect(html).toContain('id="hero-zip"');
    expect(html).toContain('type="submit"');
  });
});
