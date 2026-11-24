/**
 * Round 24 INT2: the Spanish waitlist. /es/check shows the waitlist card in Spanish and posts lang 'es'; the server then sends the
 * Spanish confirmation with a lang=es link, and the confirm page sends the visitor back to /es/check. English is unchanged: the English
 * card posts no language, and the English email and link are what they were.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { AreaWaitlist } from '@/components/area-waitlist';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';
import { spanishProblems } from '@/lib/i18n/rules';
import { WAITLIST, waitlistRefusal, type WaitlistCardWords } from '@/lib/waitlist/copy';
import { joinWaitlist, type WaitlistDeps } from '@/lib/waitlist/service';
import { waitlistTradeGroups } from '@/lib/waitlist/trades';
import { lookupZip } from '@/lib/geo';

function fake() {
  const sent: Array<Parameters<WaitlistDeps['sendConfirm']>[0]> = [];
  const deps: WaitlistDeps = {
    db: {
      upsert: async () => ({ error: null }),
      find: async () => ({ data: { id: 'row-1', confirmed_at: null, unsubscribed_at: null }, error: null }),
    },
    hit: async () => 'allowed',
    signToken: (id) => `${id}.sig`,
    sendConfirm: async (m) => (sent.push(m), true),
    siteUrl: 'https://localholler.com',
  };
  return { deps, sent };
}

const ES_WORDS: WaitlistCardWords = {
  eyebrow: es['wl.card.eyebrow'],
  heading: es['wl.card.heading'].replace('{place}', 'Billings, MT'),
  intro: es['wl.card.intro'],
  note: es['wl.card.note'],
  emailLabel: es['wl.card.email'],
  tradeLabel: es['wl.card.trade'],
  button: es['wl.card.button'],
  sending: es['wl.card.sending'],
  privacy: es['wl.card.privacy'],
  thanks: es['wl.card.thanks'].replace('{place}', 'Billings, MT'),
  errors: { email: es['wl.err.email'], invalid: es['wl.err.invalid'], trade: es['wl.err.trade'], zip: es['wl.err.zip'], limited: es['wl.err.limited'], unavailable: es['wl.err.unavailable'], network: es['wl.err.network'] },
};

describe('the card words', () => {
  it('English dictionary keys equal the English card literals', () => {
    expect(en['wl.card.eyebrow']).toBe(WAITLIST.eyebrow);
    expect(en['wl.card.heading'].replace('{place}', 'X')).toBe(WAITLIST.heading('X'));
    expect(en['wl.card.intro']).toBe(WAITLIST.intro);
    expect(en['wl.card.note']).toBe(WAITLIST.note);
    expect(en['wl.card.email']).toBe(WAITLIST.emailLabel);
    expect(en['wl.card.trade']).toBe(WAITLIST.tradeLabel);
    expect(en['wl.card.button']).toBe(WAITLIST.button);
    expect(en['wl.card.sending']).toBe(WAITLIST.sending);
    expect(en['wl.card.privacy']).toBe(WAITLIST.privacy);
    expect(en['wl.card.thanks'].replace('{place}', 'X')).toBe(WAITLIST.thanks('X'));
    for (const k of ['email', 'invalid', 'limited', 'unavailable', 'network', 'trade', 'zip'] as const) expect(en[`wl.err.${k}`]).toBe(WAITLIST.errors[k]);
  });

  it('Spanish words pass the Spanish rules and name no price, trial or sign-up', () => {
    const all = Object.values(ES_WORDS).flatMap((v) => (typeof v === 'string' ? [v] : Object.values(v))).join(' ');
    expect(spanishProblems(all)).toEqual([]);
    expect(all).not.toMatch(/\$|prueba|gratis|inglés/i);
    expect(waitlistRefusal({ ok: false, error: 'invalid', field: 'trade' }, ES_WORDS.errors).message).toBe(es['wl.err.trade']);
    expect(waitlistRefusal({ ok: false, error: 'limited' }, ES_WORDS.errors).message).toBe(es['wl.err.limited']);
  });

  it('the Spanish card renders the Spanish words and the Spanish trade names; the English card is unchanged', () => {
    const place = lookupZip('59101')!;
    const html = renderToStaticMarkup(createElement(AreaWaitlist, { zip: '59101', trade: 'roofing', placeLabel: 'Billings, MT', groups: waitlistTradeGroups(place, false, 'es'), words: ES_WORDS }));
    for (const w of [ES_WORDS.heading, ES_WORDS.button, ES_WORDS.emailLabel, ES_WORDS.tradeLabel]) expect(html).toContain(w);
    expect(html).not.toContain(WAITLIST.button.replace("'", '&#x27;'));
    const enHtml = renderToStaticMarkup(createElement(AreaWaitlist, { zip: '59101', trade: 'roofing', placeLabel: 'Billings, MT', groups: waitlistTradeGroups(place, false) }));
    expect(enHtml).toContain('>Your email<');
    expect(enHtml).not.toContain(ES_WORDS.button);
  });
});

describe('the server keeps the language', () => {
  const input = { email: 'pat@example.com', zip: '59101', trade: 'roofing', page: 'check', ip: '203.0.113.9' };
  it("lang 'es': Spanish email and a lang=es confirm link", async () => {
    const f = fake();
    expect(await joinWaitlist(f.deps, { ...input, lang: 'es' })).toEqual({ code: 'ok' });
    expect(f.sent[0].lang).toBe('es');
    expect(f.sent[0].confirmUrl).toBe('https://localholler.com/waitlist/confirm?token=row-1.sig&lang=es');
  });
  it('no lang, or anything but es: the English call, exactly as before', async () => {
    for (const lang of [undefined, 'en', 'fr', 1]) {
      const f = fake();
      expect(await joinWaitlist(f.deps, { ...input, ...(lang === undefined ? {} : { lang }) })).toEqual({ code: 'ok' });
      expect(f.sent[0]).toEqual({ to: 'pat@example.com', confirmUrl: 'https://localholler.com/waitlist/confirm?token=row-1.sig', place: 'Billings, MT', trade: null });
    }
  });
});

describe('the confirm page keeps a Spanish visitor on Spanish pages', () => {
  it('GET ?lang=es is Spanish and its form carries lang; a bad Spanish link points to /es/check', async () => {
    vi.resetModules();
    const route = await import('@/app/waitlist/confirm/route');
    const get = await route.GET(new Request('https://localholler.com/waitlist/confirm?token=abc.def&lang=es')).text();
    expect(get).toContain('<html lang="es">');
    expect(get).toContain('name="lang"');
    const bad = await route.GET(new Request('https://localholler.com/waitlist/confirm?token=bad&lang=es')).text();
    expect(bad).toContain('href="/es/check"');
    expect(bad).not.toContain('inglés');
    const badEn = await route.GET(new Request('https://localholler.com/waitlist/confirm?token=bad')).text();
    expect(badEn).toContain('href="/check"');
  });
});
