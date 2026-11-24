// Round 24 FIX3 (review-FIX2 F5, F6). F5: the share preview of a waitlist-city sign-up page (og and twitter title, description and image
// alt) carries no price and no trial wording, EN and ES. F6: the all-waitlist notice says only what is true in every case, and in
// Settings the save button keeps its own label; only onboarding says "Continue anyway".
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session', () => ({ getUser: async () => null }));

import { generateMetadata as enMeta } from '@/app/(auth)/signup/page';
import { generateMetadata as esMeta } from '@/app/es/signup/page';
import { signupWaitMeta } from '@/components/auth-pages';
import { ProfileForm } from '@/components/profile-form';
import { profileCoverage } from '@/lib/check/profile-coverage';
import { profileCategories } from '@/lib/plan/profile-categories';
import { t } from '@/lib/i18n';

const PITCH = /\$\s?\d|free trial|prueba gratis|\btrial\b|\bprueba\b|plans from|planes desde|no card|sin tarjeta|start free|empiece/i;
type Shared = { openGraph?: { title?: unknown; description?: unknown; images?: unknown }; twitter?: { title?: unknown; description?: unknown; images?: unknown; card?: unknown } };
const shareText = (m: Shared) => {
  const og = m.openGraph ?? {};
  const tw = m.twitter ?? {};
  const imgs = (Array.isArray(og.images) ? og.images : og.images ? [og.images] : []) as { alt?: string }[];
  return { og, tw, imgs, all: [og.title, og.description, ...imgs.map((i) => i.alt), tw.title, tw.description].map(String).join(' | ') };
};

describe('F5: share preview of /signup?city=<waitlist city>', () => {
  for (const [lang, meta] of [['en', enMeta], ['es', esMeta]] as const) {
    it(`${lang}: og and twitter are set by the page (nothing inherited from the layout) and carry the waitlist words only`, async () => {
      const wait = signupWaitMeta('valdosta-ga', lang)!;
      const m = (await meta({ params: Promise.resolve({}), searchParams: Promise.resolve({ city: 'valdosta-ga' }) } as never)) as Shared;
      const { og, tw, imgs, all } = shareText(m);
      expect(og.title).toBe(wait.title);
      expect(og.description).toBe(wait.description);
      expect(imgs.length).toBeGreaterThan(0);
      for (const i of imgs) expect(i.alt).toBe(wait.title);
      expect(tw.title).toBe(wait.title);
      expect(tw.description).toBe(wait.description);
      expect(tw.images).toBeTruthy();
      expect(tw.card).toBe('summary_large_image');
      expect(all).not.toMatch(PITCH);
    });
  }
  it('a live city keeps the trial page metadata (the check above is not vacuous)', async () => {
    const m = (await esMeta({ params: Promise.resolve({}), searchParams: Promise.resolve({ city: 'atlanta-ga' }) } as never)) as Shared;
    expect(shareText(m).all).toMatch(PITCH);
  });
});

function form(zip: string, trades: string[], lang: 'en' | 'es', submitLabel: string, inSettings?: boolean) {
  return renderToStaticMarkup(
    createElement(ProfileForm, {
      action: (async () => ({})) as never,
      categories: profileCategories(lang),
      defaults: { business_name: 'Acme', categories: trades, zip, radius: 25, alert_email: true },
      submitLabel,
      lang,
      initialCoverage: profileCoverage(zip, trades, lang),
      ...(inSettings ? { inSettings: true } : {}),
    }),
  );
}
const NOT_TRUE = /no usable records|registros útiles|has had no|no ha tenido/i;

describe('F6: the all-waitlist notice', () => {
  it('the dictionary no longer claims there were no records (EN and ES, onboarding, Settings and the waitlist sign-up page)', () => {
    for (const lang of ['en', 'es'] as const)
      for (const k of ['pf.cov.all_wait', 'pf.cov.all_wait_settings', 'auth.signup.wait_sub'] as const) expect(t(lang, k), `${lang} ${k}`).not.toMatch(NOT_TRUE);
  });
  it('onboarding (Atlanta painting, 90 member records in the export): the notice says Holler does not offer alerts there, and "Continue anyway"', () => {
    const en = form('30318', ['painting'], 'en', 'Start my free trial');
    expect(en).toContain('Holler does not offer alerts for painting near Atlanta, GA yet.');
    expect(en).toMatch(/<button type="submit"[^>]*>Continue anyway<\/button>/);
    const es = form('30318', ['painting'], 'es', 'Empezar mi prueba gratis');
    expect(es).toContain('Holler todavía no ofrece alertas de');
    expect(es).toContain('Continuar de todos modos');
    for (const h of [en, es]) expect(h).not.toMatch(NOT_TRUE);
  });
  it('Settings: the save button keeps its own label, EN and ES; no "Continue anyway"', () => {
    const en = form('30318', ['painting'], 'en', 'Save changes', true);
    expect(en).toContain('Holler does not offer alerts for painting near Atlanta, GA yet.');
    expect(en).toContain('or save your settings as they are.');
    expect(en).toMatch(/<button type="submit"[^>]*>Save changes<\/button>/);
    expect(en).not.toContain('Continue anyway');
    expect(en).not.toMatch(/continue anyway/i);
    const es = form('30318', ['painting'], 'es', 'Guardar cambios', true);
    expect(es).toContain('Holler todavía no ofrece alertas de');
    expect(es).toMatch(/<button type="submit"[^>]*>Guardar cambios<\/button>/);
    expect(es).not.toMatch(/Continuar de todos modos|continúe de todos modos/i);
    for (const h of [en, es]) expect(h).not.toMatch(NOT_TRUE);
  });
  it('both Settings forms pass inSettings; onboarding does not', () => {
    const settings = readFileSync('app/app/settings/page.tsx', 'utf8');
    expect(settings.match(/<ProfileForm\b/g)?.length).toBe(2);
    expect(settings.match(/\binSettings\b/g)?.length).toBe(2);
    expect(readFileSync('components/onboarding-body.tsx', 'utf8')).not.toMatch(/\binSettings\b/);
  });
});
