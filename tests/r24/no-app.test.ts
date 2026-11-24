// Round 24 (review P1-4, P1-5, P2-6, P2-7; decisions f and g): Holler is a website only. The pages that described an app, store billing
// or push notifications no longer do, in English and Spanish, and the "first 100" offer nothing counted is gone. Real page functions.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

import PricingPage, { metadata as pricingMeta } from '@/app/pricing/page';
import PricingPageEs from '@/app/es/pricing/page';
import DeletePage, { metadata as deleteMeta } from '@/app/delete-account/page';
import TermsPage, { metadata as termsMeta } from '@/app/terms/page';
import PrivacyPage, { metadata as privacyMeta } from '@/app/privacy/page';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';

const BANNED = /iPhone|Android|App Store|Google Play|push notification/i;
const pages: Array<[string, () => string, unknown]> = [
  ['/pricing', () => renderToStaticMarkup(createElement(PricingPage)), pricingMeta],
  ['/es/pricing', () => renderToStaticMarkup(createElement(PricingPageEs)), null],
  ['/delete-account', () => renderToStaticMarkup(createElement(DeletePage)), deleteMeta],
  ['/terms', () => renderToStaticMarkup(createElement(TermsPage)), termsMeta],
  ['/privacy', () => renderToStaticMarkup(createElement(PrivacyPage)), privacyMeta],
];

describe('no app, store or push wording on the five pages', () => {
  it.each(pages)('%s', (_path, render, meta) => {
    const html = render();
    expect(html).not.toMatch(BANNED);
    expect(html).not.toMatch(/Apple or Google|Apple o Google|en la aplicación|in the app\b/i);
    if (meta) expect(JSON.stringify(meta)).not.toMatch(BANNED);
    if (meta) expect(JSON.stringify(meta)).not.toMatch(/in the app/);
  });
});

describe('pricing, both languages', () => {
  const enHtml = renderToStaticMarkup(createElement(PricingPage));
  const esHtml = renderToStaticMarkup(createElement(PricingPageEs));
  it('no "first 100" offer anywhere (nothing counts it), and the prices and the 30-day trial are unchanged', () => {
    for (const h of [enHtml, esHtml]) {
      expect(h).not.toMatch(/first 100|primeros 100|100 members|100 miembros/i);
      for (const p of ['$7.99', '$79.99', '$13.99', '$139.99']) expect(h).toContain(p);
    }
    expect(enHtml).toContain('Add a card now and nothing is charged until your 30-day trial ends.');
    for (const v of Object.values(en)) expect(v).not.toMatch(/first 100/i);
    for (const v of Object.values(es)) expect(v).not.toMatch(/primeros 100/i);
  });
  it('/es/pricing has the card-optional offer and the address lists row, like /pricing (review P2-6)', () => {
    expect(esHtml).toContain('Agregue una tarjeta ahora y no se cobra nada hasta que termine su prueba de 30 días.');
    // Round 24 FIX2 (review P3-9): the row says lists are for the trades that have one, and a note names them.
    expect(esHtml).toContain('Listas de direcciones (oficios que las tienen) y colgante para puertas');
    expect(enHtml).toContain('Address lists (trades that have one) and door hanger');
    expect(enHtml).toContain('Address lists are for siding and gutters, landscaping, house cleaning, lawn care and painting.');
    expect(esHtml).toContain('Las listas de direcciones son para');
  });
  it('no longer says "there is no app" and "buy in the app" on the same page', () => {
    expect(enHtml).not.toContain('A plan you buy in the app');
    expect(esHtml).not.toContain('Un plan que compra en la aplicación');
  });
});
