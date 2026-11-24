// Round 24 FIX2 (review D2): sign-up and onboarding/Settings use the coverage answer (lib/check/cells.ts coverageFor with isServedZip).
// A waitlist city gets no trial pitch on /signup; onboarding and Settings show the /check line per picked trade; when every picked trade is
// waitlist a calm notice puts "Join the list" first and "Continue anyway" second. Nothing is refused on the server.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session', () => ({ getUser: async () => null }));

import { profileCoverage } from '@/lib/check/profile-coverage';
import { checkAnswer } from '@/lib/check/answer';
import { tradeLabel } from '@/lib/check/trades';
import { t } from '@/lib/i18n';
import { ProfileForm } from '@/components/profile-form';
import { SignupBody, signupWaitMeta } from '@/components/auth-pages';
import { profileCategories } from '@/lib/plan/profile-categories';

const noop = async () => ({});

function form(zip: string, trades: string[], lang: 'en' | 'es' = 'en', submitLabel = 'Start my free trial') {
  return renderToStaticMarkup(
    createElement(ProfileForm, {
      action: noop as never,
      categories: profileCategories(lang),
      defaults: { business_name: 'Acme', categories: trades, zip, radius: 25, alert_email: true },
      submitLabel,
      lang,
      initialCoverage: profileCoverage(zip, trades, lang),
    }),
  );
}

describe('D2: one coverage answer per picked trade, the same as /check', () => {
  const CASES: Array<[string, string, string, string]> = [
    ['live', '30318', 'landscaping', 'Live'],
    ['limited', '30318', 'cleaning', 'Limited'],
    ['unmeasured', '02108', 'landscaping', 'Not measured'],
    ['storm', '75201', 'roofing', 'Storm alerts'],
    ['waitlist', '75201', 'lawn-care', 'Waitlist'],
  ];
  for (const [answer, zip, trade, tag] of CASES) {
    it(`${answer}: ${zip} ${trade} agrees with the /check answer and prints its line (EN and ES)`, () => {
      const c = profileCoverage(zip, [trade], 'en')!;
      expect(c.lines[0].answer).toBe(answer);
      const chk = checkAnswer(zip, trade)!;
      expect(chk.state).toBe(answer === 'live' ? 'live' : answer === 'waitlist' ? 'waitlist' : 'limited');
      expect(chk.storm).toBe(answer === 'storm');
      expect(chk.measured).toBe(answer !== 'unmeasured');
      const en = form(zip, [trade]);
      expect(en).toContain(`data-answer="${answer}"`);
      expect(en).toContain(`>${tag}<`);
      expect(en).toContain(c.lines[0].text.replace(/'/g, '&#x27;'));
      const es = form(zip, [trade], 'es', 'Empezar');
      expect(es).toContain(`>${t('es', `pf.cov.tag.${answer}` as 'pf.cov.tag.live')}<`);
    });
  }

  it('the lines are the /check sentences: limited, not measured, storm and waitlist use the same dictionary keys', () => {
    // /check words the trade as tradeLabel(trade).toLowerCase() (app/check/page.tsx and components/check-results.tsx).
    expect(profileCoverage('30318', ['cleaning'])!.lines[0].text).toBe(t('en', 'chk.limited', { trade: tradeLabel('cleaning').toLowerCase() }));
    expect(profileCoverage('02108', ['landscaping'])!.lines[0].text).toBe(t('en', 'chk.unmeasured', { trade: 'landscaping', place: 'Boston, MA' }));
    expect(profileCoverage('75201', ['roofing'])!.lines[0].text).toBe(t('en', 'chk.storm', { trade: 'roofing' }));
    expect(profileCoverage('75201', ['lawn-care'])!.lines[0].text).toBe(`${t('en', 'chk.h.trade_wait', { trade: 'lawn care', place: 'Dallas, TX' })}.`);
  });

  it('a member with a live and a waitlist trade: lines for both, no waitlist notice, the normal button', () => {
    expect(checkAnswer('30318', 'painting')!.state).toBe('waitlist');
    const html = form('30318', ['landscaping', 'painting']);
    expect(html).toContain('data-answer="live"');
    expect(html).toContain('data-answer="waitlist"');
    expect(html).not.toContain('Continue anyway');
    expect(html).toContain('Start my free trial');
  });

  it('every picked trade waitlist: a calm notice (info, not an error), "Join the list" first, "Continue anyway" second, no trial button', () => {
    const html = form('75201', ['lawn-care', 'landscaping']);
    // Round 24 FIX3 (review-FIX2 F6): the notice no longer claims there were no records.
    expect(html).toContain('Holler does not offer alerts for lawn care, landscaping near Dallas, TX yet.');
    expect(html).toContain('bg-sky'); // the info tone
    expect(html).not.toMatch(/bg-danger-soft|role="alert"/);
    const join = html.indexOf('Join the list for Dallas, TX');
    const cont = html.indexOf('Continue anyway');
    expect(join).toBeGreaterThan(0);
    expect(cont).toBeGreaterThan(join);
    expect(html).toContain('href="/check?zip=75201&amp;trade=lawn-care"');
    expect(html).not.toContain('Start my free trial');
    // Continue anyway is the form's submit: continuing is allowed.
    expect(html).toMatch(/<button type="submit"[^>]*>Continue anyway<\/button>/);
    const es = form('75201', ['lawn-care'], 'es', 'Empezar mi prueba gratis');
    expect(es).toContain('Unirse a la lista de Dallas, TX');
    expect(es).toContain('Continuar de todos modos');
    expect(es).toContain('href="/es/check?zip=75201&amp;trade=lawn-care"');
    expect(es).not.toContain('Empezar mi prueba gratis');
  });

  it('nothing new is refused on the server: the profile save does not read the coverage answer', () => {
    const src = readFileSync('lib/auth/profile.ts', 'utf8');
    expect(src).not.toMatch(/coverageFor|profileCoverage/);
  });
});

describe('D2: /signup?city=<waitlist city> has no trial pitch; old links still open', () => {
  const render = async (city: string | undefined, lang: 'en' | 'es') =>
    renderToStaticMarkup(await SignupBody({ searchParams: Promise.resolve(city ? { city } : {}), lang }));

  it('Valdosta (waitlist on its city page and on /check) says Holler is not ready and links to the ZIP check, EN and ES', async () => {
    expect(checkAnswer('31601', 'landscaping')!.state).toBe('waitlist');
    const en = await render('valdosta-ga', 'en');
    expect(en).toContain('Holler is not ready in Valdosta, GA yet');
    expect(en).toContain('href="/check"');
    expect(en).not.toMatch(/free trial|no card|\$\d/i);
    const es = await render('valdosta-ga', 'es');
    expect(es).toContain('Holler todavía no está listo en Valdosta, GA');
    expect(es).toContain('href="/es/check"');
    expect(es).not.toMatch(/prueba gratis|sin tarjeta|\$\d/i);
    expect(signupWaitMeta('valdosta-ga', 'en')!.title).toBe('Holler is not ready in Valdosta, GA yet');
  });

  it('a live city and no city keep the trial page as before', async () => {
    expect(await render('atlanta-ga', 'en')).toContain('Alerts for Atlanta, GA and the towns around it. No card needed.');
    expect(await render(undefined, 'en')).toContain('30-day free trial, no card. Takes about a minute.');
    expect(signupWaitMeta('atlanta-ga', 'en')).toBeNull();
    expect(signupWaitMeta(undefined, 'en')).toBeNull();
  });
});
