/**
 * Round 24 INT2: the two fix branches together (r24-fix-site caf0888 + r24-fix-mail e3f8fde).
 *
 * The site branch made "coming soon" trades waitlist everywhere and reworded the generic waitlist words; the mail branch sends a
 * trade-level waitlist confirmation for a served ZIP and a quiet-week email built from the site's coverage answer. Together:
 *   - a coming-soon trade in a served ZIP gets a confirmation that says sign-ups are not open (not "none of the records were this work");
 *   - an unserved place keeps the round 19 subject ("reaches {place}") and no launch wording;
 *   - a member whose only trades are coming soon gets the waitlist line in the quiet-week email, in English and Spanish.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { coverageFor, signupClosedTrades, tradeSignupClosed } from '@/lib/check/cells';
import { isServedZip } from '@/lib/check/coverage';
import { lookupZip } from '@/lib/geo';
import { digestCoverage } from '@/lib/email/coverage';
import { renderDigest, renderWaitlistConfirm, type Rendered } from '@/lib/email/templates';
import { spanishProblems } from '@/lib/i18n/rules';

const NOW = new Date('2026-11-23T14:00:00Z');
const words = (m: Rendered) => `${m.subject}\n${m.html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')}\n${m.text}`;
const URL = 'https://localholler.com/waitlist/confirm?token=a.b';

describe('the waitlist confirmation with both branches', () => {
  it('a coming-soon trade in a served ZIP: sign-ups are not open, EN and ES, and no claim about the records', () => {
    expect(tradeSignupClosed('plumbing')).toBe(true);
    const place = lookupZip('75201')!;
    expect(isServedZip(place)).toBe(true);
    expect(coverageFor(place, 'plumbing', true)).toMatchObject({ state: 'waitlist', closed: true });
    const m = renderWaitlistConfirm({ confirmUrl: URL, place: 'Dallas, TX', trade: 'plumbing' });
    expect(m.subject).toBe('Confirm: tell me when Holler has plumbing work near Dallas, TX');
    expect(m.text).toContain('Holler already reads public records there, but it is not taking sign-ups for plumbing yet.');
    expect(words(m)).not.toMatch(/none of them|launch|\$\d|free trial|\/signup/i);
    const e = renderWaitlistConfirm({ confirmUrl: URL, place: 'Dallas, TX', trade: 'plumbing', lang: 'es' });
    expect(e.text).toContain('todavía no acepta inscripciones para plomería');
    expect(spanishProblems(e.subject + e.text)).toEqual([]);
    expect(words(e)).not.toMatch(/ninguno ha sido|\$\d|prueba gratis|\/signup/i);
  });

  it('a trade that is open but has nothing here keeps the mail branch words', () => {
    const m = renderWaitlistConfirm({ confirmUrl: URL, place: 'Dallas, TX', trade: 'lawn-care' });
    expect(m.text).toContain('lately none of them has been lawn care work');
  });

  it('an unserved place: the round 19 subject, the site branch body, no launch wording, EN and ES', () => {
    const m = renderWaitlistConfirm({ confirmUrl: URL, place: 'Billings, MT' });
    expect(m.subject).toBe('Confirm: tell me when Holler reaches Billings, MT');
    expect(m.text).toContain('we will send you one email when it does. Nothing else.');
    expect(words(m)).not.toMatch(/launch/i);
    const e = renderWaitlistConfirm({ confirmUrl: URL, place: 'Billings, MT', lang: 'es' });
    expect(e.subject).toBe('Confirme: avísenme cuando Holler llegue a Billings, MT');
    expect(spanishProblems(e.subject + e.text)).toEqual([]);
  });
});

describe('the quiet-week email for a member whose only trades are coming soon', () => {
  const atlanta = { lat: 33.7756, lon: -84.4196, state: 'GA' };
  for (const trades of [['plumbing'], ['plumbing', 'hvac']]) {
    it(`${trades.join(' + ')} in Atlanta: the waitlist line, EN and ES`, () => {
      for (const t of trades) expect(signupClosedTrades()).toContain(t);
      const cov = digestCoverage({ categories: trades, ...atlanta, plan: null, subscription_status: 'trialing' }, () => true);
      expect(cov).toEqual({ state: 'waitlist', trades });
      const en = renderDigest({ businessName: 'Acme', items: [], totalCount: 0, appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: NOW, lang: 'en', coverage: cov, matchedLastWeek: 0 });
      const w = words(en);
      expect(w).toContain(trades.length === 1 ? 'lately none of them has been work for plumbing' : 'lately none of them has been work for plumbing and');
      expect(w).toContain('You can add another trade in Settings');
      expect(w).not.toContain('Quiet weeks happen');
      expect(w).not.toMatch(/\$\d|free trial|\/signup|\bleads?\b/i);
      const es = renderDigest({ businessName: 'Acme', items: [], totalCount: 0, appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: NOW, lang: 'es', coverage: cov, matchedLastWeek: 0 });
      expect(words(es)).toContain('ninguno ha sido trabajo de plomería');
      expect(spanishProblems(es.text)).toEqual([]);
    });
  }
});
