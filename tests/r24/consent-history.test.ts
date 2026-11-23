// Round 24 (review P2-4, P2-5; decision h): the statistics consent keeps its history instead of being overwritten, and deleting the account
// withdraws it. Pure functions over app_metadata, as the Settings action and the account deletion use them.
import { describe, expect, it } from 'vitest';
import { STATS_CONSENT_KEY, STATS_CONSENT_VERSION, statsConsentGiven, statsConsentOf, statsConsentPatch } from '@/lib/auth/stats-consent';
import { leaveHollerPatch, rejoinHollerPatch } from '@/lib/auth/membership';

const at = (d: string) => new Date(`${d}T00:00:00.000Z`);
const apply = (meta: Record<string, unknown>, patch: Record<string, unknown> | null) => (patch ? { ...meta, ...patch } : meta);

describe('consent history (review P2-4)', () => {
  it('tick 1 Dec, untick 10 Dec, tick 5 Jan: the record shows the gap, and the new period has its own date and wording', () => {
    let meta: Record<string, unknown> = { products: ['holler'] };
    meta = apply(meta, statsConsentPatch(meta, true, at('2026-12-01')));
    expect(statsConsentOf(meta)).toEqual({ version: STATS_CONSENT_VERSION, at: '2026-12-01T00:00:00.000Z' });
    meta = apply(meta, statsConsentPatch(meta, false, at('2026-12-10')));
    expect(statsConsentGiven(meta)).toBe(false);
    meta = apply(meta, statsConsentPatch(meta, true, at('2027-01-05')));
    expect(statsConsentGiven(meta)).toBe(true);
    expect(statsConsentOf(meta)).toEqual({
      version: STATS_CONSENT_VERSION,
      at: '2027-01-05T00:00:00.000Z',
      history: [{ version: STATS_CONSENT_VERSION, at: '2026-12-01T00:00:00.000Z', revoked_at: '2026-12-10T00:00:00.000Z' }],
    });
    // A second untick and re-tick appends, oldest first; nothing is lost.
    meta = apply(meta, statsConsentPatch(meta, false, at('2027-02-01')));
    expect(statsConsentOf(meta)?.history).toHaveLength(1);
    meta = apply(meta, statsConsentPatch(meta, true, at('2027-03-01')));
    expect(statsConsentOf(meta)?.history?.map((p) => [p.at, p.revoked_at])).toEqual([
      ['2026-12-01T00:00:00.000Z', '2026-12-10T00:00:00.000Z'],
      ['2027-01-05T00:00:00.000Z', '2027-02-01T00:00:00.000Z'],
    ]);
  });
  it('a re-tick after a wording change stamps the new version with the new date, and keeps the old version in history', () => {
    const meta = { [STATS_CONSENT_KEY]: { version: 'v0-old', at: '2026-11-01T00:00:00.000Z', revoked_at: '2026-11-05T00:00:00.000Z' } };
    const next = statsConsentOf(apply(meta, statsConsentPatch(meta, true, at('2026-11-20'))));
    expect(next).toMatchObject({ version: STATS_CONSENT_VERSION, at: '2026-11-20T00:00:00.000Z' });
    expect(next?.history).toEqual([{ version: 'v0-old', at: '2026-11-01T00:00:00.000Z', revoked_at: '2026-11-05T00:00:00.000Z' }]);
  });
  it('a malformed history entry is dropped, a malformed record still reads as no', () => {
    expect(statsConsentOf({ [STATS_CONSENT_KEY]: { version: 'v1', at: 'x', history: [{ at: 1 }, { version: 'v1', at: 'y' }] } })?.history).toEqual([{ version: 'v1', at: 'y' }]);
    expect(statsConsentGiven({ [STATS_CONSENT_KEY]: { at: 'x' } })).toBe(false);
  });
  it('ticking again while on writes nothing; unticking when never answered writes nothing', () => {
    const on = { [STATS_CONSENT_KEY]: { version: STATS_CONSENT_VERSION, at: '2026-12-01T00:00:00.000Z' } };
    expect(statsConsentPatch(on, true, at('2026-12-02'))).toBeNull();
    expect(statsConsentPatch({}, false, at('2026-12-02'))).toBeNull();
  });
});

describe('deleting the account withdraws consent (review P2-5)', () => {
  it('a consenting member who deletes gets revoked_at today; coming back through log-in does not re-consent', () => {
    const meta = { products: ['holler', 'other'], [STATS_CONSENT_KEY]: { version: STATS_CONSENT_VERSION, at: '2026-12-01T00:00:00.000Z' } };
    const left = apply(meta, leaveHollerPatch(meta, at('2026-12-20')));
    expect(statsConsentGiven(left)).toBe(false);
    expect(statsConsentOf(left)).toEqual({ version: STATS_CONSENT_VERSION, at: '2026-12-01T00:00:00.000Z', revoked_at: '2026-12-20T00:00:00.000Z' });
    const back = apply(left, rejoinHollerPatch(left));
    expect(statsConsentGiven(back)).toBe(false);
    // Ticking the box again later starts a new period and keeps the deleted one in history.
    const again = statsConsentOf(apply(back, statsConsentPatch(back, true, at('2027-01-10'))));
    expect(again?.history?.[0].revoked_at).toBe('2026-12-20T00:00:00.000Z');
  });
  it('a member who never consented, or already withdrew, gets no consent key in the patch', () => {
    expect(leaveHollerPatch({ products: ['holler'] }, at('2026-12-20'))).not.toHaveProperty(STATS_CONSENT_KEY);
    const off = { products: ['holler'], [STATS_CONSENT_KEY]: { version: 'v1', at: '2026-12-01T00:00:00.000Z', revoked_at: '2026-12-02T00:00:00.000Z' } };
    expect(leaveHollerPatch(off, at('2026-12-20'))).not.toHaveProperty(STATS_CONSENT_KEY);
  });
});
