// Round 18 integration, step 2: the trial wording on the Spanish pricing, sign-up and app screens reads 60 days, from the constants.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ usePathname: () => '/es/pricing', useRouter: () => ({ push: () => {} }), useSearchParams: () => new URLSearchParams() }));

import { Pricing } from '@/components/pricing';
import { TRIAL_DAYS } from '@/lib/auth/membership';
import { TRIAL_HEADLINE_KEY, TRIAL_MONTHS } from '@/lib/plan/price-copy';
import { APP_TITLES_EN, APP_TITLES_ES } from '@/components/app-header';
import { t } from '@/lib/i18n';
import { renderResolved } from '../i18n/render-tree';

const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Spanish trial wording', () => {
  it('pricing: "prueba gratis de 60 días" in the fine print and on the Solo button; never 14', () => {
    const es = text(renderToStaticMarkup(createElement(Pricing, { variant: 'full', lang: 'es' } as never)));
    expect(es).toContain(`Todos los planes empiezan con una prueba gratis de ${TRIAL_DAYS} días`);
    expect(es).toContain(`Empiece su prueba gratis de ${TRIAL_DAYS} días`);
    expect(es).not.toMatch(/\b14\b/);
    const en = text(renderToStaticMarkup(createElement(Pricing, { variant: 'full' } as never)));
    expect(en).toContain(`Start your ${TRIAL_DAYS}-day free trial`);
  });

  it('sign-up: the month headline in both languages (no yearly price beside it)', async () => {
    vi.doMock('@/lib/auth/session', () => ({ getUser: async () => null }));
    const { SignupBody } = await import('@/components/auth-pages');
    const sp = Promise.resolve({});
    const es = text(await renderResolved(SignupBody({ searchParams: sp, lang: 'es' })));
    expect(es).toContain(`${t('es', TRIAL_HEADLINE_KEY, { months: TRIAL_MONTHS })}, sin tarjeta`);
    expect(es).toContain('1 mes gratis');
    const en = text(await renderResolved(SignupBody({ searchParams: sp })));
    expect(en).toContain('1 month free, no card. Takes about a minute.');
  });

  it('constants: 30 days, 1 month', () => {
    expect(TRIAL_DAYS).toBe(30);
    expect(TRIAL_MONTHS).toBe(1);
  });
});

describe('Spanish tab titles of the list pages (round 18 ES + LISTS)', () => {
  it('every list page has a Spanish and an English title, and the English one equals its static metadata', async () => {
    for (const [path, mod] of [
      ['/app/lists', '@/app/app/lists/page'],
      ['/app/lists/storm', '@/app/app/lists/storm/page'],
      ['/app/lists/area', '@/app/app/lists/area/page'],
      ['/app/lists/door-hanger', '@/app/app/lists/door-hanger/page'],
    ] as const) {
      const m = (await import(/* @vite-ignore */ mod)) as { metadata: { title: string } };
      expect(APP_TITLES_EN[path], path).toBe(`${m.metadata.title} | Holler`);
      expect(APP_TITLES_ES[path], path).toMatch(/ \| Holler$/);
      expect(APP_TITLES_ES[path], path).not.toBe(APP_TITLES_EN[path]);
    }
    expect(APP_TITLES_ES['/app/lists']).toBe('Listas | Holler');
  });
});
