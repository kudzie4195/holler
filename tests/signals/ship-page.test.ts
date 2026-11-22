/**
 * Round 15 integration (unit I): the real /app page (app/app/page.tsx, merged from five branches) with the real Feed.
 * Mocked: the session, the member's match rows (raw database shape, built from the real parsers via ship-fixtures.ts), the contacts loader,
 * the source-state snapshot (assumed values). Real: the selects' column list, the label and deadline logic, tradeForRecord, jobValue parsing,
 * manager fields, score order, the coverage notice and the card components.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOW, iso } from './brief-fixtures';
import { shipCases } from './ship-fixtures';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '·').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const count = (hay: string, re: RegExp) => (hay.match(re) ?? []).length;

async function renderApp() {
  const cases = await shipCases();
  const pick = (re: RegExp) => cases.find((c) => re.test(c.name))!;
  const chosen = [pick(/registered company/), pick(/Raleigh/), pick(/own-trade permit/), pick(/federal bid/), pick(/hail report/)];
  const selects: string[] = [];
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/auth/session', () => ({
    requireProfile: async () => ({
      user: { id: 'u1' },
      profile: {
        user_id: 'u1', business_name: 'Acme Home Services', categories: ['roofing', 'hvac', 'painting'], zip: '30301', city: 'Atlanta', state: 'GA', lat: 33.75, lon: -84.39,
        radius_mi: 2000, alert_email: true, subscription_status: 'active', trial_ends_at: iso(-86_400_000), plan: 'pro',
        stripe_customer_id: null, stripe_subscription_id: null, email_verified_at: iso(-86_400_000), created_at: iso(-30 * 86_400_000),
      },
    }),
  }));
  const rows = chosen.map((c, i) => {
    const d = (c.signal.data ?? {}) as Record<string, unknown>;
    return {
      id: i + 1, status: 'new', distance_mi: 3, draft: null, created_at: iso(-3_600_000 * (i + 1)),
      signal: {
        id: c.signal.id, source: c.signal.source, kind: c.signal.kind, title: c.signal.title, summary: c.signal.summary ?? null, url: c.signal.url ?? null,
        city: c.signal.city ?? null, state: c.signal.state ?? null, county: null, zip: null, occurred_at: c.signal.occurredAt, expires_at: c.signal.expiresAt ?? null,
        severity: c.signal.severity, categories: c.signal.categories, subtype: (d.subtype as string | undefined) ?? null, approxLocation: null,
        dueDate: (d.dueDate as string | undefined) ?? null, bidBuyer: (d.buyer as string | undefined) ?? null,
        jobValue: d.jobValue === undefined ? null : String(d.jobValue), managerName: (d.managerName as string | undefined) ?? null, managerRole: (d.managerRole as string | undefined) ?? null,
      },
    };
  });
  vi.doMock('@/lib/supabase/server', () => ({
    createClient: async () => {
      const q: any = {};
      q.from = () => q;
      q.select = (cols: string) => {
        selects.push(cols);
        return q;
      };
      for (const m of ['eq', 'order']) q[m] = () => q;
      q.limit = async () => ({ data: rows, error: null });
      return q;
    },
  }));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
  vi.doMock('@/lib/feedback/service', () => ({ loadFeedback: async () => new Map() }));
  vi.doMock('@/lib/outreach/loader', () => ({
    loadMemberContacts: async ({ signalIds }: { signalIds: number[] }) =>
      new Map(chosen.filter((c) => c.contacts?.length && signalIds.includes(c.signal.id)).map((c) => [c.signal.id, c.contacts!.map((k) => ({ ...k, signalId: c.signal.id }))])),
  }));
  vi.doMock('@/lib/signals/source-state-snapshot', () => ({
    loadSourceStateSnapshot: async () => ({
      generatedAt: NOW.toISOString(),
      states: { 'arcgis-atlanta-permits': { state: 'delayed', lastRecordAt: iso(-9 * 3_600_000) }, nws: { state: 'healthy', lastRecordAt: iso(-60_000) } },
    }),
  }));
  vi.doMock('@/app/app/actions', () => ({ setMatchStatus: async () => ({ ok: true }), getRequestReplyStates: async () => ({}), submitFeedback: async () => ({ ok: true }) }));
  vi.doMock('@/components/coming-next-member', () => ({ ComingNextForMember: () => null }));
  vi.doMock('@/components/billing-button', () => ({ BillingButton: () => null }));
  const AppHome = (await import('@/app/app/page')).default;
  const html = renderToStaticMarkup(await AppHome({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never));
  return { html, selects, chosen };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('the real /app page with every branch merged', () => {
  it('reads every additive column in the one matches select (approx location, deadline, value, company) and renders each line once', async () => {
    const { html, selects } = await renderApp();
    const sel = selects.find((s) => s.includes('holler_signals'))!;
    for (const col of ['approxLocation:data->>approxLocation', 'bidBuyer:data->>buyer', 'managerName:data->>managerName', 'jobValue']) expect(sel, col).toContain(col);
    const t = text(html);
    // coverage notice in the header, above the first card
    expect(count(t, /Atlanta permits are delayed; last update 9 hours ago\./g)).toBe(1);
    expect(html.indexOf('data-testid="coverage-notice"')).toBeLessThan(html.indexOf('data-testid="brief"'));
    expect(html.indexOf('Your matches')).toBeLessThan(html.indexOf('data-testid="coverage-notice"'));
    // five cards, five briefs, no duplicated additive line
    expect(count(html, /data-testid="brief"/g)).toBe(5);
    expect(count(t, /Job value on the permit: \$12,500/g)).toBe(1);
    expect(count(t, /Job value on the permit: \$14,500/g)).toBe(1);
    expect(count(t, /(Managed by|Owner company): /g)).toBe(1);
    expect(count(t, /Contractor license number: 75000/g)).toBe(1);
    expect(count(t, /Why it matters:/g)).toBe(5);
    expect(count(t, /Deadline: /g)).toBeGreaterThanOrEqual(1);
  });

  it('order: Act now cards first (label, then score), market insight last', async () => {
    const { html } = await renderApp();
    const iAct = html.indexOf('Act now');
    const iInsight = html.lastIndexOf('Market insight');
    expect(iAct).toBeGreaterThan(-1);
    expect(iAct).toBeLessThan(iInsight);
  });
});
