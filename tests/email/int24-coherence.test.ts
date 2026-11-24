/**
 * Round 24 INT: the two round 23 halves (Phase A, the website-only launch pass; EMAIL, the rebuilt member alert email) agree, and every
 * marketing or lifecycle email carries what CAN-SPAM asks for (FIXLIST row 17).
 *
 *   A. trial and app    every email states the trial as Phase A defines it (TRIAL_DAYS = 30 for a new sign-up; the trial emails follow
 *                       the member's own trial_ends_at), and none mentions an app, push, iPhone or Android. English and Spanish.
 *   B. wording          the alert email speaks the site's words: "hang and flyer", "public source"; never "knock doors", never "lead(s)".
 *   C. coverage         the quiet-week email never implies a fuller week than the site's per-city-per-trade gate (lib/check/cells.ts).
 *   D. links            the email's address-list link works with Phase A's composite "Pressure washing" chip.
 *   E. CAN-SPAM         unsubscribe link, postal address and a one-line reason, in HTML and text, EN and ES, for each mail type; account
 *                       mail keeps only what it had; the three senders set List-Unsubscribe and List-Unsubscribe-Post.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { TRIAL_DAYS } from '@/lib/auth/membership';
import { coverageFor, measuredCentres } from '@/lib/check/cells';
import { COMPANY } from '@/lib/legal/company';
import { digestCoverage } from '@/lib/email/coverage';
import {
  digestAction,
  renderDigest,
  renderPasswordReset,
  renderVerifyEmail,
  renderWaitlistConfirm,
  renderWelcome,
  type DigestItem,
  type Rendered,
} from '@/lib/email/templates';
import { renderFollowUp } from '@/lib/moat/email';
import { renderTrialEnded, renderTrialEnding, renderWelcomeMatches, renderWelcomeQuiet, type AlertItem } from '@/lib/lifecycle/templates';
import { dueKind } from '@/lib/lifecycle/select';
import { renderConfirmEmailOnly } from '@/lib/mobile/verify-email';
import { areaListTrades } from '@/lib/lists/core';
import { memberAreas } from '@/lib/lists/load';
import { PRESSURE_WASHING_ID, PRESSURE_WASHING_PARTS, profileCategories } from '@/lib/plan/profile-categories';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';
import { spanishProblems } from '@/lib/i18n/rules';
import { WAITLIST } from '@/lib/waitlist/copy';

const NOW = new Date('2026-11-23T14:00:00Z');
const SITE = 'https://localholler.com';
const APP = `${SITE}/app`;
const UNSUB = `${SITE}/api/cron/notify/unsubscribe?t=abc`;
const LIFE_UNSUB = `${SITE}/api/cron/lifecycle/unsubscribe?t=xyz`;
const LANGS = ['en', 'es'] as const;
type L = (typeof LANGS)[number];

/** Real stored rows (gates/r19 data/signals-14d.json), as in tests/email/digest-r23.test.ts. */
const PERMIT: DigestItem = {
  kind: 'permit',
  matchId: 9001,
  source: 'arcgis-cobb-residential-permits',
  subtype: 'permit',
  title: 'New home permit in Cobb County',
  summary: 'New Home | $609,273 job value | 5900 SPARROW WAY | Cobb County',
  place: 'Location is approximate (Cobb County, GA)',
  occurredAt: '2026-11-18T00:00:00+00:00',
  sourceUrl: 'https://gis.cobbcounty.org/gisserver/rest/services/comdev/Accela_PermitsDashboard/FeatureServer/4',
  label: 'coming_soon',
  trade: 'landscaping',
};
const BLOCK: DigestItem = {
  kind: 'civic',
  matchId: 9002,
  source: 'arcgis-dekalb-violations',
  subtype: 'violation',
  title: 'Code violation in DeKalb County: property violation',
  summary: '2400 block of HARMONY RIDGE CT',
  place: 'DeKalb County, GA',
  occurredAt: '2026-11-18T09:25:28+00:00',
  sourceUrl: 'https://dcgis.dekalbcountyga.gov/mapping/rest/services/Hansen/CodeEnforcementCasesInspections/FeatureServer/0',
  label: 'act_now',
  trade: 'lawn-care',
};
const HAIL: DigestItem = {
  kind: 'report',
  matchId: 9005,
  source: 'spc',
  subtype: null,
  title: '1.75 inch hail reported near 2 ESE Longview, TX',
  summary: 'HAIL | Ping pong sized hail',
  place: 'Longview, TX',
  occurredAt: '2026-11-22T00:00:00+00:00',
  sourceUrl: 'https://www.spc.noaa.gov/climo/reports/261122_rpts.html',
  label: 'act_now',
  trade: 'roofing',
};
const CARDS = [PERMIT, BLOCK, HAIL];

const ALERTS: AlertItem[] = [
  { title: 'Roof permit in Atlanta', city: 'Atlanta', state: 'GA', occurredAt: '2026-11-20T00:00:00Z', kind: 'permit', source: 'arcgis-atlanta-permits', label: 'coming_soon' },
  { title: 'Code violation in Chicago: REPAIR PORCH SYSTEM', city: 'Chicago', state: 'IL', occurredAt: '2026-11-16T06:00:00Z', kind: 'civic', source: 'socrata-chicago-violations', subtype: 'violation', label: 'act_now' },
];
const common = (lang: L) => ({ businessName: 'Acme Lawn Care', feedUrl: APP, plansUrl: `${SITE}/pricing`, unsubscribeUrl: LIFE_UNSUB, lang });

const digest = (lang: L, items: DigestItem[] = CARDS, over: Partial<Parameters<typeof renderDigest>[0]> = {}) =>
  renderDigest({ businessName: 'Acme Lawn Care', items, appUrl: APP, unsubscribeUrl: UNSUB, now: NOW, lang, ...over });

/** Every marketing or lifecycle email Holler sends a member, in one language, with the unsubscribe URL its sender puts in it. */
function marketing(lang: L): Array<{ type: string; mail: Rendered; unsub: string; reason: string }> {
  const alertsWhy = lang === 'en' ? en['email.footer.why'] : es['email.footer.why'];
  const lifeWhy = lang === 'en' ? 'You get this because you started a free trial on Holler' : es['life.footer'];
  return [
    { type: 'alert digest', mail: digest(lang), unsub: UNSUB, reason: alertsWhy },
    { type: 'quiet-week digest', mail: digest(lang, []), unsub: UNSUB, reason: alertsWhy },
    {
      type: 'outcome follow-up',
      mail: renderFollowUp({
        businessName: 'Acme Lawn Care',
        items: [{ title: 'Roof permit in Atlanta', kind: 'permit', place: 'Atlanta, GA', occurredAt: '2026-11-15T00:00:00Z', yesUrl: `${SITE}/y`, noUrl: `${SITE}/n` }],
        unsubscribeUrl: UNSUB,
        now: NOW,
        lang,
      }),
      unsub: UNSUB,
      reason: alertsWhy,
    },
    { type: 'welcome (matches)', mail: renderWelcomeMatches({ ...common(lang), total: 2, items: ALERTS }), unsub: LIFE_UNSUB, reason: lifeWhy },
    { type: 'welcome (quiet)', mail: renderWelcomeQuiet({ ...common(lang), lines: [{ label: 'building permits', count: 40, key: 'permit' }], total: 40, days: 90 }), unsub: LIFE_UNSUB, reason: lifeWhy },
    { type: 'trial ending', mail: renderTrialEnding({ ...common(lang), items: ALERTS }), unsub: LIFE_UNSUB, reason: lifeWhy },
    { type: 'trial ended', mail: renderTrialEnded({ ...common(lang), missed: 4 }), unsub: LIFE_UNSUB, reason: lifeWhy },
  ];
}

/** Account mail: transactional. */
function account(lang: L): Array<{ type: string; mail: Rendered }> {
  const o = lang === 'en' ? {} : { lang };
  return [
    { type: 'password reset', mail: renderPasswordReset({ resetUrl: `${SITE}/reset?x=1`, ...o }) },
    { type: 'verify (welcome + confirm)', mail: renderVerifyEmail({ verifyUrl: `${SITE}/api/auth/verify?t=v`, appUrl: APP, ...o }) },
    { type: 'confirm only (returning member)', mail: renderConfirmEmailOnly({ verifyUrl: `${SITE}/api/auth/verify?t=v`, appUrl: APP }, lang) },
    { type: 'waitlist confirm', mail: renderWaitlistConfirm({ confirmUrl: `${SITE}/waitlist/confirm?token=w`, place: 'Valdosta, GA', ...o }) },
  ];
}

/** Every email at all, for the wording checks. renderWelcome has no sender today but is kept honest too. */
function everything(lang: L): Array<{ type: string; mail: Rendered }> {
  const o = lang === 'en' ? {} : { lang };
  return [...marketing(lang), ...account(lang), { type: 'welcome (account, unsent)', mail: renderWelcome({ businessName: 'Acme', appUrl: APP, ...o }) }];
}

/** The words a reader sees: tags, attributes, style blocks and every URL removed. "/app" in a link is a path, not a mention. */
function words(m: Rendered): string {
  const html = m.html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
  return `${m.subject}\n${html}\n${m.text}`.replace(/https?:\/\/\S+/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
}

const ALERTS_COVERAGE = { state: 'live' as const, trades: [] };

describe('A. the trial as Phase A defines it, and no app', () => {
  it('Phase A sets a new trial to 30 days', () => {
    expect(TRIAL_DAYS).toBe(30);
  });

  it('every email that states a trial length states TRIAL_DAYS, in both languages; no email states 60 days or two months', () => {
    for (const lang of LANGS) {
      let stated = 0;
      for (const { type, mail } of everything(lang)) {
        const w = words(mail);
        for (const m of w.matchAll(/(\d+)-day free trial/g)) {
          stated++;
          expect(Number(m[1]), `${lang} ${type}`).toBe(TRIAL_DAYS);
        }
        for (const m of w.matchAll(/prueba gratis de (\d+) d[ií]as/g)) {
          stated++;
          expect(Number(m[1]), `${lang} ${type}`).toBe(TRIAL_DAYS);
        }
        expect(w, `${lang} ${type}`).not.toMatch(/\b60[- ]day|\b60 d[ií]as|two months|2 months|dos meses|2 meses/i);
      }
      // verify and the unsent welcome both state it, so the check above really ran
      expect(stated, lang).toBeGreaterThanOrEqual(2);
    }
  });

  it("the trial emails follow the member's own trial_ends_at, so an existing 60-day trial is reminded at its real end, not at 30 days", () => {
    const created = Date.parse('2026-11-01T00:00:00Z');
    const day = 86_400_000;
    const existing = { user_id: 'u', created_at: new Date(created).toISOString(), email_verified_at: new Date(created).toISOString(), subscription_status: 'trialing', trial_ends_at: new Date(created + 60 * day).toISOString() };
    // 3 days before start + 30 (what a new member would get) nothing is due for this member
    expect(dueKind(existing, new Date(created + 27 * day))).toBeNull();
    // 3 days before the member's real end the reminder is due
    expect(dueKind(existing, new Date(created + 57 * day))).toBe('trial_ending');
    // the reminder states days left, never a date computed from TRIAL_DAYS
    for (const lang of LANGS) {
      const w = words(renderTrialEnding({ ...common(lang), items: [] }));
      expect(w).toMatch(lang === 'en' ? /ends in about 3 days/ : /termina en unos 3 días/);
      expect(w).not.toMatch(/\b(Dec|Jan|dic|ene)[a-z]*\.? \d/i);
    }
  });

  it('no email mentions an app, push, iPhone or Android, in either language', () => {
    for (const lang of LANGS) {
      for (const { type, mail } of everything(lang)) {
        expect(words(mail), `${lang} ${type}`).not.toMatch(/\bapps?\b|\bpush\b|iphone|android|app store|google play|aplicaci[oó]n|notificaci[oó]n/i);
      }
    }
  });
});

describe('B. the alert email speaks the site\'s words', () => {
  it('the quiet-week email points at the address lists with the site\'s own phrase, in both languages', () => {
    const siteEn = en['lists.open_from_app'].split(': ')[1];
    const siteEs = es['lists.open_from_app'].split(': ')[1];
    expect(siteEn).toBe('where to hang and flyer this week');
    expect(words(digest('en', []))).toContain(siteEn);
    expect(words(digest('es', []))).toContain(siteEs);
  });

  it('never "knock doors", never "lead(s)", and every record link is a "public source", in both languages', () => {
    for (const lang of LANGS) {
      for (const mail of [digest(lang), digest(lang, []), digest(lang, [], { coverage: { state: 'limited', trades: ['lawn-care'] } }), digest(lang, [], { coverage: { state: 'waitlist', trades: ['lawn-care'] } })]) {
        const w = words(mail);
        expect(w).not.toMatch(/knock|door-to-door|tocar (a la )?puertas?|puerta a puerta/i);
        expect(w).not.toMatch(/\bleads?\b|prospecto/i);
      }
      const cards = digest(lang);
      const label = lang === 'en' ? 'public source' : es['email.source_link'];
      expect(cards.html.match(new RegExp(`>${label}</a>`, 'g'))).toHaveLength(CARDS.length);
      expect(cards.text.split('\n').filter((l) => l.trim().startsWith(`${label}: `))).toHaveLength(CARDS.length);
    }
  });
});

describe('C. the quiet-week email agrees with the site\'s coverage gate', () => {
  const centre = (id: string) => {
    const c = measuredCentres().find((x) => x.id === id);
    if (!c) throw new Error(id);
    return c;
  };
  const served = () => true;
  const member = (id: string, categories: string[]) => ({ categories, lat: centre(id).lat, lon: centre(id).lon, state: 'GA', plan: null, subscription_status: 'trialing' });

  it("the member's cell is the site's cell: the same lib/check/cells.ts answer /check gives a visitor for that city and trade", () => {
    const cases: Array<[string, string[], 'live' | 'limited' | 'waitlist', string[]]> = [
      ['atlanta', ['lawn-care'], 'limited', ['lawn-care']],
      ['raleigh', ['lawn-care'], 'live', []],
      ['atlanta', ['landscaping', 'lawn-care'], 'live', []],
      ['dallas', ['lawn-care'], 'waitlist', ['lawn-care']],
      // the Pressure washing chip saves both halves; Atlanta exterior is the owner's override: limited, both
      ['atlanta', [...PRESSURE_WASHING_PARTS], 'limited', [...PRESSURE_WASHING_PARTS]],
    ];
    for (const [city, trades, state, listed] of cases) {
      const got = digestCoverage(member(city, trades), served);
      expect(got, `${city} ${trades}`).toEqual({ state, trades: listed });
      for (const t of listed) expect(coverageFor(centre(city), t, true).state).toBe(state);
    }
    expect(digestCoverage({ ...member('atlanta', ['lawn-care']), lat: null, lon: null }, served)).toBeNull();
  });

  // Round 24 (review P1-5): these lines say the week was empty, so they are used only when the quiet-week sender counted the member's
  // matches of the last 7 days and found none (matchedLastWeek: 0, lib/email/quiet-week.ts). The other two cases are in fixmail-r24.
  it('a limited cell gets the site\'s "few records" line, a waitlist cell the waitlist card\'s line, and neither says "quiet weeks happen"', () => {
    const limited = digest('en', [], { matchedLastWeek: 0, coverage: { state: 'limited', trades: ['lawn-care'] } });
    const waitlist = digest('en', [], { matchedLastWeek: 0, coverage: { state: 'waitlist', trades: ['lawn-care'] } });
    const live = digest('en', [], { matchedLastWeek: 0, coverage: ALERTS_COVERAGE });
    // /check's limited line and the waitlist card's line (Phase A), in the email's own sentence
    // INT2 (copy round): /check's limited line now reads "Few {trade} records near here so far, and some weeks bring none."; the email
    // says the same facts in its own sentence (a list of trades reads better after "records for").
    expect(en['chk.limited'].startsWith('Few {trade} records near here so far, and some weeks bring none.')).toBe(true);
    expect(words(limited)).toContain('Few records for lawn care near you so far, and some weeks bring none.');
    expect(WAITLIST.tradeNote).toContain('lately none of them has been work for this trade');
    expect(words(waitlist)).toContain('lately none of them has been work for lawn care');
    for (const m of [limited, waitlist]) {
      expect(words(m)).not.toContain('Quiet weeks happen');
      // the same text in both parts
      expect(m.text).toContain(words(m).includes('Few records') ? 'Few records for lawn care near you so far' : 'none of them has been work for lawn care');
    }
    expect(words(live)).toContain('Quiet weeks happen');
    expect(digest('en', [], { matchedLastWeek: 0 }).html).toBe(live.html);
    // two trades read as a list
    expect(words(digest('en', [], { matchedLastWeek: 0, coverage: { state: 'limited', trades: [...PRESSURE_WASHING_PARTS] } }))).toContain('Few records for house cleaning and siding and gutters near you so far');
  });

  it('Spanish says the same, under the Spanish wording rules', () => {
    for (const k of ['email.empty.limited', 'email.empty.waitlist', 'email.empty.next'] as const) {
      expect(es[k]).toBeTruthy();
      expect(es[k]).not.toBe(en[k]);
      expect(spanishProblems(es[k]), k).toEqual([]);
    }
    const limited = words(digest('es', [], { matchedLastWeek: 0, coverage: { state: 'limited', trades: ['lawn-care'] } }));
    expect(limited).toContain('Por ahora hay pocos registros de cuidado del césped cerca de usted, y algunas semanas no llega ninguno');
    expect(limited).not.toContain('Hay semanas tranquilas');
    expect(words(digest('es', [], { matchedLastWeek: 0, coverage: { state: 'waitlist', trades: ['lawn-care'] } }))).toContain('ninguno ha sido trabajo de cuidado del césped');
  });

  it('coverage never changes an email that has cards: the cards are the member\'s own matched records, and no card claims a week', () => {
    for (const lang of LANGS) {
      const plain = digest(lang);
      for (const state of ['limited', 'waitlist'] as const) {
        const m = digest(lang, CARDS, { coverage: { state, trades: ['lawn-care'] } });
        expect(m).toEqual(plain);
      }
      expect(words(plain)).not.toMatch(/quiet weeks|every week|full week|semanas tranquilas|cada semana/i);
    }
  });
});

describe("D. the email's address-list link works with Phase A's sign-up and settings", () => {
  // Round 24 (review P1-1): the trade's address list is a list of permits, so the only card that still links to it is a building permit
  // whose address could not be read (a block-level violation prints the door hanger instead). The composite-chip resolution these tests
  // pin is unchanged and now applies to that card.
  const NO_ADDRESS: DigestItem = { ...PERMIT, summary: 'New Home | $609,273 job value | Cobb County' };
  const washer = { user_id: 'u', categories: [...PRESSURE_WASHING_PARTS], lat: 33.75, lon: -84.39, state: 'GA', radius_mi: 25, plan: null, subscription_status: 'trialing' };

  it('a member who picked "Pressure washing" saved its two real trades, and a permit card with no address for either links to a list the page will open', () => {
    const m = memberAreas(washer);
    expect(m?.trades).toEqual([...PRESSURE_WASHING_PARTS]);
    for (const trade of PRESSURE_WASHING_PARTS) {
      const act = digestAction({ ...NO_ADDRESS, trade }, APP, 'en');
      const linked = new URL(act.href).searchParams.get('trade');
      expect(act.href).toBe(`${APP}/lists/area?trade=${trade}`);
      // lib/lists/load.ts loadAreaList answers 404 unless the trade is one of these: it is, so the page opens
      expect(areaListTrades(m!.trades)).toContain(linked);
    }
  });

  it('the composite chip id itself resolves to its trades, never to a link the area-list page would 404', () => {
    for (const lang of LANGS) {
      const act = digestAction({ ...NO_ADDRESS, trade: PRESSURE_WASHING_ID }, APP, lang);
      expect(act.href).toBe(`${APP}/lists/area?trade=${PRESSURE_WASHING_PARTS[0]}`);
      expect(act.label).not.toContain(PRESSURE_WASHING_ID);
    }
    // and no chip on the sign-up form ever produces a link naming a trade that is not real
    for (const c of profileCategories('en')) {
      const href = digestAction({ ...NO_ADDRESS, trade: c.id }, APP, 'en').href;
      expect(href).not.toContain(PRESSURE_WASHING_ID);
      const linked = href.includes('/lists/area?') ? new URL(href).searchParams.get('trade') : null;
      if (linked) expect(areaListTrades([linked])).toEqual([linked]);
      // and a block-level card never links to the permit list, whatever its trade
      expect(digestAction({ ...BLOCK, trade: c.id }, APP, 'en').href).toBe(`${APP}/lists/door-hanger`);
    }
  });
});

describe('E. CAN-SPAM: every marketing or lifecycle email, HTML and text, English and Spanish', () => {
  for (const lang of LANGS) {
    for (const { type, mail, unsub, reason } of marketing(lang)) {
      it(`${lang} ${type}: unsubscribe link, postal address and the reason line, in both parts`, () => {
        expect(mail.html, 'html unsubscribe').toContain(`href="${unsub.replace(/&/g, '&amp;')}"`);
        expect(mail.text, 'text unsubscribe').toContain(unsub);
        expect(mail.html, 'html postal').toContain(COMPANY.addressLine);
        expect(mail.text, 'text postal').toContain(COMPANY.addressLine);
        expect(mail.html, 'html reason').toContain(reason.replace(/'/g, '&#39;'));
        expect(mail.text, 'text reason').toContain(reason);
        // the reason sits right above the opt-out in the text part, so a reader sees why and how to stop in one place
        const lines = mail.text.split('\n');
        const at = lines.findIndex((l) => l.includes(unsub));
        expect(lines.slice(Math.max(0, at - 1), at + 1).join('\n')).toContain(reason);
      });
    }
    for (const { type, mail } of account(lang)) {
      it(`${lang} ${type}: transactional, keeps the postal address and gains no unsubscribe or marketing reason line`, () => {
        expect(mail.html).toContain(COMPANY.addressLine);
        expect(mail.text).toContain(COMPANY.addressLine);
        const w = words(mail);
        expect(w).not.toMatch(/unsubscribe|turn off email alerts|stop these emails|desactivar las alertas|dejar de recibir/i);
        expect(w).not.toContain(lang === 'en' ? en['email.footer.why'] : es['email.footer.why']);
      });
    }
  }

  it('the three senders of marketing and lifecycle mail set List-Unsubscribe and List-Unsubscribe-Post (RFC 8058) with the same link', () => {
    // Runtime proof for lifecycle and the outcome email: tests/lifecycle/run.test.ts and tests/moat/run.test.ts read the headers off
    // the send. The alert digest's sender is the notify cron, read here at the call site.
    const re = /headers: \{ 'List-Unsubscribe': `<\$\{(unsubscribeUrl|unsub)\}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' \}/;
    for (const f of ['app/api/cron/notify/route.ts', 'lib/lifecycle/run.ts', 'lib/moat/run.ts']) {
      expect(readFileSync(f, 'utf8'), f).toMatch(re);
    }
    // the lifecycle cron hands lib/email sendEmail straight to the run, and sendEmail passes headers through to the provider
    expect(readFileSync('app/api/cron/lifecycle/route.ts', 'utf8')).toMatch(/send: sendEmail,/);
    expect(readFileSync('lib/email/index.ts', 'utf8')).toMatch(/headers: input\.headers,/);
  });
});
