// /check: the "Coming to your area" card shows for a ZIP Holler does not serve, and never for one it does.
import { describe, expect, it, vi } from 'vitest';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {}, after: () => {} }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.5' }) }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/analytics/request', () => ({ eventContext: async () => null, trackVisitorStep: async () => {} }));
vi.mock('@/lib/auth/ratelimit', () => ({ hit: async () => 'allowed', clientIp: () => '203.0.113.5' }));
const loadCheck = vi.fn(async () => ({ ok: true, items: [], checkedAt: new Date(0).toISOString() }));
vi.mock('@/lib/check/load', () => ({ loadCheck: (...a: unknown[]) => loadCheck(...(a as [])) }));
vi.mock('@/lib/signals/source-state-snapshot', () => ({ loadSourceStateSnapshot: async () => null }));
vi.mock('@/components/top-nav', () => ({ TopNav: () => null }));
vi.mock('@/components/footer', () => ({ Footer: () => null }));

import CheckPage from '@/app/check/page';

type Sp = Record<string, string>;
type Props = { searchParams: Promise<Sp> };

function findAsync(node: ReactNode): ReactElement<Props> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findAsync(n);
      if (f) return f;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as { searchParams?: unknown; children?: ReactNode };
  if (props.searchParams && typeof node.type === 'function') return node as ReactElement<Props>;
  if (typeof node.type === 'function' && !props.children) return findAsync((node.type as (p: unknown) => ReactNode)(node.props));
  return findAsync(props.children);
}

async function render(sp: Sp) {
  const page = CheckPage({ searchParams: Promise.resolve(sp) } as never) as ReactElement;
  const check = findAsync(page);
  if (!check) throw new Error('no async Check element found');
  const out = await (check.type as (p: Props) => Promise<ReactNode>)(check.props);
  const html = renderToStaticMarkup(createElement('div', null, out));
  return { html, text: html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, ' ') };
}

describe('uncovered ZIP shows the card', () => {
  it('59001 + roofing: heading, intro, email field, trade preselected, ZIP, button, honeypot', async () => {
    const { html, text } = await render({ zip: '59001', trade: 'roofing' });
    expect(text).toContain("Holler isn't covering Absarokee, MT yet.");
    expect(text).toContain("Leave your email and we'll tell you when it does.");
    expect(text).toContain('Coming to your area');
    expect(html).toContain('name="email"');
    expect(html).toMatch(/<option value="roofing" selected(="")?>/);
    expect(text).toContain('ZIP 59001');
    expect(text).toContain("Tell me when it's covered");
    expect(html).toContain('name="leave_blank"');
    expect(html).toContain('aria-hidden="true"');
  });
  it('the card sits under the check form and IS the whole answer: no "Holler is watching" block and no trial offer', async () => {
    const { html, text } = await render({ zip: '59001', trade: 'roofing' });
    expect(html).toContain('action="/check"');
    expect(html.indexOf('Coming to your area')).toBeGreaterThan(html.indexOf('action="/check"'));
    // Round 23: a waitlist cell shows no results block at all. The page used to carry the waitlist card AND
    // "Holler is watching near Absarokee, MT" AND "Get these by email. 60-day free trial, no card" together.
    expect(html).not.toContain('id="check-heading"');
    expect(text).not.toContain('Holler is watching near');
    expect(text).not.toMatch(/free trial, no card/);
    expect(html).not.toMatch(/href="\/signup/);
  });
  it('a territory (San Juan, 00901) shows the card, reads no records, and does not also print the old "does not cover" heading', async () => {
    loadCheck.mockClear();
    const { text } = await render({ zip: '00901', trade: 'roofing' });
    expect(text).toContain("Holler isn't covering San Juan, PR yet.");
    expect(text).not.toContain('Holler does not cover');
    expect(loadCheck).not.toHaveBeenCalled();
  });
  it('picks up the trade from the check for any trade', async () => {
    const { html } = await render({ zip: '82001', trade: 'hvac' });
    expect(html).toMatch(/<option value="hvac" selected(="")?>/);
  });
});

describe('covered ZIP never shows it', () => {
  for (const zip of ['60614', '30339', '10001']) {
    it(`${zip} + roofing: no card, no waitlist field`, async () => {
      const { html, text } = await render({ zip, trade: 'roofing' });
      expect(text).not.toContain('Coming to your area');
      expect(text).not.toContain("isn't covering");
      expect(html).not.toContain('name="leave_blank"');
      expect(html).not.toContain('waitlist-email');
    });
  }
  it('a ZIP with no trade yet (the home page step) and an empty form never show it', async () => {
    for (const sp of [{} as Sp, { zip: '59001' }, { zip: '60614' }]) {
      const { text } = await render(sp);
      expect(text).not.toContain('Coming to your area');
    }
  });
});
