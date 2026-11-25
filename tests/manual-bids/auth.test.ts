import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string; app_metadata?: Record<string, unknown> },
  profile: null as null | { email_verified_at: string | null },
  adminClient: vi.fn(() => {
    throw new Error('service-role client must not be created');
  }),
}));

vi.mock('@/lib/auth/session', () => ({
  getUser: async () => h.user,
  getProfile: async () => h.profile,
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.adminClient }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import { ownerDecision, ownerGate } from '@/lib/signals/manual-bids/owner';
import { addManualBidAction, csvAction } from '@/app/app/owner/bids/actions';

const OWNER_EMAIL = 'owner@example.com';
const VERIFIED = '2026-11-01T00:00:00Z';

beforeEach(() => {
  vi.stubEnv('HOLLER_MANUAL_BIDS_ENABLED', '1');
  vi.stubEnv('HOLLER_BIDS_ENABLED', '1');
  vi.stubEnv('ADMIN_EMAIL', OWNER_EMAIL);
  h.user = { id: 'u1', email: OWNER_EMAIL, app_metadata: {} };
  h.profile = { email_verified_at: VERIFIED };
  h.adminClient.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

function quickForm(): FormData {
  const f = new FormData();
  f.set('url', 'https://mariettaga.gov/Bids.aspx?bidID=412');
  f.set('title', 'Roof replacement at Fire Station 3');
  f.set('agency', 'City of Marietta');
  f.set('dueDate', '2099-01-01');
  f.set('place', '30060');
  return f;
}

function csvForm(intent: 'preview' | 'import'): FormData {
  const f = new FormData();
  f.set('intent', intent);
  f.set('format', 'generic');
  f.set('csv', 'title,agency,due_date,url,zip\nRoof repair,City of Marietta,2099-01-01,https://x.gov/1,30060\n');
  return f;
}

describe('ownerDecision', () => {
  const ok = { flagOn: true, adminEmail: OWNER_EMAIL, userEmail: OWNER_EMAIL, verifiedAt: VERIFIED, signedIn: true };
  it('only the verified ADMIN_EMAIL account, only with the switch on', () => {
    expect(ownerDecision(ok)).toBe('ok');
    expect(ownerDecision({ ...ok, userEmail: ' OWNER@Example.com ' })).toBe('ok');
    expect(ownerDecision({ ...ok, flagOn: false })).toBe('off');
    expect(ownerDecision({ ...ok, signedIn: false })).toBe('signed_out');
    expect(ownerDecision({ ...ok, userEmail: 'member@example.com' })).toBe('not_owner');
    expect(ownerDecision({ ...ok, verifiedAt: null })).toBe('not_owner');
    expect(ownerDecision({ ...ok, adminEmail: '' })).toBe('not_owner');
    expect(ownerDecision({ ...ok, adminEmail: undefined, userEmail: undefined })).toBe('not_owner');
  });
});

describe('ownerGate (server side)', () => {
  it('passes the verified owner, including a verification parked in app_metadata before onboarding', async () => {
    expect(await ownerGate()).toEqual({ ok: true, userId: 'u1' });
    h.profile = null;
    h.user = { id: 'u1', email: OWNER_EMAIL, app_metadata: { holler_email_verified_at: VERIFIED } };
    expect(await ownerGate()).toEqual({ ok: true, userId: 'u1' });
  });

  it('refuses a member, an unverified owner address, a signed-out visitor, and everyone while the switch is off', async () => {
    h.user = { id: 'u2', email: 'member@example.com', app_metadata: {} };
    expect(await ownerGate()).toEqual({ ok: false, reason: 'not_owner' });
    h.user = { id: 'u3', email: OWNER_EMAIL, app_metadata: {} };
    h.profile = { email_verified_at: null };
    expect(await ownerGate()).toEqual({ ok: false, reason: 'not_owner' });
    h.user = null;
    expect(await ownerGate()).toEqual({ ok: false, reason: 'signed_out' });
    h.user = { id: 'u1', email: OWNER_EMAIL, app_metadata: {} };
    h.profile = { email_verified_at: VERIFIED };
    vi.stubEnv('HOLLER_MANUAL_BIDS_ENABLED', '');
    expect(await ownerGate()).toEqual({ ok: false, reason: 'off' });
  });
});

describe('server actions refuse a non-owner before any database client exists', () => {
  it.each([
    ['a member', () => { h.user = { id: 'u2', email: 'member@example.com', app_metadata: {} }; }],
    ['a signed-out visitor', () => { h.user = null; }],
    ['the owner with the switch off', () => { vi.stubEnv('HOLLER_MANUAL_BIDS_ENABLED', '0'); }],
  ])('%s', async (_who, setup) => {
    setup();
    expect(await addManualBidAction(null, quickForm())).toMatchObject({ ok: false, error: 'Not found.' });
    expect(await csvAction(null, csvForm('preview'))).toEqual({ step: 'preview', result: { ok: false, error: 'not_found' } });
    expect(await csvAction(null, csvForm('import'))).toEqual({ step: 'import', result: { ok: false, error: 'not_found' } });
    expect(h.adminClient).not.toHaveBeenCalled();
  });
});

describe('owner pages answer 404 to anyone but the owner', () => {
  it('quick add, import and check list pages', async () => {
    h.user = { id: 'u2', email: 'member@example.com', app_metadata: {} };
    const pages = [
      (await import('@/app/app/owner/bids/page')).default,
      (await import('@/app/app/owner/bids/import/page')).default,
      (await import('@/app/app/owner/bids/checklist/page')).default,
    ];
    for (const P of pages) await expect(P()).rejects.toThrow('NEXT_NOT_FOUND');
    h.user = { id: 'u1', email: OWNER_EMAIL, app_metadata: {} };
    // The owner gets each page, rendered on the server without error (forms, nav, check list with no stored ticks).
    const html = await Promise.all(pages.map(async (P) => renderToStaticMarkup(await P())));
    expect(html[0]).toContain('Add a bid by hand');
    expect(html[0]).toContain('name="url"');
    expect(html[1]).toContain('Import bids from a CSV file');
    expect(html[1]).toContain('Texas ESBD');
    expect(html[2]).toContain('0 of 28 checked this week.');
    expect(html[2]).toContain('https://mariettaga.gov/Bids.aspx');
    expect(html.join('')).not.toContain('\u2014');
  });
});
