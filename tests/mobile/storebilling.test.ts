// Store billing: product id mapping (Play suffix included), the RevenueCat event table, the trimmed ledger copy, the shared-secret
// check, and the webhook route (auth, 503, always 200 after auth, 500 on a database failure, every event type, TRANSFER for both users).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_STORE_PRODUCT_IDS, STORE_PRODUCT_IDS } from '@/lib/plan/public-prices';
import { normalizeProductId, planForStoreProduct, storeFromRevenueCat } from '@/lib/storebilling/products';
import { msToIso, planEvent, secretMatches, trimRaw } from '@/lib/storebilling/revenuecat';
import { STORE_PRODUCTS } from '@/lib/mobile/types';
import { fakeDb, UA, UB, type FakeDb } from './fakes';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('product id -> plan', () => {
  it('maps every product we sell', () => {
    expect(planForStoreProduct('com.localholler.app.solo.monthly')).toBe('starter');
    expect(planForStoreProduct('com.localholler.app.solo.yearly')).toBe('starter');
    expect(planForStoreProduct('com.localholler.app.pro.monthly')).toBe('pro');
    expect(planForStoreProduct('com.localholler.app.pro.yearly')).toBe('pro');
  });
  it("strips Google Play's :basePlanId suffix", () => {
    expect(planForStoreProduct('com.localholler.app.pro.yearly:annual-autorenew')).toBe('pro');
    expect(planForStoreProduct('com.localholler.app.solo.monthly:monthly')).toBe('starter');
    expect(normalizeProductId('com.localholler.app.pro.yearly:annual')).toBe('com.localholler.app.pro.yearly');
  });
  it('never guesses: other apps, look-alikes and junk are null', () => {
    for (const id of ['com.other.app.pro.monthly', 'com.localholler.app.premium.monthly', 'com.localholler.app.promo', 'com.localholler.apppro.x', '', null, 42, ':pro.']) {
      expect(planForStoreProduct(id), String(id)).toBeNull();
    }
  });
  it('the contract file, the public price list and the mapping agree', () => {
    expect(STORE_PRODUCTS.solo.monthly).toBe(STORE_PRODUCT_IDS.solo.monthly);
    expect(STORE_PRODUCTS.solo.yearly).toBe(STORE_PRODUCT_IDS.solo.annual);
    expect(STORE_PRODUCTS.pro.monthly).toBe(STORE_PRODUCT_IDS.pro.monthly);
    expect(STORE_PRODUCTS.pro.yearly).toBe(STORE_PRODUCT_IDS.pro.annual);
    for (const id of ALL_STORE_PRODUCT_IDS) expect(planForStoreProduct(id)).toBe(id.includes('.pro.') ? 'pro' : 'starter');
  });
  it('the migration applies the same rule (prefix, then .pro. / .solo., suffix stripped)', () => {
    const sql = readFileSync('supabase/migrations/0020_holler_mobile.sql', 'utf8');
    expect(sql).toContain("split_part(coalesce(p_product_id, ''), ':', 1)");
    expect(sql).toContain("not like 'com.localholler.app.%' then null");
    expect(sql).toContain("like '%.pro.%' then 'pro'");
    expect(sql).toContain("like '%.solo.%' then 'starter'");
  });
  it('stores', () => {
    expect(storeFromRevenueCat('APP_STORE')).toBe('apple');
    expect(storeFromRevenueCat('MAC_APP_STORE')).toBe('apple');
    expect(storeFromRevenueCat('PLAY_STORE')).toBe('google');
    for (const s of ['STRIPE', 'PROMOTIONAL', 'AMAZON', '', undefined]) expect(storeFromRevenueCat(s)).toBeNull();
  });
});

describe('secretMatches (constant time)', () => {
  it('exact match only', () => {
    expect(secretMatches('s3cret-value', 's3cret-value')).toBe(true);
    expect(secretMatches('s3cret-valuE', 's3cret-value')).toBe(false);
    expect(secretMatches('Bearer s3cret-value', 's3cret-value')).toBe(false);
    expect(secretMatches('', 's3cret-value')).toBe(false);
    expect(secretMatches(null, 's3cret-value')).toBe(false);
    expect(secretMatches('', '')).toBe(false);
    expect(secretMatches('anything', undefined)).toBe(false);
  });
});

const ev = (over: Record<string, unknown>) => ({
  api_version: '1.0',
  event: {
    id: 'evt-1',
    type: 'INITIAL_PURCHASE',
    app_user_id: UA,
    product_id: 'com.localholler.app.solo.monthly',
    store: 'APP_STORE',
    environment: 'PRODUCTION',
    expiration_at_ms: Date.parse('2026-12-19T00:00:00Z'),
    event_timestamp_ms: Date.parse('2026-11-19T00:00:00Z'),
    ...over,
  },
});

describe('planEvent', () => {
  it('one call per ordinary event, with the database arguments', () => {
    const p = planEvent(ev({}));
    expect(p.ignored).toBeUndefined();
    expect(p.calls).toEqual([
      { eventId: 'evt-1', userId: UA, type: 'INITIAL_PURCHASE', store: 'apple', env: 'production', productId: 'com.localholler.app.solo.monthly', expiresAt: '2026-12-19T00:00:00.000Z', eventTs: '2026-11-19T00:00:00.000Z' },
    ]);
  });
  it('every event type reaches the database with its own type (the database decides grant, revoke or record)', () => {
    for (const t of ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE', 'NON_RENEWING_PURCHASE', 'EXPIRATION', 'SUBSCRIPTION_PAUSED', 'CANCELLATION', 'BILLING_ISSUE', 'SUBSCRIBER_ALIAS', 'SOMETHING_NEW']) {
      const p = planEvent(ev({ type: t }));
      expect(p.calls.map((c) => c.type), t).toEqual([t]);
    }
  });
  it('PRODUCT_CHANGE uses new_product_id; Play suffix removed', () => {
    const p = planEvent(ev({ type: 'PRODUCT_CHANGE', store: 'PLAY_STORE', product_id: 'com.localholler.app.solo.monthly:m', new_product_id: 'com.localholler.app.pro.yearly:annual' }));
    expect(p.calls[0]).toMatchObject({ productId: 'com.localholler.app.pro.yearly', store: 'google' });
  });
  it('sandbox events reach the database with their env (the database applies the sandbox rule)', () => {
    expect(planEvent(ev({ environment: 'SANDBOX' })).calls[0].env).toBe('sandbox');
  });
  it('TEST is ignored', () => {
    expect(planEvent(ev({ type: 'TEST', app_user_id: 'anything', store: 'APP_STORE' }))).toEqual({ calls: [], ignored: 'test' });
  });
  it('a non-UUID app_user_id (anonymous RevenueCat id) is ignored', () => {
    for (const id of ['$RCAnonymousID:abc', 'user-1', '', null, `{${UA}}`]) expect(planEvent(ev({ app_user_id: id })).ignored, String(id)).toBe('not_a_user');
  });
  it('a store we do not sell in is ignored', () => {
    expect(planEvent(ev({ store: 'PROMOTIONAL' })).ignored).toBe('unsupported_store');
    expect(planEvent(ev({ store: 'STRIPE' })).ignored).toBe('unsupported_store');
  });
  it("another app's product (same RevenueCat or store account) is ignored before the database", () => {
    expect(planEvent(ev({ product_id: 'com.tiretrackpro.app.pro.monthly' })).ignored).toBe('not_our_product');
    expect(planEvent(ev({ type: 'EXPIRATION', product_id: 'com.other.app.solo.yearly:base' })).ignored).toBe('not_our_product');
    expect(planEvent(ev({ type: 'SUBSCRIBER_ALIAS', product_id: undefined })).calls).toHaveLength(1);
  });
  it('no event or no id', () => {
    expect(planEvent({}).ignored).toBe('no_event');
    expect(planEvent(null).ignored).toBe('no_event');
    expect(planEvent(ev({ id: '' })).ignored).toBe('no_event_id');
  });
  it('TRANSFER: TRANSFER_TO for each new id (naming the old ids) first, then TRANSFER_FROM for each old id, suffixed with a hash of the id, non-UUIDs dropped', () => {
    const p = planEvent(ev({ type: 'TRANSFER', app_user_id: undefined, transferred_from: [UA, '$RCAnonymousID:x'], transferred_to: [UB] }));
    // Changed for review r2 (T11): the suffix is the SHA-256 of the user id, not the raw id.
    // Changed in round 7 fix-g2 (verify-v2 P1): TRANSFER_TO goes first and carries the old owners, so the database can move a live plan.
    expect(p.calls.map((c) => [c.type, c.userId, c.eventId, c.fromUserIds])).toEqual([
      ['TRANSFER_TO', UB, `evt-1:to:${sha(UB)}`, [UA]],
      ['TRANSFER_FROM', UA, `evt-1:from:${sha(UA)}`, undefined],
    ]);
    expect(planEvent(ev({ type: 'TRANSFER', transferred_from: ['$RCAnonymousID:x'], transferred_to: [] })).ignored).toBe('not_a_user');
  });
  it('a missing event timestamp falls back to now; bad ms are null', () => {
    const now = new Date('2026-11-19T05:00:00Z');
    expect(planEvent(ev({ event_timestamp_ms: undefined }), now).calls[0].eventTs).toBe(now.toISOString());
    expect(msToIso('abc')).toBeNull();
    expect(msToIso(-1)).toBeNull();
    expect(msToIso(Number.MAX_VALUE)).toBeNull();
  });
});

describe('trimRaw keeps no personal fields', () => {
  it('drops subscriber attributes, aliases, app user ids, country and transaction ids', () => {
    const body = ev({
      subscriber_attributes: { $email: { value: 'a@b.test' }, $displayName: { value: 'Jo' } },
      aliases: ['$RCAnonymousID:x'],
      original_app_user_id: UA,
      country_code: 'US',
      transaction_id: '2000000123',
      original_transaction_id: '2000000001',
      price: 7.99,
      currency: 'USD',
      entitlement_ids: ['solo'],
    });
    const raw = trimRaw(body);
    const s = JSON.stringify(raw);
    for (const bad of ['a@b.test', 'Jo', UA, 'RCAnonymous', '2000000123', 'country_code', 'aliases']) expect(s).not.toContain(bad);
    expect(raw).toMatchObject({ api_version: '1.0', event: { id: 'evt-1', type: 'INITIAL_PURCHASE', price: 7.99, currency: 'USD', entitlement_ids: ['solo'] } });
  });
});

describe('POST /api/revenuecat/webhook', () => {
  let db: FakeDb;
  let rpcResult: (args: Record<string, unknown>) => { data?: unknown; error?: unknown };
  beforeEach(() => {
    vi.resetModules();
    rpcResult = () => ({ data: 'applied' });
    db = fakeDb(
      (q) => (q.table === 'holler_profiles' ? { data: [{ store_product_id: 'com.localholler.app.pro.monthly', plan_source: 'apple' }] } : { data: null }),
      (_n, a) => rpcResult(a),
    );
    vi.doMock('server-only', () => ({}));
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));
  });
  afterEach(() => vi.unstubAllEnvs());
  const SECRET = 'rc-webhook-secret-0123456789abcdef';
  const post = async (body: unknown, auth: string | null = SECRET) => {
    const { POST } = await import('../../app/api/revenuecat/webhook/route');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (auth !== null) headers.authorization = auth;
    return POST(new Request('https://localholler.test/api/revenuecat/webhook', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));
  };

  it('503 when the secret is not set (nothing read)', async () => {
    vi.stubEnv('REVENUECAT_WEBHOOK_SECRET', '');
    const res = await post(ev({}));
    expect(res.status).toBe(503);
    expect(db.rpcs).toEqual([]);
  });
  it('401 for a missing, wrong, prefixed or case-changed header', async () => {
    vi.stubEnv('REVENUECAT_WEBHOOK_SECRET', SECRET);
    for (const a of [null, '', 'wrong', `Bearer ${SECRET}`, SECRET.toUpperCase(), `${SECRET}x`, SECRET.slice(0, -1)]) {
      const res = await post(ev({}), a);
      expect(res.status, String(a)).toBe(401);
    }
    expect(db.rpcs).toEqual([]);
  });
  it('after auth: bad JSON, TEST, anonymous ids and other stores are 200 ignored, nothing written', async () => {
    vi.stubEnv('REVENUECAT_WEBHOOK_SECRET', SECRET);
    for (const [body, why] of [['{not json', 'bad_json'], [ev({ type: 'TEST' }), 'test'], [ev({ app_user_id: '$RCAnonymousID:1' }), 'not_a_user'], [ev({ store: 'PROMOTIONAL' }), 'unsupported_store'], [ev({ product_id: 'com.tiretrackpro.app.pro.monthly' }), 'not_our_product'], [{}, 'no_event']] as const) {
      const res = await post(body);
      expect(res.status).toBe(200);
      expect((await res.json()).ignored).toBe(why);
    }
    expect(db.rpcs).toEqual([]);
  });
  it('applies through holler_apply_store_event with trimmed raw; sandbox too', async () => {
    vi.stubEnv('REVENUECAT_WEBHOOK_SECRET', SECRET);
    const res = await post(ev({ environment: 'SANDBOX', subscriber_attributes: { $email: { value: 'x@y.test' } } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, results: [{ userId: UA, result: 'applied' }] });
    expect(db.rpcs).toHaveLength(1);
    expect(db.rpcs[0].name).toBe('holler_apply_store_event');
    expect(db.rpcs[0].args).toMatchObject({ p_event_id: 'evt-1', p_user_id: UA, p_type: 'INITIAL_PURCHASE', p_store: 'apple', p_env: 'sandbox', p_product_id: 'com.localholler.app.solo.monthly' });
    expect(JSON.stringify(db.rpcs[0].args.p_raw)).not.toContain('x@y.test');
  });
  it('every database answer (duplicate, stale, other_store, no_profile, recorded) is a 200', async () => {
    vi.stubEnv('REVENUECAT_WEBHOOK_SECRET', SECRET);
    for (const r of ['duplicate', 'stale', 'other_store', 'no_profile', 'recorded', 'not_owner', 'unknown_product']) {
      rpcResult = () => ({ data: r });
      const res = await post(ev({}));
      expect(res.status, r).toBe(200);
      expect((await res.json()).results[0].result).toBe(r);
    }
  });
  it('a database failure is a 500 so RevenueCat retries', async () => {
    vi.stubEnv('REVENUECAT_WEBHOOK_SECRET', SECRET);
    rpcResult = () => ({ error: { code: '57P01', message: 'terminating connection' } });
    const res = await post(ev({}));
    expect(res.status).toBe(500);
  });
  it('TRANSFER calls the function for both users, new owner first with the old owners named; the route copies nothing itself (review r2 F1, changed in round 7 fix-g2)', async () => {
    vi.stubEnv('REVENUECAT_WEBHOOK_SECRET', SECRET);
    const res = await post(ev({ type: 'TRANSFER', product_id: undefined, expiration_at_ms: undefined, transferred_from: [UA], transferred_to: [UB] }));
    expect(res.status).toBe(200);
    expect(db.rpcs.map((r) => [r.args.p_type, r.args.p_user_id, r.args.p_event_id, r.args.p_product_id, r.args.p_expires_at, r.args.p_from_user_ids])).toEqual([
      ['TRANSFER_TO', UB, `evt-1:to:${sha(UB)}`, null, null, [UA]],
      ['TRANSFER_FROM', UA, `evt-1:from:${sha(UA)}`, null, null, null],
    ]);
  });
  it('fix-g2 sandbox switch: p_allow_sandbox is true only when REVENUECAT_ALLOW_SANDBOX is exactly 1', async () => {
    vi.stubEnv('REVENUECAT_WEBHOOK_SECRET', SECRET);
    for (const [v, want] of [[undefined, false], ['', false], ['0', false], ['true', false], ['yes', false], ['1', true], [' 1 ', true]] as const) {
      if (v === undefined) vi.stubEnv('REVENUECAT_ALLOW_SANDBOX', undefined as unknown as string);
      else vi.stubEnv('REVENUECAT_ALLOW_SANDBOX', v);
      db.rpcs.length = 0;
      await post(ev({ environment: 'SANDBOX' }));
      expect(db.rpcs[0].args.p_allow_sandbox, String(v)).toBe(want);
    }
  });
});
