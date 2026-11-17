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
