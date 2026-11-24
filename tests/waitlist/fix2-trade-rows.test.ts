// Round 24 FIX2 (review D8): the waitlist keeps one row per (email, ZIP, trade) after migration 0039, and before it a second trade for the
// same email and ZIP is never confirmed under a trade that was not stored.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { joinWaitlist } from '@/lib/waitlist/service';
import { renderWaitlistAlready } from '@/lib/email/templates';
import { fakeWaitlist } from './helpers';
import { bootDb, hasPglite } from '../moat/pg';

// Dallas 75201: lawn care and landscaping are both waitlist there (served ZIP, so the email names the trade).
const base = { email: 'pat@example.com', zip: '75201', page: 'check', ip: '203.0.113.9' };

describe('before 0039 (unique on email and ZIP only)', () => {
  it('a second trade for the same email and ZIP: nothing new stored, no confirmation naming it, an email saying what is stored', async () => {
    const f = fakeWaitlist();
    expect(await joinWaitlist(f.deps, { ...base, trade: 'lawn-care' })).toEqual({ code: 'ok' });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].trade).toBe('lawn-care');
    expect(await joinWaitlist(f.deps, { ...base, trade: 'landscaping' })).toEqual({ code: 'ok' });
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0].trade).toBe('lawn-care');
    expect(f.sent).toHaveLength(1); // no confirmation that names landscaping
    expect(f.already).toHaveLength(1);
    expect(f.already[0]).toMatchObject({ storedTrade: 'lawn-care', newTrade: 'landscaping', place: 'Dallas, TX' });
    expect(f.already[0].confirmUrl).toMatch(/\/waitlist\/confirm\?token=/); // the stored row is not confirmed yet
  });
  it('the same trade again is unchanged: no second email', async () => {
    const f = fakeWaitlist();
    await joinWaitlist(f.deps, { ...base, trade: 'lawn-care' });
    await joinWaitlist(f.deps, { ...base, trade: 'lawn-care' });
    expect(f.sent).toHaveLength(2); // unconfirmed: the confirmation is sent again, as before round 24 FIX2
    expect(f.already).toHaveLength(0);
  });
  it('the email says the address is already on the list for the ZIP and does not claim the new trade, EN and ES', () => {
    const en = renderWaitlistAlready({ place: 'Dallas, TX', storedTrade: 'lawn-care', newTrade: 'landscaping', confirmUrl: null });
    expect(en.subject).toBe('You are already on the Holler list for Dallas, TX');
    expect(en.text).toContain('already on the list for Dallas, TX, for lawn care');
    expect(en.text).toContain('so landscaping was not added');
    expect(en.text).not.toMatch(/automatic/i);
    const es = renderWaitlistAlready({ place: 'Dallas, TX', storedTrade: 'lawn-care', newTrade: 'landscaping', confirmUrl: 'https://x/c', lang: 'es' });
    expect(es.subject).toBe('Usted ya está en la lista de Holler para Dallas, TX');
    expect(es.text).toContain('https://x/c');
  });
});

describe('0039 applied, the old (email, zip) index not yet dropped by hand', () => {
  it('a second trade conflicts on the old index (23505): handled as before 0039, no confirmation naming it', async () => {
    const f = fakeWaitlist({ bothIndexes: true });
    await joinWaitlist(f.deps, { ...base, trade: 'lawn-care' });
    expect(await joinWaitlist(f.deps, { ...base, trade: 'landscaping' })).toEqual({ code: 'ok' });
    expect(f.rows.map((r) => r.trade)).toEqual(['lawn-care']);
    expect(f.sent.map((s) => s.trade)).toEqual(['lawn-care']);
    expect(f.already).toHaveLength(1);
  });
});

describe('after 0039 and the hand drop of the old index (unique on email, ZIP and trade only)', () => {
  it('a second trade is its own row with its own confirmation naming it', async () => {
    const f = fakeWaitlist({ uniqueTrade: true });
    await joinWaitlist(f.deps, { ...base, trade: 'lawn-care' });
    await joinWaitlist(f.deps, { ...base, trade: 'landscaping' });
    expect(f.rows.map((r) => r.trade)).toEqual(['lawn-care', 'landscaping']);
    expect(f.sent.map((s) => s.trade)).toEqual(['lawn-care', 'landscaping']);
    expect(f.writes.every((w) => (w.opts as { onConflict: string }).onConflict === 'email,zip,trade')).toBe(true);
    expect(f.already).toHaveLength(0);
  });
});

const pgCase = (name: string, fn: () => Promise<void>) => (hasPglite ? it(name, fn, 60_000) : it.skip(`NEEDS PGlite (not installed, so NOT RUN): ${name}`, fn));
describe('migration 0039 on PGlite, on top of 0001..0038', () => {
  pgCase('0039 runs twice; with the old index still there a second trade is a 23505; after the hand drop it is its own row; null trades stay one per email and ZIP', async () => {
    const db = await bootDb('0038_zzz');
    const ins = (trade: string | null, conflict: string) =>
      db.query(`insert into holler_zip_waitlist (email, zip, trade, consent_version) values ('a@b.co', '75201', $1, 'v1') on conflict (${conflict}) do nothing`, [trade]);
    await ins('lawn-care', 'email, zip');
    await expect(ins('lawn-care', 'email, zip, trade')).rejects.toThrow(/no unique or exclusion constraint/);
    const sql = fs.readFileSync('supabase/migrations/0039_holler_zip_waitlist_trade.sql', 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    await ins('lawn-care', 'email, zip, trade'); // a repeat of the same trade: ignored
    await expect(ins('landscaping', 'email, zip, trade')).rejects.toThrow(/duplicate key|unique/);
    // The owner's hand step (LAUNCH.md NEEDS KUDZI, round 24 FIX2 step 8).
    await db.exec('drop index if exists public.holler_zip_waitlist_email_zip_idx;');
    await ins('landscaping', 'email, zip, trade');
    await ins('landscaping', 'email, zip, trade');
    await ins(null, 'email, zip, trade');
    await ins(null, 'email, zip, trade');
    const n = (await db.query(`select trade from holler_zip_waitlist order by 1 nulls last`)).rows.map((r: { trade: string | null }) => r.trade);
    expect(n).toEqual(['landscaping', 'lawn-care', null]);
  });
});
