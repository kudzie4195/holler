// Round 24 (review P2-3, decision i): the waitlist card offers exactly the trades the server accepts for that ZIP, and a refused
// submit says what is wrong. Real ZIP lookup, feed catalogue and cell table; the database and the email are fakes.
import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '@/lib/signals/categories';
import { joinWaitlist } from '@/lib/waitlist/service';
import { waitlistTradeGroups, waitlistTradeIds } from '@/lib/waitlist/trades';
import { WAITLIST, waitlistRefusal } from '@/lib/waitlist/copy';
import { coverageFor } from '@/lib/check/cells';
import { isServedZip } from '@/lib/check/coverage';
import { lookupZip } from '@/lib/geo';
import { en } from '@/lib/i18n/en';
import { fakeWaitlist } from '../waitlist/helpers';

const ZIPS = ['75201', '30318', '02108', '31601', '59001', '90012', '28202', '10001'];

describe('the card list is the server list', () => {
  it.each(ZIPS)('%s: every offered trade is accepted, every refused trade is not offered', async (zip) => {
    const place = lookupZip(zip)!;
    const served = isServedZip(place);
    const offered = new Set(waitlistTradeIds(place, served));
    for (const c of CATEGORIES) {
      const f = fakeWaitlist();
      const r = await joinWaitlist(f.deps, { email: 'pat@example.com', zip, trade: c.id, page: 'check', ip: '203.0.113.9' });
      expect(r.code === 'ok', `${zip} ${c.id}`).toBe(offered.has(c.id));
      if (!offered.has(c.id)) expect(r).toEqual({ code: 'invalid', field: 'trade' });
      // and the list is exactly the waitlist answers
      expect(offered.has(c.id)).toBe(coverageFor(place, c.id, served).state === 'waitlist');
    }
    // groups and ids are the same list
    expect(waitlistTradeGroups(place, served).flatMap((g) => g.options.map((o) => o.id))).toEqual([...offered]);
  });

  it('Dallas 75201: the card no longer offers roofing (storm alerts: limited), and does offer lawn care and plumbing', () => {
    const place = lookupZip('75201')!;
    const ids = waitlistTradeIds(place, isServedZip(place));
    expect(ids).not.toContain('roofing');
    expect(ids).toContain('lawn-care');
    expect(ids).toContain('plumbing');
  });
});

describe('a refused submit says what is wrong', () => {
  it('names the field: trade, ZIP, email; general and other errors keep their lines', () => {
    expect(waitlistRefusal({ ok: false, error: 'invalid', field: 'trade' })).toEqual({ emailError: null, message: WAITLIST.errors.trade });
    expect(waitlistRefusal({ ok: false, error: 'invalid', field: 'zip' })).toEqual({ emailError: null, message: WAITLIST.errors.zip });
    expect(waitlistRefusal({ ok: false, error: 'invalid', field: 'email' })).toEqual({ emailError: WAITLIST.errors.email, message: null });
    expect(waitlistRefusal({ ok: false, error: 'invalid' }).message).toBe(WAITLIST.errors.invalid);
    expect(waitlistRefusal({ ok: false, error: 'limited' }).message).toBe(WAITLIST.errors.limited);
    expect(waitlistRefusal(null).message).toBe(WAITLIST.errors.unavailable);
    expect(waitlistRefusal({ ok: true })).toEqual({ emailError: null, message: null });
    expect(WAITLIST.errors.trade).not.toBe(WAITLIST.errors.invalid);
  });
  it('the card words are the dictionary words (Spanish twins exist)', () => {
    expect(WAITLIST.errors.trade).toBe(en['wl.err.trade']);
    expect(WAITLIST.errors.zip).toBe(en['wl.err.zip']);
  });
});
