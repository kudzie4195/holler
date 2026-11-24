// R25 check fix, review R25CHECK P1-3 (option 2: keep the count, change the claim). The sentence now claims three things, and each is
// asserted against what the REAL notify route renders (tests/r25/notify-run.ts captures every digest it builds):
//   1. "{n} records near {zip} would have reached {who} as alerts": the route marks exactly those records notified for this member;
//   2. "Each email lists up to 10": no rendered digest lists more than MAX_ITEMS_IN_DIGEST cards (the route's own constant);
//   3. "the rest are on your matches page": a digest that stands for more than it lists says "Plus {rest} more on your matches page."
// The sentence names no date, so it cannot contradict the "last 30 days" heading under it.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { checkVerdict } from '@/lib/check/verdict';
import { MAX_ITEMS_IN_DIGEST } from '@/lib/email/digest-cap';
import { EXPORT, EXPORT_NOW, HAVE_EXPORT, checkFromExport, exportRows } from '../r25/export-reads';
import { digests, emailedByNotify, scanMatches } from '../r25/notify-run';

const BANNED = /\bleads?\b|guaranteed|you will win|they need you|—|\bsince\b|\bdesde\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|\b(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\b/i;

describe('the counted sentence (EN and ES)', () => {
  const ctx = { tradeLabel: 'Landscaping', zip: '28202' };
  it('many records: the count, the places, and the email cap; no date', () => {
    const t = { count: 91, places: 91, oldest: '2026-11-12T05:00:00Z', atLeast: false };
    expect(checkVerdict('live', t, { ...ctx, lang: 'en' })!.count).toBe(
      'Recently, 91 records near 28202 would have reached a landscaping business as alerts, at 91 different places. Each email lists up to 10; the rest are on your matches page.',
    );
    expect(checkVerdict('live', t, { ...ctx, tradeLabel: 'Jardinería', lang: 'es' })!.count).toBe(
      'Recientemente, 91 registros cerca de 28202 habrían llegado como alertas a un negocio de jardinería, en 91 lugares distintos. Cada correo muestra hasta 10; los demás están en su página de coincidencias.',
    );
    const atLeast = { count: 158, places: 146, oldest: '2026-11-11T06:00:00Z', atLeast: true };
    expect(checkVerdict('live', atLeast, { ...ctx, tradeLabel: 'Lawn care', zip: '78701', lang: 'en' })!.count).toBe(
      'Recently, at least 158 records near 78701 would have reached a lawn care business as alerts, at 146 different places. Each email lists up to 10; the rest are on your matches page.',
    );
    expect(checkVerdict('live', atLeast, { ...ctx, tradeLabel: 'Corte de césped', zip: '78701', lang: 'es' })!.count).toBe(
      'Recientemente, al menos 158 registros cerca de 78701 habrían llegado como alertas a un negocio de corte de césped, en 146 lugares distintos. Cada correo muestra hasta 10; los demás están en su página de coincidencias.',
    );
    const one = { count: 7, places: 1, oldest: '2026-11-17T00:00:00Z', atLeast: false };
    expect(checkVerdict('live', one, { ...ctx, lang: 'en' })!.count).toBe(
      'Recently, 7 records near 28202 would have reached a landscaping business as alerts, all at one place.',
    );
    expect(checkVerdict('live', one, { ...ctx, tradeLabel: 'Jardinería', lang: 'es' })!.count).toBe(
      'Recientemente, 7 registros cerca de 28202 habrían llegado como alertas a un negocio de jardinería, todos en un mismo lugar.',
    );
  });
  it('one record: singular, no cap sentence; a bad or future date changes nothing', () => {
    for (const oldest of ['2026-11-17T00:00:00Z', '2026-12-03T00:00:00Z', 'garbage', null]) {
      const v = checkVerdict('limited', { count: 1, places: 1, oldest, atLeast: false }, { ...ctx, tradeLabel: 'Siding and gutters', zip: '30318', lang: 'en' })!;
      expect(v.count).toBe('Recently, 1 record near 30318 would have reached a siding and gutters business as an alert.');
      const es = checkVerdict('limited', { count: 1, places: 1, oldest, atLeast: false }, { ...ctx, tradeLabel: 'Revestimiento y canaletas', zip: '30318', lang: 'es' })!;
      expect(es.count).toBe('Recientemente, 1 registro cerca de 30318 habría llegado como alerta a un negocio de revestimiento y canaletas.');
    }
    for (const lang of ['en', 'es'] as const) {
      const v = checkVerdict('live', { count: 12, places: 9, oldest: '2026-11-12T05:00:00Z', atLeast: false }, { ...ctx, lang })!;
      expect(`${v.head} ${v.count}`).not.toMatch(BANNED);
    }
  });
  it('the cap in the sentence is the route constant', () => {
    expect(MAX_ITEMS_IN_DIGEST).toBe(10);
  });
});

if (!HAVE_EXPORT) {
  describe('P1-3 claim against the notify route', () => {
    it.skip(`NEEDS the 14-day export at ${EXPORT} (not found, so NOT RUN)`, () => {});
  });
}
describe.skipIf(!HAVE_EXPORT)('P1-3: what the sentence claims is what the notify route renders', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(EXPORT_NOW);
  });
  afterAll(() => vi.useRealTimers());

  const cases: Array<[string, string, string]> = [
    ['78701', 'lawn-care', 'Lawn care'],
    ['28202', 'landscaping', 'Landscaping'],
  ];
  for (const [zip, trade, label] of cases) {
    it(`${zip} ${trade}`, async () => {
      const { member, totals } = checkFromExport(zip, trade);
      const now = EXPORT_NOW;
      const recs = exportRows().filter((r) => {
        const t = Date.parse(r.occurred_at);
        return t <= now.getTime() && t >= now.getTime() - 14 * 86_400_000 && !(r.expires_at && Date.parse(r.expires_at) <= now.getTime());
      });
      const reached = await emailedByNotify(scanMatches(zip, [trade], recs, now), [trade]);
      // 1. the records the sentence counts are the records the route marks notified (reached the member as alerts)
      const counted = new Set(member.filter((i) => i.delivery === 'email').map((i) => i.id));
      expect([...counted].sort()).toEqual([...reached].sort());
      expect(totals.count).toBe(reached.size);
      // 2. each email lists at most the cap, and every listed card is a counted record
      expect(digests.length).toBeGreaterThan(0);
      let listed = 0;
      for (const d of digests) {
        expect(d.cards.length).toBeLessThanOrEqual(MAX_ITEMS_IN_DIGEST);
        for (const id of d.cards) expect(counted.has(id), String(id)).toBe(true);
        listed += d.cards.length;
        // 3. the rest are named in the email as on the matches page
        const rest = d.total - d.cards.length;
        if (rest > 0) expect(d.text).toContain(`Plus ${rest} more on your matches page.`);
        else expect(d.text).not.toContain('more on your matches page');
      }
      expect(listed + digests.reduce((n, d) => n + d.total - d.cards.length, 0)).toBe(reached.size);
      // and the sentence says that, with the same number
      const v = checkVerdict('live', totals, { tradeLabel: label, zip, lang: 'en' })!;
      expect(v.count).toContain(`${totals.atLeast ? 'at least ' : ''}${totals.count} records near ${zip} would have reached`);
      expect(v.count).toContain(`Each email lists up to ${MAX_ITEMS_IN_DIGEST}; the rest are on your matches page.`);
      expect(v.count).not.toMatch(BANNED);
    }, 180_000);
  }
});
