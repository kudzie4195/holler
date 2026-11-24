// R25 check fix, review R25CHECK P3-7: the footer's "Pressure washing" link opens the check with Pressure washing picked (the composite
// sign-up chip, cleaning AND siding-gutters), not the House cleaning page. The page's handling of a trade with no ZIP is unchanged (it
// keeps the trade and asks for the ZIP with the existing "Enter your ZIP code." line). Sitemap and canonical are not touched.
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {}, after: () => {} }));
vi.mock('server-only', () => ({}));

import CheckPage from '@/app/check/page';
import CheckPageEs from '@/app/es/check/page';
import { FOOTER_TRADES } from '@/components/footer';
import { parseCheckParams } from '@/lib/check/params';

type Props = { searchParams: Promise<Record<string, string>> };
const findAsync = (node: ReactNode): ReactElement<Props> | null => {
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
};
async function render(page: typeof CheckPage | typeof CheckPageEs, sp: Record<string, string>): Promise<string> {
  const tree = page({ searchParams: Promise.resolve(sp) } as never) as ReactElement;
  const check = findAsync(tree);
  const out = check ? await (check.type as (p: Props) => Promise<ReactNode>)(check.props) : null;
  return renderToStaticMarkup(createElement('div', null, out));
}

describe('footer "Pressure washing"', () => {
  it('links the check with Pressure washing picked; House cleaning keeps its own page', () => {
    expect(FOOTER_TRADES.find((l) => l.label === 'Pressure washing')?.href).toBe('/check?trade=pressure-washing');
    expect(FOOTER_TRADES.find((l) => l.label === 'Cleaning')?.href).toBe('/for/cleaning');
    expect(parseCheckParams({ trade: 'pressure-washing' })).toMatchObject({ status: 'invalid', zipError: 'Enter your ZIP code.' });
  });
  it('/check?trade=pressure-washing: the form opens with Pressure washing picked and asks for the ZIP (EN and ES)', async () => {
    const en = await render(CheckPage, { trade: 'pressure-washing' });
    expect(en).toContain('<option value="pressure-washing" selected="">Pressure washing</option>');
    expect(en).toContain('Enter your ZIP code.');
    const es = await render(CheckPageEs, { trade: 'pressure-washing' });
    expect(es).toContain('<option value="pressure-washing" selected="">Lavado a presión</option>');
    expect(es).toContain('Escriba su código postal.');
  });
  it('a bad trade with no ZIP is still an error, and a bad ZIP still is', async () => {
    expect(await render(CheckPage, { trade: 'not-a-trade' })).toContain('aria-invalid="true"');
    expect(await render(CheckPage, { zip: '123', trade: 'pressure-washing' })).toContain('Enter a 5-digit ZIP code, like 30030.');
  });
});
