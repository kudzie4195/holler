/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Round 35: honest copy for a federal notice that is not an open bid (HOLLER_SAM_LABELS_ENABLED on). The alert email opens "Early notice from a
 * federal agency in ..." for a Sources Sought or Presolicitation notice and "Planned sole source in ..." for a sole-source set-aside, in
 * English and Spanish, and a Spanish app member gets the Spanish plain line on an ordinary federal bid. Off, none of it changes.
 * The email tests run the REAL notify route (harness: tests/signals/routes-surfaces.test.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';
import { EN_SAM } from '@/lib/i18n/en-sam';
import { ES_SAM } from '@/lib/i18n/es-sam';
import { intentLine } from '@/lib/signals/intent';
import { samOpenerField, samOpenerOf, samOpenerTitle } from '@/lib/signals/sam-notice';
import { buildAlerts, type MatchRow } from '@/lib/mobile/feed';
import { renderDigest, type DigestItem } from '@/lib/email/templates';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('server-only', () => ({}));

const NOW = Date.parse('2026-11-25T15:00:00.000Z');
const H = 3_600_000;
const UID = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  for (const m of ['@/lib/supabase/admin', '@/lib/outreach/loader', '@/lib/email', 'server-only']) vi.doUnmock(m);
});

const samSig = (id: number, summary: string, setAside: string | null) => ({
  id, source: 'sam-gov', external_id: `n${id}`, expires_at: '2026-12-15T12:00:00.000Z', kind: 'contract', subtype: null, title: 'Federal bid in Atlanta, GA: Grounds maintenance',
  summary, url: 'https://sam.gov/opp/x/view', city: 'Atlanta', state: 'GA', lat: 33.749, lon: -84.388, severity: 2, categories: ['landscaping'], occurred_at: new Date(NOW - 2 * H).toISOString(),
  samSetAside: setAside,
});
const match = (id: number, signal: unknown) => ({ id, user_id: UID, created_at: new Date(NOW - H).toISOString(), alert_hold: null, signal });

function fakeAdmin(matches: unknown[], lang: 'en' | 'es') {
  return {
    from(table: string) {
      const ops: Array<{ op: string; args: unknown[] }> = [];
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'range', 'in', 'is', 'update', 'insert', 'limit', 'or', 'gte', 'lt', 'upsert']) q[m] = (...args: unknown[]) => (ops.push({ op: m, args }), q);
      const result = () => {
        const has = (o: string) => ops.some((x) => x.op === o);
        const cols = String(ops.find((x) => x.op === 'select')?.args[0] ?? '');
        if (table === 'holler_matches') return has('update') ? { error: null } : { data: matches, error: null };
        if (table === 'holler_profiles') {
          if (has('update')) return { error: null };
          if (cols === 'user_id, language') return { data: [{ user_id: UID, language: lang }], error: null };
          return { data: [{ user_id: UID, business_name: 'Acme Grounds', categories: ['landscaping'], alert_email: true, subscription_status: 'active', trial_ends_at: null, last_notified_at: null, email_verified_at: '2026-11-01T00:00:00Z', created_at: '2026-11-01T00:00:00Z' }], error: null };
        }
        return { data: [], error: null };
      };
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
      return q;
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'a@acme.test' } }, error: null }) } },
  };
}

async function runNotify(matches: unknown[], lang: 'en' | 'es') {
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', 's3cret');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const sent: { to: string; subject: string; html: string; text: string }[] = [];
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeAdmin(matches, lang) }));
  vi.doMock('@/lib/outreach/loader', async (orig) => ({ ...(await orig<typeof import('@/lib/outreach/loader')>()), loadMemberContacts: async () => new Map() }));
  vi.doMock('@/lib/email', async (orig) => ({
    ...(await orig<typeof import('@/lib/email')>()),
    sendEmail: async (m: any) => (sent.push(m), { ok: true as const, id: 'e1' }),
  }));
  const { GET } = await import('@/app/api/cron/notify/route');
  const res = await GET(new Request('https://holler.test/api/cron/notify', { headers: { authorization: 'Bearer s3cret' } }));
  expect(res.status).toBe(200);
  expect(sent).toHaveLength(1);
  const m = sent[0];
  return { subject: m.subject, all: `${m.subject}\n${m.html}\n${m.text}` };
}

const KINDS = {
  early: samSig(1, 'Sources Sought | VA | NAICS 561730', null),
  presol: samSig(2, 'Presolicitation | GSA', 'SBA'),
  sole: samSig(3, 'Solicitation | GSA', '8AN'),
  bid: samSig(4, 'Combined Synopsis/Solicitation | ARMY', 'SBA'),
};
const L = {
  en: { fed: 'Federal bid in Atlanta, GA', early: 'Early notice from a federal agency in Atlanta, GA', sole: 'Planned sole source in Atlanta, GA', known: 'the notice is listed', bidKnown: 'the bid is listed' },
  es: { fed: 'Licitación federal en Atlanta, GA', early: 'Aviso anticipado de una agencia federal en Atlanta, GA', sole: 'Contratación directa planeada en Atlanta, GA', known: 'el aviso está publicado', bidKnown: 'la licitación está publicada' },
} as const;

describe('switch ON: the alert email opens honestly (real notify route)', () => {
  for (const lang of ['en', 'es'] as const) {
    const w = L[lang];
    it(`${lang}: Sources Sought and Presolicitation open "${w.early}" and say the notice is listed`, async () => {
      vi.stubEnv('HOLLER_SAM_LABELS_ENABLED', '1');
      for (const k of ['early', 'presol'] as const) {
        const r = await runNotify([match(1, KINDS[k])], lang);
        expect(r.all).toContain(w.early);
        expect(r.all).not.toContain(w.fed);
        expect(r.all).toContain(w.known);
        expect(r.all).not.toContain(w.bidKnown);
        expect(r.all).toContain('Grounds maintenance');
      }
    });
    it(`${lang}: a sole-source set-aside opens "${w.sole}"`, async () => {
      vi.stubEnv('HOLLER_SAM_LABELS_ENABLED', '1');
      const r = await runNotify([match(1, KINDS.sole)], lang);
      expect(r.all).toContain(w.sole);
      expect(r.all).not.toContain(w.fed);
      expect(r.all).toContain(w.known);
      expect(r.all).not.toContain(w.bidKnown);
    });
    it(`${lang}: an ordinary federal bid keeps "${w.fed}" and "the bid is listed"`, async () => {
      vi.stubEnv('HOLLER_SAM_LABELS_ENABLED', '1');
      const r = await runNotify([match(1, KINDS.bid)], lang);
      expect(r.all).toContain(w.fed);
      expect(r.all).not.toContain(w.early);
      expect(r.all).not.toContain(w.sole);
      expect(r.all).toContain(w.bidKnown);
    });
    it(`${lang}: the subject says what it is (early notice, planned sole source), never "open bid"`, async () => {
      vi.stubEnv('HOLLER_SAM_LABELS_ENABLED', '1');
      const early = await runNotify([match(1, KINDS.early)], lang);
      const sole = await runNotify([match(1, KINDS.sole)], lang);
      expect(early.subject).toContain(lang === 'en' ? 'Early' : 'anticipado');
      expect(sole.subject).toContain(lang === 'en' ? 'Planned sole source' : 'Contratación directa planeada');
      for (const r of [early, sole]) expect(r.subject).not.toMatch(/Open bid|Licitación abierta/);
    });
  }
});

describe('switch OFF: the email is what it was (real notify route)', () => {
  for (const lang of ['en', 'es'] as const) {
    it(`${lang}: every kind of notice still opens "${L[lang].fed}" and says "the bid is listed"; no new words`, async () => {
      for (const k of ['early', 'presol', 'sole', 'bid'] as const) {
        const r = await runNotify([match(1, KINDS[k])], lang);
        expect(r.all).toContain(L[lang].fed);
        expect(r.all).toContain(L[lang].bidKnown);
        for (const w of [L[lang].early, L[lang].sole, L[lang].known, EN_SAM['sam.email.what_early'], ES_SAM['sam.email.what_early'], EN_SAM['sam.email.what_sole'], ES_SAM['sam.email.what_sole']]) expect(r.all).not.toContain(w);
      }
    });
  }
});

describe('the helpers', () => {
  it('samOpenerOf: early beats sole; ordinary bids, other sources and a switch that is off give null', () => {
    const on = true;
    expect(samOpenerOf({ source: 'sam-gov', summary: 'Sources Sought | VA' }, on)).toBe('early');
    expect(samOpenerOf({ source: 'sam-gov', summary: 'Presolicitation | GSA', setAside: '8AN' }, on)).toBe('early');
    expect(samOpenerOf({ source: 'sam-gov', summary: 'Pre solicitation | GSA' }, on)).toBe('early');
    expect(samOpenerOf({ source: 'sam-gov', summary: 'Solicitation | GSA', setAside: '8an' }, on)).toBe('sole');
    for (const code of ['HZS', 'SDVOSBS', 'WOSBSS', 'EDWOSBSS', 'VSS']) expect(samOpenerOf({ source: 'sam-gov', summary: 'Solicitation | GSA', setAside: code }, on)).toBe('sole');
    expect(samOpenerOf({ source: 'sam-gov', summary: 'Solicitation | GSA', setAside: 'SBA' }, on)).toBeNull();
    expect(samOpenerOf({ source: 'sam-gov', summary: 'Combined Synopsis/Solicitation | ARMY' }, on)).toBeNull();
    expect(samOpenerOf({ source: 'bids-sf', summary: 'Sources Sought | VA' }, on)).toBeNull();
    expect(samOpenerOf({ source: 'sam-gov', summary: 'Sources Sought | VA', setAside: '8AN' }, false)).toBeNull();
    expect(samOpenerField({ source: 'sam-gov', summary: 'Sources Sought | VA' }, false)).toEqual({});
    expect(samOpenerField({ source: 'sam-gov', summary: 'Sources Sought | VA' }, true)).toEqual({ samOpener: 'early' });
  });
  it('samOpenerTitle rewrites only the adapter\'s own title, keeps the notice text whole, and speaks Spanish', () => {
    const t = 'Federal bid in Denver, CO: Janitorial services: Building 4 {not a placeholder}';
    expect(samOpenerTitle(t, 'early', 'en')).toBe('Early notice from a federal agency in Denver, CO: Janitorial services: Building 4 {not a placeholder}');
    expect(samOpenerTitle(t, 'sole', 'en')).toBe('Planned sole source in Denver, CO: Janitorial services: Building 4 {not a placeholder}');
    expect(samOpenerTitle(t, 'early', 'es')).toBe('Aviso anticipado de una agencia federal en Denver, CO: Janitorial services: Building 4 {not a placeholder}');
    expect(samOpenerTitle('Federal bid in GA: Roof', 'sole', 'es')).toBe('Contratación directa planeada en GA: Roof');
    expect(samOpenerTitle(t, null, 'en')).toBe(t);
    expect(samOpenerTitle('Roof permit in Atlanta', 'early', 'en')).toBe('Roof permit in Atlanta');
  });
  it('a stored city of "0" reads "in MI", not "in 0, MI", with the new opener too', () => {
    const item = { kind: 'contract', source: 'sam-gov', title: 'Federal bid in 0, MI: Grounds', summary: 'Sources Sought | VA', place: 'MI', occurredAt: new Date(NOW).toISOString(), label: 'coming_soon', deadline: null, samOpener: 'early' } as unknown as DigestItem;
    const mail = renderDigest({ businessName: 'Acme', items: [item], totalCount: 1, appUrl: 'https://x.test/app', unsubscribeUrl: 'https://x.test/u', now: new Date(NOW), lang: 'en' } as never);
    expect(mail.html).toContain('Early notice from a federal agency in MI: Grounds');
    expect(mail.html).not.toContain('in 0, MI');
  });
  it('EN and ES twins exist for every new key, with the same {placeholders}, and no em dash', () => {
    for (const key of ['sam.title.early', 'sam.title.sole', 'sam.email.what_early', 'sam.email.what_sole', 'sam.email.known_notice', 'sam.bid.intent_line'] as const) {
      const a = EN_SAM[key], b = ES_SAM[key];
      expect(a.length).toBeGreaterThan(5);
      expect(b.length).toBeGreaterThan(5);
      expect([...a.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()).toEqual([...b.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
      expect(a + b).not.toMatch(/[—–]/);
      expect(en[key]).toBe(a);
      expect(es[key]).toBe(b);
    }
    expect(EN_SAM['sam.bid.intent_line']).toBe('This work is out for bid. No contract has been awarded yet.');
    for (const s of [...Object.values(EN_SAM), ...Object.values(ES_SAM)]) expect(s).not.toMatch(/\blead(s)?\b|guaranteed|you will win|canvass|knock door/i);
  });
});

describe('the app: a Spanish member gets the Spanish plain line on an ordinary federal bid', () => {
  const row = (id: number, summary: string, setAside: string | null): MatchRow => ({ id, status: 'new', distance_mi: 3, draft: null, created_at: '2026-11-25T14:00:00Z', signal: { ...samSig(id, summary, setAside), expires_at: '2026-12-15T12:00:00.000Z', county: null, zip: null, occurred_at: '2026-11-24T00:00:00.000Z' } }) as unknown as MatchRow;
  const deps = { userId: 'u1', locked: false, db: {} as never, admin: null, siteUrl: 'https://localholler.com', now: Date.parse('2026-11-25T15:00:00Z'), trades: ['landscaping'] };
  const OLD = 'This work is out for bid. No contract has been awarded yet.';

  it('ON: ES gets the Spanish bid line; EN keeps the English one; early and sole lines keep their own (EN and ES)', async () => {
    vi.stubEnv('HOLLER_SAM_LABELS_ENABLED', '1');
    const [bidEs] = await buildAlerts([row(4, 'Combined Synopsis/Solicitation | ARMY', 'SBA')], { ...deps, lang: 'es' });
    const [bidEn] = await buildAlerts([row(4, 'Combined Synopsis/Solicitation | ARMY', 'SBA')], { ...deps, lang: 'en' });
    expect(bidEs.intent.line).toBe(ES_SAM['sam.bid.intent_line']);
    expect(bidEs.intent.line).not.toBe(OLD);
    expect(bidEs.intent.key).toBe('open-bid');
    expect(bidEn.intent.line).toBe(OLD);
    const [earlyEs] = await buildAlerts([row(1, 'Sources Sought | VA', null)], { ...deps, lang: 'es' });
    const [soleEs] = await buildAlerts([row(3, 'Solicitation | GSA', '8AN')], { ...deps, lang: 'es' });
    const [soleEn] = await buildAlerts([row(3, 'Solicitation | GSA', '8AN')], { ...deps, lang: 'en' });
    expect(earlyEs.intent.line).toBe(ES_SAM['sam.early.intent_line']);
    expect(soleEs.intent.line).toBe(ES_SAM['sam.sole.intent_line']);
    expect(soleEn.intent.line).toBe(EN_SAM['sam.sole.intent_line']);
  });
  it('OFF: ES still gets the old English line (byte for byte what main sent)', async () => {
    for (const v of [undefined, '', '0']) {
      vi.stubEnv('HOLLER_SAM_LABELS_ENABLED', v ?? '');
      const [bidEs] = await buildAlerts([row(4, 'Combined Synopsis/Solicitation | ARMY', 'SBA')], { ...deps, lang: 'es' });
      expect(bidEs.intent.line).toBe(OLD);
    }
    expect(intentLine({ kind: 'contract', source: 'sam-gov', summary: 'Solicitation | GSA' }, 'es')).toBe(OLD);
  });
  it('ON: only federal bids change; a city bid and a permit are as on main in Spanish', () => {
    vi.stubEnv('HOLLER_SAM_LABELS_ENABLED', '1');
    expect(intentLine({ kind: 'contract', source: 'bids-sf', subtype: 'bid' }, 'es')).toBe(OLD);
    expect(intentLine({ kind: 'permit', source: 'atlanta-permits', subtype: 'permit' }, 'es')).toBe(intentLine({ kind: 'permit', source: 'atlanta-permits', subtype: 'permit' }, 'en'));
  });
});

describe('docs', () => {
  it('LAUNCH.md names the new wording', () => {
    const launch = readFileSync(join(__dirname, '../../LAUNCH.md'), 'utf8');
    expect(launch).toContain('Early notice from a federal agency in');
    expect(launch).toContain('Planned sole source in');
  });
});
