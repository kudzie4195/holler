/**
 * Round 17, unit ES: the rendered Spanish surfaces (digest html and text, web cards, outreach notes, draft fallback, coverage line, area
 * check) are scanned with the Spanish wording rules, and the English output is shown to be the English output.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/app/actions', () => ({ setMatchStatus: async () => ({ ok: true }), getRequestReplyStates: async () => ({}), submitFeedback: async () => ({ ok: true }) }));
vi.mock('server-only', () => ({}));

import { Feed, LockedFeed } from '@/components/feed';
import { renderDigest } from '@/lib/email/templates';
import { NOTE_KINDS, renderNote } from '@/lib/outreach/templates';
import { fallbackDraft, violatesDraftRules } from '@/lib/ai/fallback';
import { coverageNotice } from '@/lib/check/coverage-notice';
import { spanishProblems } from '@/lib/i18n/rules';
import { localizeTitle } from '@/lib/signals/title-i18n';
import { es } from '@/lib/i18n/es';
import { en } from '@/lib/i18n/en';
import { allBriefStringsLang } from '@/lib/signals/brief-i18n';
import { bidCardLine } from '@/lib/signals/bid-card';
import { approxLocationNote } from '@/lib/signals/approx-location';
import { formatDistance, timeAgo } from '@/components/format';
import { NOW } from '../signals/brief-fixtures';
import { shipCases, shipDigestItem, shipFeedItem, type ShipCase } from '../signals/ship-fixtures';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
/** The card chrome and Holler's own titles: a summary and a title a source wrote are the source's words and stay as they are. */
function chrome(cases: ShipCase[], s: string): string {
  let out = s;
  for (const c of cases) for (const v of [localizeTitle(c.signal.title, 'es', c.signal.source) === c.signal.title ? c.signal.title : '', c.signal.summary ?? '']) if (v) out = out.split(v).join(' ').split(v.replace(/&/g, '&amp;')).join(' ');
  return text(out);
}

/** The digest item as page.tsx and the notify cron build it for a Spanish member: the bid line is written in Spanish too. */
const esDigestItem = (c: ShipCase) => {
  const base = shipDigestItem(c);
  const data = (c.signal.data ?? {}) as Record<string, unknown>;
  return { ...base, bidLine: data.subtype === 'bid' ? bidCardLine({ buyer: data.buyer as string, dueDate: data.dueDate as string, expiresAt: c.signal.expiresAt ?? null }, NOW, 'es') : null };
};

const esFeedItem = (c: ShipCase, i: number) => {
  const base = shipFeedItem(c, i);
  const data = (c.signal.data ?? {}) as Record<string, unknown>;
  return {
    ...base,
    ago: timeAgo(c.signal.occurredAt, NOW.getTime(), 'es'),
    distance: formatDistance(c.match.distance_mi, 'es'),
    bidLine: data.subtype === 'bid' ? bidCardLine({ buyer: data.buyer as string, dueDate: data.dueDate as string, expiresAt: c.signal.expiresAt ?? null }, NOW, 'es') : null,
  };
};

describe('Spanish digest', () => {
  it('writes labels, the five-part brief, buttons, footer and unsubscribe in Spanish, and keeps titles and addresses as the source wrote them', async () => {
    const cases = await shipCases();
    const mail = renderDigest({ businessName: 'Taller Los Pinos', items: cases.map(esDigestItem), appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: NOW, lang: 'es' });
    expect(mail.html).toContain('lang="es"');
    for (const phrase of [es['brief.h.why'], es['brief.h.next'], es['brief.h.source'], es['brief.h.uncertain']]) expect(mail.html).toContain(phrase);
    expect(mail.subject).toMatch(/novedades/);
    expect(mail.text).toMatch(/Holler/);
    // source data stays as is
    for (const c of cases.slice(0, 3)) expect(mail.text).toContain(localizeTitle(c.signal.title, 'es', c.signal.source).replace(/\s+/g, ' ').slice(0, 20));
    // none of the English chrome is left
    for (const english of [en['brief.h.why'], en['brief.h.next'], en['brief.h.uncertain'], 'Unsubscribe', 'Open Holler']) expect(chrome(cases, mail.html)).not.toContain(english);
    expect(spanishProblems(chrome(cases, mail.html))).toEqual([]);
    expect(spanishProblems(chrome(cases, mail.text))).toEqual([]);
  });
  it('the unsubscribe link and the open-app link are still the real URLs', () => {
    const mail = renderDigest({ businessName: 'X', items: [], appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u?t=abc', now: NOW, lang: 'es' });
    expect(mail.html).toContain('https://localholler.com/u?t=abc');
    expect(mail.text).toContain('https://localholler.com/u?t=abc');
    expect(mail.html).toContain('https://localholler.com/app');
  });
  it('the default language is the English digest, identical to lang "en"', async () => {
    const cases = await shipCases();
    const input = { businessName: 'Fixture members', items: cases.map(shipDigestItem), appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: NOW };
    const a = renderDigest(input);
    const b = renderDigest({ ...input, lang: 'en' });
    expect(a).toEqual(b);
    expect(a.html).not.toContain('lang="es"');
  });
  it('the AI note (written in English by the model) is left out of a Spanish digest and kept in English', () => {
    const item = { kind: 'report', source: 'spc', title: 'Hail report', summary: null, place: 'Smyrna, GA', occurredAt: NOW.toISOString(), sourceUrl: null, label: 'act_now' as const, trade: 'roofing', note: 'A roof inspection may follow this hail report.' };
    const base = { businessName: 'X', items: [item], appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: NOW };
    expect(renderDigest({ ...base, lang: 'es' }).html).not.toContain('A roof inspection may follow');
    expect(renderDigest(base).html).toContain('A roof inspection may follow');
  });
});

describe('Spanish web cards', () => {
  it('every card, filter, button and status is Spanish, with no English chrome left', async () => {
    const cases = await shipCases();
    const html = renderToStaticMarkup(createElement(Feed, { items: cases.map(esFeedItem), cityPage: null, lang: 'es' }));
    const own = chrome(cases, html);
    for (const english of ['People asking', 'Why it matters', 'What is uncertain', 'Next step', 'Who to contact', 'Dismiss', 'Draft reply', 'Was this alert helpful?']) expect(own, english).not.toContain(english);
    for (const spanish of [es['card.filter.all'], es['card.filter.ask'], es['brief.h.why'], es['card.dismiss']]) expect(own, spanish).toContain(spanish);
    expect(spanishProblems(own)).toEqual([]);
  });
  it('English is untouched when the language is "en" or not given', async () => {
    const cases = await shipCases();
    const items = cases.map((c, i) => shipFeedItem(c, i));
    const a = renderToStaticMarkup(createElement(Feed, { items, cityPage: null }));
    const b = renderToStaticMarkup(createElement(Feed, { items, cityPage: null, lang: 'en' }));
    expect(a).toBe(b);
    expect(a).toContain('People asking');
    expect(a).toContain('Why it matters');
  });
  it('the empty feed and the locked feed are in Spanish too', async () => {
    expect(text(renderToStaticMarkup(createElement(Feed, { items: [], cityPage: { href: '/local/georgia/atlanta', label: 'Atlanta' }, lang: 'es' })))).toContain(es['card.empty.title']);
    const cases = await shipCases();
    // children as a prop: the typings want it there, and a .ts test has no JSX to nest it in
    // eslint-disable-next-line react/no-children-prop
    const locked = renderToStaticMarkup(createElement(LockedFeed, { items: cases.slice(0, 2).map(esFeedItem), lang: 'es', children: createElement('p', null, 'x') }));
    expect(spanishProblems(chrome(cases, locked))).toEqual([]);
  });
});

describe('Spanish outreach notes, draft fallback, coverage line, brief strings', () => {
  const vars = { org: 'ACME Roofing LLC', address: '123 Main St' };
  it('every note has an English twin of the same shape, is Spanish, uses [su nombre], [su negocio] and [su teléfono], and breaks no rule', () => {
    for (const kind of NOTE_KINDS) {
      const note = renderNote(kind, vars, 'es');
      const english = renderNote(kind, vars, 'en');
      const words = note.trim().split(/\s+/).length;
      const enWords = english.trim().split(/\s+/).length;
      expect(words, kind).toBeLessThanOrEqual(Math.max(80, Math.round(enWords * 1.4)));
      expect(words, kind).toBeGreaterThanOrEqual(Math.round(enWords * 0.7));
      expect(note, kind).toMatch(/\[su nombre\]/);
      expect(note, kind).toMatch(/\[su negocio\]/);
      expect(note, kind).not.toMatch(/\[your |\[name\]/i);
      // a Spanish note names the organisation (and the phone placeholder) wherever its English twin does
      if (english.includes('ACME Roofing LLC')) expect(note, kind).toContain('ACME Roofing LLC');
      if (/\[your phone\]/.test(english)) expect(note, kind).toMatch(/\[su teléfono\]/);
      expect(spanishProblems(note), kind).toEqual([]);
      // the English twin keeps its own placeholders
      expect(english, kind).toMatch(/\[your name\]/);
    }
  });
  it('the notes never press, promise or claim damage', () => {
    for (const kind of NOTE_KINDS) {
      const note = renderNote(kind, vars, 'es');
      expect(note, kind).not.toMatch(/urgente|última oportunidad|no pierda|hoy mismo|oferta limitada|se ganó|le toca/i);
    }
  });
  it('the draft fallback is Spanish, names the business once, uses the trade label, and passes the Spanish draft rules', () => {
    const d = fallbackDraft({ businessName: 'Techos Pinos', categories: ['roofing'], title: 'Busco techador', city: 'Marietta', lang: 'es' });
    expect(d).toContain('Techos Pinos');
    expect(d.split('Techos Pinos').length - 1).toBe(1);
    expect(d).toMatch(/techos/);
    expect(d).toMatch(/Marietta/);
    expect(violatesDraftRules(d, 'es')).toBe(false);
    expect(d).not.toContain('—');
    const noCity = fallbackDraft({ businessName: 'Techos Pinos', categories: ['hvac'], title: 't', lang: 'es' });
    expect(noCity).toMatch(/por esta zona/);
    expect(noCity).toMatch(/HVAC/);
  });
  it('the English fallback draft is exactly what it was', () => {
    expect(fallbackDraft({ businessName: 'Peachtree Roofing', categories: ['tree-service'], title: 't', city: 'Smyrna' })).toBe(
      'Hi, I saw your post and wanted to help. I run Peachtree Roofing, and we do tree service around Smyrna. Happy to answer questions or give you a straight price, just reply here and tell me a bit more about what you need.',
    );
  });
  it('Spanish draft rules reject garantizado, cliente potencial, leads, links, emoji and hype', () => {
    for (const bad of ['Le garantizamos un buen precio.', 'Tenemos un cliente potencial.', 'Hola, vea https://x.com', 'Gracias \u{1F600}.', 'Un servicio innovador y sin esfuerzo.', 'Hola — gracias.']) {
      expect(violatesDraftRules(bad, 'es'), bad).toBe(true);
    }
    expect(violatesDraftRules('Hola, vi su publicación. Soy de Techos Pinos y con gusto le ayudo.', 'es')).toBe(false);
  });
  it('every Spanish brief sentence breaks no rule (damage words only with "no confirmado")', () => {
    const bad: string[] = [];
    for (const s of new Set(allBriefStringsLang('es'))) {
      const probs = spanishProblems(s);
      if (probs.length) bad.push(`${probs.join(',')}: ${s}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
  it('bid line, approximate-location note and the "behind" coverage line are Spanish and rule-clean', () => {
    expect(bidCardLine({ buyer: 'City of Raleigh', dueDate: '2026-12-10', expiresAt: null }, NOW, 'es')).toMatch(/Comprador|vence|Fecha/i);
    const note = approxLocationNote({ city: 'Marietta', source: 'x', subtype: 'permit' }, 'es');
    expect(note).toBeTruthy();
    expect(spanishProblems(note)).toEqual([]);
    const states = { nws: { state: 'delayed', reason: null, lastRecordAt: new Date(NOW.getTime() - 9 * 3_600_000).toISOString() } };
    const line = coverageNotice({ lat: 33.75, lon: -84.39, radiusMi: 50, trades: ['roofing'], states, now: NOW.getTime(), lang: 'es' })?.line;
    expect(line).toMatch(/Alertas del clima/);
    expect(line).toMatch(/hace 9 horas/);
    expect(line).toMatch(/Es posible que aquí falten/);
    expect(spanishProblems(line ?? '')).toEqual([]);
    const lineEn = coverageNotice({ lat: 33.75, lon: -84.39, radiusMi: 50, trades: ['roofing'], states, now: NOW.getTime() })?.line;
    expect(lineEn).toBe('Weather alerts are delayed; last update 9 hours ago. Some recent records may be missing here.');
  });
});
