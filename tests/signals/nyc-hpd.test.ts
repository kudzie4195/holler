/**
 * NYC managing agent on no-heat cards (PLAN-2.0 item 2.6, round 15 unit K).
 *
 * Fixture provenance: tests/signals/fixtures/nyc-hpd-heat-sample-2026-11-21.json (read through WebFetch on 2026-11-21; ESTIMATED, see its
 * _provenance field). The adapter tests use hand-written 311 rows in the shape of dataset erm2-nwe9 and a fake fetch: nothing here calls
 * the network.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';

vi.mock('server-only', () => ({}));
import { BriefBlock } from '@/components/feed/brief-block';
import {
  BBLS_PER_QUERY,
  ENRICH_WINDOW_HOURS,
  MAX_BBLS_PER_RUN,
  adapters,
  bblKey,
  buildNycHeatAdapter,
  clearManagerCache,
  contactsQuery,
  groupContacts,
  groupRegistrations,
  lookupManagers,
  parseBbl,
  registrationsQuery,
  resolveManagers,
} from '@/lib/signals/adapters/nyc-hpd';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { cardBrief } from '@/lib/signals/brief';
import {
  MANAGER_SELECT,
  companyNameOf,
  isResidentialHeatTitle,
  managedByLine,
  managedByLineFrom,
  managerForBuilding,
  managerForRegistration,
} from '@/lib/signals/managed-by';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { buildAlerts } from '@/lib/mobile/feed';
import { renderDigest } from '@/lib/email/templates';
import type { AdapterContext } from '@/lib/signals/types';
import { BANNED } from './banned';

const fx = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'nyc-hpd-heat-sample-2026-11-21.json'), 'utf8')) as {
  heatRowBbls: (string | null)[];
  registrations: unknown[];
  contacts: unknown[];
};

beforeEach(() => clearManagerCache());

describe('companyNameOf: company names only', () => {
  it('accepts company names as the registration prints them', () => {
    for (const n of [
      'PRESTIGE MANAGEMENT INC.',
      'STONEHENGE MANAGEMENT LLC',
      'Brookman Management Corp.',
      'WINNRESIDENTAL (NY) LLC',
      'R.E.M. Residential',
      'HOULIHAN-PARNES PROPERTIES',
      'GOUVERNEUR GARDENS HOUSING CORP',
      '1864 CORP',
      'Newmark',
      'RHAMCO',
    ]) {
      expect(companyNameOf(n)).toBe(n);
    }
  });

  it('rejects a person written in the CorporationName column, a trust, an estate, an address, a placeholder', () => {
    for (const n of [
      'JOHN B. LOVETT', // seen live as an Agent corporationname
      'KYLE BARBARIA', // seen live as an Agent corporationname
      'Seah Myers',
      'MARIA LOPEZ',
      'ANNETTEGARRIS-GREENE REV TRUSt',
      'MEI LIEN SHIU LIVING TRUST',
      'ESTATE OF RUTH ADAMS',
      '382 E 197TH STREET',
      'Corporation',
      'INDIVIDUAl',
      'NONE',
      '',
      '   ',
      'AB',
      'Jose', // one word, a listed given name
    ]) {
      expect(companyNameOf(n), n).toBeNull();
    }
  });

  it('rejects contact details, markup, look-alike letters and non-strings', () => {
    for (const n of ['Acme Realty LLC 212-555-0100', 'info@acme.com Realty LLC', 'www.acme-realty.com LLC', 'Acme <b>Realty</b> LLC', 'Acme Rеalty LLC', 'Acme​Realty LLC']) {
      expect(companyNameOf(n), n).toBeNull();
    }
    for (const v of [null, undefined, 42, {}, ['Acme Realty LLC']]) expect(companyNameOf(v)).toBeNull();
    expect(companyNameOf('A'.repeat(200) + ' LLC')).toBeNull();
  });
});

describe('managerForRegistration: agent first, then the corporate owner, never a person', () => {
  it('prefers the managing agent company', () => {
    const m = managerForRegistration([
      { registrationid: '1', type: 'CorporateOwner', corporationname: '77 SECOND LLC' },
      { registrationid: '1', type: 'Agent', corporationname: 'PROVIDENT MANAGEMENT CORP' },
    ]);
    expect(m).toEqual({ name: 'PROVIDENT MANAGEMENT CORP', role: 'agent' });
    expect(managedByLine(m!)).toBe("Managed by: PROVIDENT MANAGEMENT CORP (from the city's building registration)");
  });

  it('falls back to the owner company with the owner wording (a registered owner is not said to manage)', () => {
    const m = managerForRegistration([{ type: 'Agent' }, { type: 'CorporateOwner', corporationname: 'Lennon and Green Inc.' }]);
    expect(m).toEqual({ name: 'Lennon and Green Inc.', role: 'owner' });
    expect(managedByLine(m!)).toBe("Owner company: Lennon and Green Inc. (from the city's building registration)");
  });

  it('shows nothing for a person with no CorporationName (individual owner, individual site manager)', () => {
    expect(managerForRegistration([{ type: 'IndividualOwner' }, { type: 'SiteManager' }, { type: 'Agent' }])).toBeNull();
    expect(managerForRegistration([{ type: 'IndividualOwner', corporationname: null }, { type: 'HeadOfficer', corporationname: '' }])).toBeNull();
  });

  it('shows nothing when the only name in the column is a person', () => {
    expect(managerForRegistration([{ type: 'Agent', corporationname: 'KYLE BARBARIA' }, { type: 'IndividualOwner' }])).toBeNull();
  });

  it('ignores types that are not agent, site manager or corporate owner (officers, shareholders, lessees)', () => {
    expect(managerForRegistration([{ type: 'HeadOfficer', corporationname: 'Some Holdings LLC' }, { type: 'Lessee', corporationname: 'Some Holdings LLC' }])).toBeNull();
  });
});

describe('privacy by construction', () => {
  it('the requests never ask for a person column', () => {
    const reg = registrationsQuery([{ boro: '3', block: '1610', lot: '2' }]).toString();
    const con = contactsQuery(['317413']).toString();
    for (const q of [reg, con]) expect(q).not.toMatch(/firstname|lastname|title|businesshouse|businessstreet|businessapartment|businesszip|phone/i);
    expect(new URLSearchParams(con).get('$select')).toBe('registrationid,type,corporationname');
  });

  it('a response that carries person columns anyway never reaches a result', () => {
    const rows = [
      { registrationid: '9', type: 'Agent', corporationname: 'WAVECREST MGMT GROUP', firstname: 'SABREEN', lastname: 'SPEARS', businesshousenumber: '9' },
    ];
    const grouped = groupContacts(rows);
    expect(JSON.stringify([...grouped])).not.toMatch(/SABREEN|SPEARS|businesshousenumber/);
    const m = managerForRegistration(grouped.get('9')!);
    expect(JSON.stringify(m)).not.toMatch(/SABREEN|SPEARS/);
  });

  it('values placed in a query are digits only', () => {
    expect(parseBbl("3016100002'; DROP")).toBeNull();
    const q = contactsQuery(['317413', "1' OR '1'='1", 'abc', '99999999999']).get('$where')!;
    expect(q).toContain("'317413'");
    expect(q).not.toMatch(/OR '1'/);
    expect(q).not.toContain('abc');
    expect(q).not.toContain('99999999999');
  });

  it('a stored name is checked again when the card is built (a row written by another path cannot print a person)', () => {
    expect(managedByLineFrom('JOHN B. LOVETT', 'agent')).toBeNull();
    expect(managedByLineFrom('STONEHENGE MANAGEMENT LLC', 'agent')).toBe("Managed by: STONEHENGE MANAGEMENT LLC (from the city's building registration)");
    expect(managedByLineFrom('STONEHENGE MANAGEMENT LLC', 'owner')).toMatch(/^Owner company: /);
    expect(managedByLineFrom(null, 'agent')).toBeNull();
  });
});

describe('managerForBuilding: one company per lot, or nothing', () => {
  const a = { name: 'PRESTIGE MANAGEMENT INC.', role: 'agent' as const };
  it('names a company only when more than half of the registrations agree (any spelling)', () => {
    expect(managerForBuilding([a])).toEqual(a);
    expect(managerForBuilding([a, { name: 'Prestige Management Inc', role: 'agent' }])).toEqual(a);
    expect(managerForBuilding([a, a, null])).toEqual(a);
    expect(managerForBuilding([a, null])).toBeNull();
    expect(managerForBuilding([a, { name: 'OTHER REALTY LLC', role: 'agent' }])).toBeNull();
    expect(managerForBuilding([])).toBeNull();
  });
  it('names nothing for a development with more than six registrations', () => {
    expect(managerForBuilding(Array(7).fill(a))).toBeNull();
    expect(managerForBuilding(Array(6).fill(a))).toEqual(a);
  });
});

describe('heat title and BBL helpers', () => {
  it('residential heat and hot water only', () => {
    expect(isResidentialHeatTitle('311 request in New York City: HEAT/HOT WATER / APARTMENT ONLY')).toBe(true);
    expect(isResidentialHeatTitle('311 request in New York City: HEAT/HOT WATER / ENTIRE BUILDING')).toBe(true);
    expect(isResidentialHeatTitle('311 request in New York City: Non-Residential Heat / Inadequate or No Heat')).toBe(false);
    expect(isResidentialHeatTitle('311 request in New York City: Sewer / Catch Basin')).toBe(false);
    expect(isResidentialHeatTitle(null)).toBe(false);
  });
  it('parses a 10 digit BBL', () => {
    expect(parseBbl('3016100002')).toEqual({ boro: '3', block: '1610', lot: '2' });
    expect(parseBbl('1002430056')).toEqual({ boro: '1', block: '243', lot: '56' });
    expect(parseBbl('1018637501')).toEqual({ boro: '1', block: '1863', lot: '7501' });
    for (const v of ['', '301610002', '30161000020', '6016100002', '0016100002', '3016100000', null, undefined, {}, 'abcdefghij']) expect(parseBbl(v)).toBeNull();
  });
});

describe('the heat-card company rate on the 100-row sample (ESTIMATED: values relayed by WebFetch)', () => {
  const rows = fx.heatRowBbls;
  const keys = [...new Set(rows.map((b) => parseBbl(b)).filter((b) => b).map((b) => bblKey(b!)))];
  const lots = groupRegistrations(fx.registrations, new Set(keys));
  const resolved = resolveManagers(lots, groupContacts(fx.contacts), keys);
  const named = rows.map((b) => {
    const p = parseBbl(b);
    return p ? (resolved.get(bblKey(p)) ?? null) : null;
  });

  it('the sample has at least 100 heat rows', () => {
    expect(rows.length).toBeGreaterThanOrEqual(100);
  });

  it('at least 60% of the rows get a company (target of PLAN-2.0 2.6)', () => {
    const rate = named.filter(Boolean).length / rows.length;
    expect(rate).toBeGreaterThanOrEqual(0.6);
  });

  it('every named company passes the company-only check and prints a card line', () => {
    for (const m of named) {
      if (!m) continue;
      expect(companyNameOf(m.name)).toBe(m.name);
      expect(managedByLine(m)).toMatch(/^(Managed by|Owner company): .+ \(from the city's building registration\)$/);
    }
  });

  it('no person-looking name is among the results', () => {
    const names = new Set(named.filter(Boolean).map((m) => m!.name));
    for (const person of ['JOHN B. LOVETT', 'KYLE BARBARIA', 'Seah Myers']) expect(names.has(person)).toBe(false);
  });
});

// ---- the lookup with a fake fetch -------------------------------------------------------------------------------------------------------

function fakeSocrata(opts: { failContacts?: boolean } = {}) {
  const calls: string[] = [];
  const f: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    const u = new URL(url);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (u.pathname.endsWith('/tesw-yqqr.json')) {
      const where = u.searchParams.get('$where') ?? '';
      const rows = (fx.registrations as { registrationid: string; boroid: string; block: string; lot: string }[]).filter((r) =>
        where.includes(`boroid='${r.boroid}' AND block='${r.block}' AND lot='${r.lot}'`),
      );
      return json(rows);
    }
    if (u.pathname.endsWith('/feu5-w2e2.json')) {
      if (opts.failContacts) return json({ error: true }, 500);
      const where = u.searchParams.get('$where') ?? '';
      return json((fx.contacts as { registrationid: string }[]).filter((c) => where.includes(`'${c.registrationid}'`)));
    }
    return json([]);
  };
  return { f, calls };
}

describe('lookupManagers: bounded, cached, soft on failure', () => {
  it('finds the managing agent of a lot through the two datasets', async () => {
    const { f, calls } = fakeSocrata();
    const out = await lookupManagers(['1002430056'], { fetch: f });
    expect(out.get('1-243-56')).toEqual({ name: 'PRESTIGE MANAGEMENT INC.', role: 'agent' });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('data.cityofnewyork.us/resource/tesw-yqqr.json');
    expect(calls[1]).toContain('data.cityofnewyork.us/resource/feu5-w2e2.json');
  });

  it('caches by lot: a repeated BBL costs no request', async () => {
    const { f, calls } = fakeSocrata();
    await lookupManagers(['1002430056', '1002430056'], { fetch: f, now: 1000 });
    const n = calls.length;
    const again = await lookupManagers(['1002430056'], { fetch: f, now: 2000 });
    expect(calls.length).toBe(n);
    expect(again.get('1-243-56')?.name).toBe('PRESTIGE MANAGEMENT INC.');
  });

  it('is bounded: at most maxBbls lots and ceil(n / BBLS_PER_QUERY) registration requests', async () => {
    const { f, calls } = fakeSocrata();
    const many = Array.from({ length: 300 }, (_, i) => `3${String(1000 + i).padStart(5, '0')}0001`);
    const out = await lookupManagers(many, { fetch: f });
    expect(out.size).toBeLessThanOrEqual(MAX_BBLS_PER_RUN);
    const regCalls = calls.filter((c) => c.includes('tesw-yqqr'));
    expect(regCalls.length).toBe(Math.ceil(MAX_BBLS_PER_RUN / BBLS_PER_QUERY));
    expect(calls.filter((c) => c.includes('feu5-w2e2')).length).toBe(0); // no registrations found, so no contact request
  });

  it('a failed contact request leaves the lot out of the result and out of the cache (the next run tries again)', async () => {
    const bad = fakeSocrata({ failContacts: true });
    const out = await lookupManagers(['1002430056'], { fetch: bad.f });
    expect(out.has('1-243-56')).toBe(false);
    const good = fakeSocrata();
    const out2 = await lookupManagers(['1002430056'], { fetch: good.f });
    expect(out2.get('1-243-56')?.name).toBe('PRESTIGE MANAGEMENT INC.');
  });

  it('a lot with no registration is cached as no company', async () => {
    const { f, calls } = fakeSocrata();
    const out = await lookupManagers(['5000360020'], { fetch: f });
    expect(out.get('5-36-20')).toBeNull();
    const n = calls.length;
    await lookupManagers(['5000360020'], { fetch: f });
    expect(calls.length).toBe(n);
  });

  it('never throws when fetch throws', async () => {
    const boom: typeof fetch = async () => {
      throw new Error('network down');
    };
    const logs: string[] = [];
    const out = await lookupManagers(['1002430056'], { fetch: boom, log: (m) => logs.push(m) });
    expect(out.size).toBe(0);
    expect(logs.join(' ')).toContain('network down');
  });
});

// ---- the NYC 311 adapter with the lookup --------------------------------------------------------------------------------------------------

const NOW = new Date('2026-11-20T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString().replace('Z', '').slice(0, 19);

function row311(key: string, bbl: string | null, over: Record<string, unknown> = {}) {
  return {
    unique_key: key,
    created_date: hoursAgo(2),
    complaint_type: 'HEAT/HOT WATER',
    descriptor: 'APARTMENT ONLY',
    borough: 'MANHATTAN',
    incident_zip: '10025',
    latitude: '40.80',
    longitude: '-73.96',
    ...(bbl ? { bbl } : {}),
    ...over,
  };
}

function ctxWith(rows311: unknown[], hpd = fakeSocrata()) {
  const calls: string[] = [];
  const f: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/resource/erm2-nwe9.json')) return new Response(JSON.stringify(rows311), { status: 200, headers: { 'content-type': 'application/json' } });
    return hpd.f(input, init);
  };
  const ctx: AdapterContext = { since: new Date(NOW.getTime() - 3 * 86_400_000), now: NOW, fetch: f, env: {}, log: () => {} };
  return { ctx, calls };
}

describe('socrata-nyc-311 with the managing agent lookup', () => {
  const ds = SOCRATA_DATASETS.find((d) => d.id === 'socrata-nyc-311')!;

  it('is registered in place of the plain 311 adapter, once, same id and cadence', () => {
    const list = ALL_ADAPTERS.filter((a) => a.id === 'socrata-nyc-311');
    expect(list).toHaveLength(1);
    expect(adapters).toHaveLength(1);
    expect(list[0]).toBe(adapters[0]);
    expect(list[0].cadenceMinutes).toBe(ds.cadenceMinutes);
  });

  it('adds the company to a heat row and nothing else about the building to the signal', async () => {
    const { ctx } = ctxWith([row311('71183111', '1002430056')]);
    const out = await buildNycHeatAdapter(ds).fetch(ctx);
    expect(out).toHaveLength(1);
    expect(out[0].data).toMatchObject({ managerName: 'PRESTIGE MANAGEMENT INC.', managerRole: 'agent', subtype: '311' });
    const flat = JSON.stringify(out[0]);
    expect(flat).not.toContain('1002430056'); // the BBL is a join key only, never stored
    expect(flat).not.toMatch(/SABREEN|SPEARS|firstname|lastname/i);
    expect(out[0].contacts).toBeUndefined(); // the private contacts table stays closed to 311 rows
  });

  it('a row with no company (individual owner) gets no manager keys', async () => {
    const { ctx } = ctxWith([row311('1', '3012410032')]);
    const out = await buildNycHeatAdapter(ds).fetch(ctx);
    expect(out).toHaveLength(1);
    expect(out[0].data).not.toHaveProperty('managerName');
  });

  it('a non-residential heat row, an old row and a row without a BBL are not looked up', async () => {
    const { ctx, calls } = ctxWith([
      row311('2', '1002430056', { complaint_type: 'Non-Residential Heat', descriptor: 'Inadequate or No Heat' }),
      row311('3', '1002430056', { created_date: hoursAgo(ENRICH_WINDOW_HOURS + 20) }),
      row311('4', null),
    ]);
    const out = await buildNycHeatAdapter(ds).fetch(ctx);
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) expect(s.data).not.toHaveProperty('managerName');
    expect(calls.filter((c) => c.includes('tesw-yqqr') || c.includes('feu5-w2e2'))).toHaveLength(0);
  });

  it('when the registration API fails the rows are returned exactly as the plain adapter returns them', async () => {
    const down = { f: (async () => new Response('x', { status: 503 })) as typeof fetch, calls: [] as string[] };
    const withLookup = ctxWith([row311('71183111', '1002430056')], down);
    const plain = ctxWith([row311('71183111', '1002430056')]);
    const a = await buildNycHeatAdapter(ds).fetch(withLookup.ctx);
    const b = await (await import('@/lib/signals/adapters/socrata')).buildSocrataAdapter(ds).fetch(plain.ctx);
    expect(a).toEqual(b);
  });
});

// ---- the card ----------------------------------------------------------------------------------------------------------------------

const HEAT_TITLE = '311 request in New York City: HEAT/HOT WATER / APARTMENT ONLY';
const heatInput = { source: 'socrata-nyc-311', kind: 'civic', subtype: '311', title: HEAT_TITLE, summary: 'HEAT/HOT WATER | APARTMENT ONLY | MANHATTAN', label: 'act_now' as const, trade: 'hvac', occurredAt: '2026-11-20T04:57:13Z', url: null };

describe('the card line', () => {
  it('cardBrief carries "Managed by: <Company> (from the city\'s building registration)" for a heat card', () => {
    const b = cardBrief({ ...heatInput, managerName: 'STONEHENGE MANAGEMENT LLC', managerRole: 'agent' });
    expect(b.managedBy).toBe("Managed by: STONEHENGE MANAGEMENT LLC (from the city's building registration)");
    for (const re of BANNED) expect(b.managedBy).not.toMatch(re);
  });

  it('is null without a stored name, for a person name, for a locked member (no title), and for any other record', () => {
    expect(cardBrief(heatInput).managedBy).toBeNull();
    expect(cardBrief({ ...heatInput, managerName: 'KYLE BARBARIA', managerRole: 'agent' }).managedBy).toBeNull();
    expect(cardBrief({ ...heatInput, title: null, summary: null, managerName: 'STONEHENGE MANAGEMENT LLC', managerRole: 'agent' }).managedBy).toBeNull();
    expect(cardBrief({ ...heatInput, source: 'socrata-chicago-violations', subtype: 'violation', title: 'Code violation in Chicago', managerName: 'STONEHENGE MANAGEMENT LLC' }).managedBy).toBeNull();
    expect(cardBrief({ ...heatInput, title: '311 request in New York City: Sewer / Catch Basin', managerName: 'STONEHENGE MANAGEMENT LLC' }).managedBy).toBeNull();
  });

  it('the web card renders the line once, between the next step and the source; the other four parts are unchanged', () => {
    const html = renderToStaticMarkup(
      createElement(BriefBlock, { item: { source: 'socrata-nyc-311', kind: 'civic', subtype: '311', title: HEAT_TITLE, summary: null, label: 'act_now', trade: 'hvac', url: null, occurredAt: '2026-11-20T04:57:13Z', managerName: 'STONEHENGE MANAGEMENT LLC', managerRole: 'agent' } }),
    );
    expect(html.match(/data-testid="brief-managed"/g)).toHaveLength(1);
    expect(html).toContain("Managed by: STONEHENGE MANAGEMENT LLC (from the city&#x27;s building registration)");
    expect(html.indexOf('brief-next')).toBeLessThan(html.indexOf('brief-managed'));
    expect(html.indexOf('brief-managed')).toBeLessThan(html.indexOf('brief-source'));
    for (const id of ['brief-why', 'brief-next', 'brief-source', 'brief-uncertain']) expect(html).toContain(`data-testid="${id}"`);
  });

  it('the web card has no managed line without a name', () => {
    const html = renderToStaticMarkup(createElement(BriefBlock, { item: { source: 'socrata-nyc-311', kind: 'civic', subtype: '311', title: HEAT_TITLE, summary: null, label: 'act_now', trade: 'hvac', url: null, occurredAt: '2026-11-20T04:57:13Z' } }));
    expect(html).not.toContain('brief-managed');
  });

  it('the select alias list reads the two flat keys', () => {
    expect(MANAGER_SELECT).toBe('managerName:data->>managerName,managerRole:data->>managerRole');
  });
});

describe('the other two surfaces: mobile alert and email digest', () => {
  const row = (extra: Record<string, unknown> = {}) =>
    ({
      id: 1, status: 'new', distance_mi: 1.2, draft: null, created_at: '2026-11-20T05:00:00Z',
      signal: { id: 77, source: 'socrata-nyc-311', kind: 'civic', subtype: '311', title: HEAT_TITLE, summary: 'HEAT/HOT WATER | APARTMENT ONLY | MANHATTAN', url: null, city: 'New York City', state: 'NY', county: null, zip: '10025', severity: 2, categories: ['hvac', 'plumbing'], occurred_at: '2026-11-20T04:57:13Z', expires_at: null, managerName: 'STONEHENGE MANAGEMENT LLC', managerRole: 'agent', ...extra },
    }) as never;
  const deps = (over: Record<string, unknown> = {}) => ({ userId: 'u1', locked: false, db: new FakeDb() as never, admin: null, siteUrl: 'https://localholler.com', now: Date.parse('2026-11-20T12:00:00Z'), trades: ['hvac'], ...over });

  it('mobile alert: brief.managedBy for a member; absent for a locked member and for a row without a company', async () => {
    const [a] = await buildAlerts([row()], deps());
    expect(a.brief.managedBy).toBe("Managed by: STONEHENGE MANAGEMENT LLC (from the city's building registration)");
    const [locked] = await buildAlerts([row()], deps({ locked: true }));
    expect(locked.brief).not.toHaveProperty('managedBy');
    expect(JSON.stringify(locked)).not.toContain('STONEHENGE');
    const [none] = await buildAlerts([row({ managerName: null, managerRole: null })], deps());
    expect(none.brief).not.toHaveProperty('managedBy');
  });

  it('digest: one line in html and text; none when there is no company', () => {
    const base = { kind: 'civic', source: 'socrata-nyc-311', subtype: '311', title: HEAT_TITLE, summary: 'HEAT/HOT WATER | APARTMENT ONLY | MANHATTAN', place: 'New York City, NY', occurredAt: '2026-11-20T04:57:13Z', sourceUrl: null, label: 'act_now' as const, trade: 'hvac', deadline: null };
    const mk = (items: unknown[]) => renderDigest({ businessName: 'Test HVAC', items: items as never, totalCount: items.length, appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: new Date('2026-11-20T12:00:00Z') });
    const withCo = mk([{ ...base, managerName: 'STONEHENGE MANAGEMENT LLC', managerRole: 'agent' }]);
    expect(withCo.html.match(/Managed by: STONEHENGE MANAGEMENT LLC/g)).toHaveLength(1);
    expect(withCo.text.match(/Managed by: STONEHENGE MANAGEMENT LLC \(from the city's building registration\)/g)).toHaveLength(1);
    const without = mk([base]);
    expect(without.html).not.toContain('Managed by');
    expect(without.text).not.toContain('Managed by');
  });
});
