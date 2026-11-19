// recordSignup, the check step and the paid invoice step, with request data and the database faked.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const SID = 'AbCdEfGhIjKlMnOpQrStUv';
const USER = '0b1f4a3e-8d1c-4d0e-9a55-2f6c1d2e3a4b';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const state = vi.hoisted(() => ({
  cookies: {} as Record<string, string>,
  headers: {} as Record<string, string>,
  events: [] as Record<string, unknown>[],
  attrib: [] as { row: Record<string, unknown>; opts: unknown }[],
  missing: false,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n in state.cookies ? { value: state.cookies[n] } : undefined) }),
  headers: async () => ({ get: (n: string) => state.headers[n.toLowerCase()] ?? null }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (t: string) => {
      if (t === 'holler_events') return { insert: async (row: Record<string, unknown>) => (state.missing ? { error: { code: '42P01' } } : (state.events.push(row), { error: null })) };
      if (t === 'holler_attribution') return { upsert: async (row: Record<string, unknown>, opts: unknown) => (state.attrib.push({ row, opts }), { error: null }) };
      throw new Error('unexpected table ' + t);
    },
  }),
}));

afterEach(() => {
  state.cookies = {};
  state.headers = { 'user-agent': CHROME };
  state.events = [];
  state.attrib = [];
  state.missing = false;
});
state.headers = { 'user-agent': CHROME };

describe('recordSignup', () => {
  it('writes signup and trial_start with the cookie attribution, and the attribution row once', async () => {
    state.cookies = { holler_sid: `${SID}.20411`, holler_src: 'instagram.social.fall-storm' };
    const { recordSignup } = await import('@/lib/analytics/request');
    await recordSignup(USER);
    expect(state.events.map((e) => e.name)).toEqual(['signup', 'trial_start']);
    for (const e of state.events) {
      expect(e).toMatchObject({ user_id: USER, session_id: SID, source: 'instagram', medium: 'social', campaign: 'fall-storm', path: null });
    }
    expect(state.attrib).toHaveLength(1);
    expect(state.attrib[0].row).toEqual({ user_id: USER, source: 'instagram', medium: 'social', campaign: 'fall-storm' });
    // first touch: a later insert for the same member does nothing
    expect(state.attrib[0].opts).toEqual({ onConflict: 'user_id', ignoreDuplicates: true });
  });
  it('with no cookies: events without a source, no attribution row', async () => {
    const { recordSignup } = await import('@/lib/analytics/request');
    await recordSignup(USER);
    expect(state.events).toHaveLength(2);
    expect(state.events[0]).toMatchObject({ user_id: USER, session_id: null, source: null });
    expect(state.attrib).toHaveLength(0);
  });
  it('with a privacy signal: account events still recorded, cookies ignored, no attribution', async () => {
    state.cookies = { holler_sid: `${SID}.1`, holler_src: 'x.social.' };
    state.headers = { 'user-agent': CHROME, 'sec-gpc': '1' };
    const { recordSignup } = await import('@/lib/analytics/request');
    await recordSignup(USER);
    expect(state.events).toHaveLength(2);
    expect(state.events[0]).toMatchObject({ session_id: null, source: null });
    expect(state.attrib).toHaveLength(0);
  });
  it('never throws when the table is missing', async () => {
    state.missing = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { recordSignup } = await import('@/lib/analytics/request');
    await expect(recordSignup(USER)).resolves.toBeUndefined();
  });
  it('inserted rows carry no IP or user agent keys', async () => {
    state.cookies = { holler_sid: `${SID}.1` };
    state.headers = { 'user-agent': CHROME, 'x-forwarded-for': '203.0.113.7' };
    const { recordSignup } = await import('@/lib/analytics/request');
    await recordSignup(USER);
    for (const e of state.events) expect(Object.keys(e).sort()).toEqual(['campaign', 'medium', 'name', 'path', 'session_id', 'source', 'user_id']);
    expect(JSON.stringify(state.events)).not.toMatch(/203\.0\.113|Mozilla/);
  });
});

describe('area_check step', () => {
  it('records path /check only, with the session, never a ZIP or trade', async () => {
    state.cookies = { holler_sid: `${SID}.1` };
    const { eventContext, trackVisitorStep } = await import('@/lib/analytics/request');
    await trackVisitorStep('area_check', await eventContext(), '/check');
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({ name: 'area_check', session_id: SID, user_id: null, path: '/check' });
  });
  it('is skipped for GPC, DNT and bots', async () => {
    const { eventContext, trackVisitorStep } = await import('@/lib/analytics/request');
    state.headers = { 'user-agent': CHROME, dnt: '1' };
    await trackVisitorStep('area_check', await eventContext(), '/check');
    state.headers = { 'user-agent': CHROME, 'sec-gpc': '1' };
    await trackVisitorStep('area_check', await eventContext(), '/check');
    state.headers = { 'user-agent': 'Googlebot/2.1' };
    await trackVisitorStep('area_check', await eventContext(), '/check');
    expect(state.events).toHaveLength(0);
  });
});

describe('paid invoice', () => {
  const admin = (user: string | null) =>
    ({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: user ? { user_id: user } : null }) }) }) }),
    }) as never;
  it('records paid for a paid invoice, using the subscription metadata', async () => {
    const { trackPaidInvoice } = await import('@/lib/analytics/stripe');
    await trackPaidInvoice(admin(null), { amount_paid: 799, subscription_details: { metadata: { app: 'holler', user_id: USER } } });
    expect(state.events).toEqual([{ name: 'paid', session_id: null, user_id: USER, source: null, medium: null, campaign: null, path: null }]);
  });
  it('falls back to the customer id lookup', async () => {
    const { trackPaidInvoice } = await import('@/lib/analytics/stripe');
    await trackPaidInvoice(admin(USER), { amount_paid: 1399, customer: 'cus_1' });
    expect(state.events).toHaveLength(1);
    expect(state.events[0].user_id).toBe(USER);
  });
  it('ignores the zero-dollar trial invoice, another product, and an unknown customer', async () => {
    const { trackPaidInvoice } = await import('@/lib/analytics/stripe');
    await trackPaidInvoice(admin(USER), { amount_paid: 0, customer: 'cus_1' });
    await trackPaidInvoice(admin(USER), { amount_paid: 500, subscription_details: { metadata: { app: 'other', user_id: USER } } });
    await trackPaidInvoice(admin(null), { amount_paid: 500, customer: 'cus_zzz' });
    await trackPaidInvoice(admin(null), {} as never);
    expect(state.events).toHaveLength(0);
  });
  it('never throws', async () => {
    const { trackPaidInvoice } = await import('@/lib/analytics/stripe');
    const bad = { from: () => { throw new Error('x'); } };
    await expect(trackPaidInvoice(bad as never, { amount_paid: 5, customer: 'c' })).resolves.toBeUndefined();
  });
});
