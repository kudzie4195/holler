import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string; app_metadata?: Record<string, unknown> },
  adminClient: vi.fn(() => {
    throw new Error('service-role client must not be created');
  }),
}));

vi.mock('@/lib/auth/session', () => ({
  getUser: async () => h.user,
  getProfile: async () => ({ email_verified_at: '2026-01-01T00:00:00Z' }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.adminClient }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import { ownerGate } from '@/lib/signals/manual-bids/owner';
import { configuredOwnerId, ownerDecision, ownerPathAllowed } from '@/lib/signals/manual-bids/owner-id';
import { addManualBidAction, csvAction } from '@/app/app/owner/bids/actions';

const OWNER_ID = '6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab';
const MEMBER_ID = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  vi.stubEnv('HOLLER_MANUAL_BIDS_ENABLED', '1');
  vi.stubEnv('HOLLER_BIDS_ENABLED', '1');
  vi.stubEnv('HOLLER_OWNER_USER_ID', OWNER_ID);
  // The support inbox address is NOT the owner check (review P1-1): an account holding it gets nothing.
  vi.stubEnv('ADMIN_EMAIL', 'support@example.com');
  h.user = { id: OWNER_ID, email: 'kudzi@example.com', app_metadata: {} };
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

describe('owner = the account named by HOLLER_OWNER_USER_ID (a UUID), never an e-mail', () => {
  it('match, mismatch, empty, malformed, signed out, switch off', () => {
    const ok = { flagOn: true, ownerId: OWNER_ID, userId: OWNER_ID };
    expect(ownerDecision(ok)).toBe('ok');
    expect(ownerDecision({ ...ok, ownerId: ` ${OWNER_ID.toUpperCase()} ` })).toBe('ok');
    expect(ownerDecision({ ...ok, userId: MEMBER_ID })).toBe('not_owner');
    expect(ownerDecision({ ...ok, ownerId: '' })).toBe('not_owner');
    expect(ownerDecision({ ...ok, ownerId: undefined })).toBe('not_owner');
    expect(ownerDecision({ ...ok, ownerId: 'support@example.com', userId: 'support@example.com' })).toBe('not_owner');
    expect(ownerDecision({ ...ok, ownerId: '6f1c2d3e4a5b4c6d8e7f0123456789ab', userId: '6f1c2d3e4a5b4c6d8e7f0123456789ab' })).toBe('not_owner');
    expect(ownerDecision({ ...ok, ownerId: `${OWNER_ID}x`, userId: `${OWNER_ID}x` })).toBe('not_owner');
    expect(ownerDecision({ ...ok, userId: null })).toBe('signed_out');
    expect(ownerDecision({ ...ok, flagOn: false })).toBe('off');
    expect(configuredOwnerId('not-a-uuid')).toBeNull();
    expect(configuredOwnerId(OWNER_ID.toUpperCase())).toBe(OWNER_ID);
  });

  it('ownerGate passes only the configured id; the support-inbox account, an empty or malformed id, and switch-off refuse', async () => {
    expect(await ownerGate()).toEqual({ ok: true, userId: OWNER_ID });
    h.user = { id: MEMBER_ID, email: 'support@example.com', app_metadata: { holler_email_verified_at: '2026-01-01T00:00:00Z' } };
    expect(await ownerGate()).toEqual({ ok: false, reason: 'not_owner' });
    h.user = { id: OWNER_ID, email: 'kudzi@example.com', app_metadata: {} };
    vi.stubEnv('HOLLER_OWNER_USER_ID', '');
    expect(await ownerGate()).toEqual({ ok: false, reason: 'not_owner' });
    vi.stubEnv('HOLLER_OWNER_USER_ID', 'kudzi@example.com');
    expect(await ownerGate()).toEqual({ ok: false, reason: 'not_owner' });
    vi.stubEnv('HOLLER_OWNER_USER_ID', OWNER_ID);
    h.user = null;
    expect(await ownerGate()).toEqual({ ok: false, reason: 'signed_out' });
    h.user = { id: OWNER_ID, app_metadata: {} };
    vi.stubEnv('HOLLER_MANUAL_BIDS_ENABLED', '');
    expect(await ownerGate()).toEqual({ ok: false, reason: 'off' });
  });

  it('the proxy rule reads the same switch and id', () => {
    expect(ownerPathAllowed(OWNER_ID)).toBe(true);
    expect(ownerPathAllowed(MEMBER_ID)).toBe(false);
    expect(ownerPathAllowed(null)).toBe(false);
    vi.stubEnv('HOLLER_MANUAL_BIDS_ENABLED', '0');
    expect(ownerPathAllowed(OWNER_ID)).toBe(false);
  });
});

describe('server actions refuse a non-owner before any database client exists', () => {
  it.each([
    ['a member', () => { h.user = { id: MEMBER_ID, email: 'member@example.com', app_metadata: {} }; }],
    ['the support-inbox account', () => { h.user = { id: MEMBER_ID, email: 'support@example.com', app_metadata: {} }; }],
    ['a signed-out visitor', () => { h.user = null; }],
    ['the owner with the switch off', () => { vi.stubEnv('HOLLER_MANUAL_BIDS_ENABLED', '0'); }],
    ['the owner with no owner id configured', () => { vi.stubEnv('HOLLER_OWNER_USER_ID', ''); }],
  ])('%s', async (_who, setup) => {
    setup();
    expect(await addManualBidAction(null, quickForm())).toMatchObject({ ok: false, error: 'Not found.' });
    expect(await csvAction(null, csvForm('preview'))).toEqual({ step: 'preview', result: { ok: false, error: 'not_found' } });
    expect(await csvAction(null, csvForm('import'))).toEqual({ step: 'import', result: { ok: false, error: 'not_found' } });
    expect(h.adminClient).not.toHaveBeenCalled();
  });
});

describe('owner pages', () => {
  it('call notFound for anyone but the owner, and render for the owner', async () => {
    h.user = { id: MEMBER_ID, email: 'member@example.com', app_metadata: {} };
    const pages = [
      (await import('@/app/app/owner/bids/page')).default,
      (await import('@/app/app/owner/bids/import/page')).default,
      (await import('@/app/app/owner/bids/checklist/page')).default,
    ];
    for (const P of pages) await expect(P()).rejects.toThrow('NEXT_NOT_FOUND');
    h.user = { id: OWNER_ID, app_metadata: {} };
    const html = await Promise.all(pages.map(async (P) => renderToStaticMarkup(await P())));
    expect(html[0]).toContain('Add a bid by hand');
    expect(html[0]).toContain('name="url"');
    expect(html[1]).toContain('Import bids from a CSV file');
    expect(html[1]).toContain('Texas ESBD');
    expect(html[2]).toContain('0 of 24 checked this week.');
    expect(html[2]).toContain('https://mariettaga.gov/Bids.aspx');
    expect(html[2]).toContain('Hand-check only, do not enter (terms ban commercial use).');
    expect(html[2]).toContain('URL wrong, find the real page');
    expect(html[2]).not.toContain('lawrenceburgtn.gov');
    expect(html[2]).toContain('Outside the served area');
    expect(html.join('')).not.toContain('\u2014');
  });
});
