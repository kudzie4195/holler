// Round 9 C4: the home page ZIP form sends /check?zip=NNNNN with no trade. The page treats a known ZIP as a step: the form comes back
// with the ZIP filled in and a neutral "Now pick your trade." line, with no error text, no role="alert" and no aria-invalid. A bad or
// unknown ZIP still shows its error. The noindex rule for every ?zip= variant is unchanged.
import { describe, expect, it, vi } from 'vitest';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {} }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/analytics/request', () => ({ eventContext: async () => null, trackVisitorStep: async () => {} }));
vi.mock('@/lib/check/load', () => ({ loadCheck: async () => ({ ok: false, items: [], checkedAt: new Date(0).toISOString() }) }));
vi.mock('@/components/top-nav', () => ({ TopNav: () => null }));
vi.mock('@/components/footer', () => ({ Footer: () => null }));

import CheckPage, { generateMetadata } from '@/app/check/page';

type Sp = Record<string, string>;
type Props = { searchParams: Promise<Sp> };

/** The page wraps an async <Check> in Suspense. Find that element, run it, and render its output (what streams in). */
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
  if (typeof node.type === 'function' && !props.children) {
    return findAsync((node.type as (p: unknown) => ReactNode)(node.props));
  }
  return findAsync(props.children);
}

async function render(sp: Sp) {
  const page = CheckPage({ searchParams: Promise.resolve(sp) } as never) as ReactElement;
  const shell = renderToStaticMarkup(page);
  const check = findAsync(page);
  if (!check) throw new Error('no async Check element found');
  const out = await (check.type as (p: Props) => Promise<ReactNode>)(check.props);
  return { shell, html: renderToStaticMarkup(createElement('div', null, out)) };
}

describe('/check?zip= with no trade (the home page ZIP form)', () => {
  it('shows the form with the ZIP filled in and a neutral prompt, with no error of any kind', async () => {
    const { html } = await render({ zip: '60614' });
    expect(html).toContain('action="/check"');
    expect(html).toMatch(/name="zip"[^>]*value="60614"|value="60614"[^>]*name="zip"/);
    expect(html).toContain('Now pick your trade.');
    expect(html).toContain('ZIP 60614');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('aria-invalid');
    expect(html).not.toMatch(/Pick what you do|Enter your ZIP|5-digit|could not find/);
    // The prompt is tied to the form for screen readers, and the trade select is still the required next step.
    expect(html).toContain('aria-describedby="check-prompt"');
    expect(html).toContain('name="trade"');
  });

  it('a ZIP with letters still shows the ZIP error, and no prompt', async () => {
    const { html } = await render({ zip: 'abc' });
    expect(html).toContain('Enter a 5-digit ZIP code, like 30030.');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('Now pick your trade.');
  });

  it('a well-formed ZIP that does not exist gets the not-found error, not the prompt', async () => {
    const { html } = await render({ zip: '00000' });
    expect(html).toContain('We could not find that ZIP code. Check it and try again.');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('Now pick your trade.');
  });

  it('an unknown trade with a good ZIP is still an error', async () => {
    const { html } = await render({ zip: '60614', trade: 'astronaut' });
    expect(html).toContain('Pick a trade from the list.');
    expect(html).not.toContain('Now pick your trade.');
  });

  it('the page shell has one h1, outside the streamed part, so the title never waits for the check', async () => {
    const { shell } = await render({ zip: '60614' });
    expect(shell.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(shell).toContain('See what happened near you.');
  });

  it('keeps the noindex rule for every ?zip= variant and the canonical', async () => {
    const meta = async (sp: Sp) => generateMetadata({ searchParams: Promise.resolve(sp) } as never);
    expect((await meta({ zip: '60614' })).robots).toEqual({ index: false, follow: true });
    expect((await meta({})).robots).toEqual({ index: true, follow: true });
    // r17 ES: the canonical is unchanged; the hreflang pair (en, es, x-default) is new.
    expect((await meta({ zip: '60614' })).alternates).toEqual({ canonical: '/check', languages: { en: '/check', es: '/es/check', 'x-default': '/check' } });
  });
});
