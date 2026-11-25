/**
 * Round 33: USAC E-Rate FCC Form 470 (lib/signals/adapters/erate.ts, erate-config.ts).
 *
 * Fixture tests/signals/__data__/erate-470-rows.json: 18 service-request lines of 9 real applications, read from
 * https://opendata.usac.org/resource/jt8s-3q52.json on 2026-11-25 (through WebFetch: the shell has no outbound network) and kept to the columns
 * Holler asks for. Every contact, address and narrative column was left out when the rows were saved. Values (names, dates, ZIPs, services)
 * are as the portal served them; the fixture has no personal data. Where a test needs a case the live rows do not have (a cancelled form, a
 * ZIP outside every served area), it changes ONE field of a real row and says so.
 *
 * The contact test feeds rows that DO carry contact and narrative columns (made-up values, flagged below) and proves none survives.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../__data__/erate-470-rows.json';
import {
  ERATE_FIELDS,
  ERATE_NEVER_READ,
  ERATE_PAGE_PAUSE_MS,
  ERATE_PAGE_SIZE,
  ERATE_PAGE_TIMEOUT_MS,
  ERATE_ROUTES,
  ERATE_TIME_BUDGET_MS,
  erateTitle,
  routeFor,
  whoFor,
} from '@/lib/signals/adapters/erate-config';
import {
  adapters,
  buildErateQuery,
  closesAt,
  formLink,
  MIN_DAYS_AHEAD,
  parseErate,
  pickAllowed,
  retireCancelled,
  tidyPlace,
} from '@/lib/signals/adapters/erate';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { DEFAULT_ADAPTER_TIMEOUT_MS, missingEnvFor } from '@/lib/signals/run';
import { BIDS_FLAG, ERATE_FLAG, bidClosed, bidHidden, dropHiddenBids, erateHidden, excludeBidsInQuery, isBidSignal, withoutHiddenBids } from '@/lib/signals/bid-sources';
import { bidCardLine } from '@/lib/signals/bid-card';
import { localizeTitle } from '@/lib/signals/title-i18n';
import { localizeSummary } from '@/lib/signals/summary-i18n';
import { briefFamilyOf, briefFor, cardBrief } from '@/lib/signals/brief';
import { briefForLang, cardBriefLang } from '@/lib/signals/brief-i18n';
import { deadlineOf, labelFor } from '@/lib/signals/lead-rules';
import { matchOne, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { bidCountsByPlace } from '@/lib/seo/bid-counts';
import { metroFor } from '@/lib/geo/metros';
import { lookupZip } from '@/lib/geo';
import { FakeDb } from '../../ops/fakedb';
import { BANNED } from '../banned';
import type { Db } from '@/lib/signals/store';
import type { AdapterContext } from '@/lib/signals/types';

const ROWS = fixture as Array<Record<string, unknown>>;
const NOW = new Date('2026-11-25T18:00:00Z');
const byApp = (id: string) => ROWS.filter((r) => r.application_number === id);
const one = (rows: Array<Record<string, unknown>>, now = NOW) => parseErate(rows, { now });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/**
 * A stand-in for the portal that reads the SAME query string the adapter sends (decoded, so +, %27 and %24 are exercised) and answers like
 * SODA 2 for ONE documented shape, and answers 400 for anything else:
 *   $select  a non-empty list of the columns in ERATE_FIELDS (nothing else; a name, city, contact or narrative column is refused)
 *   $where   exactly four clauses, each once: fcc_form_470_status in('Certified','Canceled'), function in('Cabling'),
 *            service_type in('Internal Connections'), allowable_contract_date>='YYYY-MM-DDT00:00:00'
 *   $order   allowable_contract_date, application_number and :id, each optionally DESC
 *   $limit   1 to 5000 (required)   $offset  a multiple of the limit   no other parameter
 * It is not the portal: whether the live portal accepts the combined query is stated in the PR, not proved here.
 */
function fakePortal(rows: Array<Record<string, unknown>>, seen: URLSearchParams[] = []): typeof fetch {
  const selectable = new Set<string>(ERATE_FIELDS);
  const LITERALS: Record<string, string[]> = {
    fcc_form_470_status: ['Certified', 'Canceled'],
    function: ['Cabling'],
    service_type: ['Internal Connections'],
  };
  return (async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    if (u.origin + u.pathname !== 'https://opendata.usac.org/resource/jt8s-3q52.json') return new Response('not found', { status: 404 });
    const q = u.searchParams;
    seen.push(q);
    const bad = (why: string) => new Response(JSON.stringify({ error: true, message: why }), { status: 400 });
    for (const k of q.keys()) if (!['$select', '$where', '$order', '$limit', '$offset'].includes(k)) return bad(`parameter ${k}`);
    const select = (q.get('$select') ?? '').split(',');
    if (select.length === 0 || select.some((c) => !selectable.has(c))) return bad('select');
    let out = rows.map((r, i) => ({ r, i }));
    const clauses = (q.get('$where') ?? '').split(' AND ');
    const seenCols = new Set<string>();
    for (const clause of clauses) {
      let m: RegExpExecArray | null;
      if ((m = /^(fcc_form_470_status|function|service_type) in\(('[^']+'(?:,'[^']+')*)\)$/.exec(clause))) {
        const col = m[1];
        const vals = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
        if (seenCols.has(col) || vals.some((v) => !LITERALS[col].includes(v))) return bad(`where: ${clause}`);
        seenCols.add(col);
        out = out.filter((x) => vals.includes(String(x.r[col])));
      } else if ((m = /^allowable_contract_date>='(\d{4}-\d{2}-\d{2})T00:00:00'$/.exec(clause))) {
        if (seenCols.has('allowable_contract_date') || Number.isNaN(Date.parse(m[1]))) return bad(`where: ${clause}`);
        seenCols.add('allowable_contract_date');
        out = out.filter((x) => typeof x.r.allowable_contract_date === 'string' && (x.r.allowable_contract_date as string) >= `${m![1]}T00:00:00`);
      } else return bad(`where: ${clause}`);
    }
    if (seenCols.size !== 4) return bad('where: a clause is missing');
    const order = (q.get('$order') ?? '').split(',').filter(Boolean).map((x) => x.trim().split(/\s+/));
    if (order.length === 0 || order.some(([c, d]) => !['allowable_contract_date', 'application_number', ':id'].includes(c) || (d !== undefined && d.toUpperCase() !== 'DESC' && d.toUpperCase() !== 'ASC'))) return bad('order');
    const val = (x: { r: Record<string, unknown>; i: number }, col: string) => (col === ':id' ? String(x.i).padStart(9, '0') : String(x.r[col] ?? ''));
    out.sort((a, b) => {
      for (const [col, dir] of order) {
        const x = val(a, col);
        const y = val(b, col);
        if (x !== y) return (x < y ? -1 : 1) * (dir?.toUpperCase() === 'DESC' ? -1 : 1);
      }
      return 0;
    });
    const limit = Number(q.get('$limit'));
    const offset = Number(q.get('$offset') ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000 || !Number.isInteger(offset) || offset < 0 || offset % limit !== 0) return bad('paging');
    const page = out.slice(offset, offset + limit).map(({ r }) => Object.fromEntries(select.filter((c) => c in r).map((c) => [c, r[c]])));
    return new Response(JSON.stringify(page), { status: 200 });
  }) as unknown as typeof fetch;
}

describe('field mapping on real rows', () => {
  const rep = one(ROWS);

  it('keeps the four open, served, cabling-installation requests and nothing else', () => {
    expect(rep.rows).toBe(18);
    expect(rep.applications).toBe(9);
    expect(rep.items.map((i) => i.externalId).sort()).toEqual(['270002974', '270003493', '270004329', '270005737']);
    // dropped: 4 whose date has passed (2015, 2017, two libraries in spring 2026) and Evanston, whose only routed line was maintenance
    expect(rep.closed).toBe(4);
    expect(rep.noTrade).toBe(1);
    expect(rep.notServed).toBe(0);
    expect(rep.cancelled).toEqual([]);
  });

  it('maps a school with a cabling installation line', () => {
    const i = rep.items.find((x) => x.externalId === '270003493')!;
    expect(i).toMatchObject({
      source: 'bids-erate',
      kind: 'contract',
      title: 'A school in Astoria is asking for bids on network cabling',
      summary: 'E-Rate request (FCC Form 470) | contract may be signed from 2026-12-01',
      url: 'https://publicdata.usac.org/EPC/Prd/Form470/270003493/11475/22877131-USAC_FCC_FORM_470_APPLICATION_270003493_CERTIFIED.pdf',
      city: 'Astoria',
      state: 'NY',
      zip: '11103',
      categories: ['electrical'],
      severity: 2,
      occurredAt: '2026-11-03T15:12:24.000Z',
      // the START of Dec 1 (00:00 UTC): from that day a contract may be signed, so the heads-up window is over. No grace hours.
      expiresAt: '2026-12-01T00:00:00.000Z',
    });
    expect(i.data).toMatchObject({
      subtype: 'bid',
      dataset: 'jt8s-3q52',
      solicitationId: '270003493',
      bidType: 'E-Rate Form 470',
      who: 'school',
      work: 'cabling',
      fundingYear: '2027',
      contractFrom: '2026-12-01',
      loc: 'approx',
      approxLocation: true,
    });
    const z = lookupZip('11103')!;
    expect([i.lat, i.lon]).toEqual([z.lat, z.lon]);
  });

  it('stores only mapped values: the who the card says and a four-digit year, never the portal text', () => {
    for (const i of rep.items) {
      const d = i.data as Record<string, unknown>;
      expect(d).not.toHaveProperty('applicantType');
      expect(['school', 'school-district', 'library', 'library-system', 'consortium', 'either']).toContain(d.who);
      expect(d.fundingYear).toMatch(/^20\d{2}$/);
    }
  });

  it('drops Evanston (cabling bought without installation; its maintenance line no longer routes) and says so in the counts', () => {
    expect(rep.items.find((x) => x.externalId === '270001007')).toBeUndefined();
  });

  it('never stores the institution name or the applicant\'s city: the title city is the ZIP table\'s and no buyer key exists', () => {
    for (const i of rep.items) {
      expect(i.data).not.toHaveProperty('buyer');
      expect(i.city).toBe(lookupZip(i.zip!)!.city);
      expect(i.title).toContain(` in ${i.city} is asking`);
    }
    expect(JSON.stringify(rep)).not.toMatch(/Catholic|Academy|BOCES|Prince of Peace|Southern Westchester/i);
  });

  it('prints a consortium and a district by what they are', () => {
    expect(rep.items.find((x) => x.externalId === '270004329')!.title).toBe('A group of schools and libraries in Harrison is asking for bids on network cabling');
    const chi = rep.items.find((x) => x.externalId === '270002974')!;
    expect(chi.summary).toBe('E-Rate request (FCC Form 470) | contract may be signed from 2026-12-14');
  });

  it("links to the form on USAC's own host, else to the dataset page", () => {
    expect(formLink('https://publicdata.usac.org/EPC/Prd/Form470/1/2/x.pdf')).toBe('https://publicdata.usac.org/EPC/Prd/Form470/1/2/x.pdf');
    expect(formLink('http://publicdata.usac.org/x.pdf')).toBeNull();
    expect(formLink('https://evil.example.com/usac.org/x.pdf')).toBeNull();
    expect(formLink('javascript:alert(1)')).toBeNull();
    const noLink = ROWS.filter((r) => r.application_number === '270005737').map((r) => ({ ...r, form_pdf: undefined }));
    expect(one(noLink).items[0].url).toBe('https://opendata.usac.org/d/jt8s-3q52');
    // the raw API gives {url}; a flattened string works too
    const flat = ROWS.filter((r) => r.application_number === '270005737').map((r) => ({ ...r, form_pdf: (r.form_pdf as { url: string }).url }));
    expect(one(flat).items[0].url).toMatch(/^https:\/\/publicdata\.usac\.org\//);
  });

  it('is a bid row for every bid rule, with its own switch name', () => {
    const i = rep.items.find((x) => x.externalId === '270003493')!;
    expect(isBidSignal({ source: i.source, data: i.data as { subtype?: unknown } })).toBe(true);
    const row = { source: i.source, subtype: 'bid', expires_at: i.expiresAt };
    expect(bidHidden(row, false, NOW.getTime(), true)).toBe(true);
    expect(bidHidden(row, true, NOW.getTime(), true)).toBe(false);
    // closes at the start of its allowable date, with no grace
    expect(bidHidden(row, true, Date.parse('2026-11-30T23:59:59Z'), true)).toBe(false);
    expect(bidHidden(row, true, Date.parse('2026-12-01T00:00:00Z'), true)).toBe(true);
  });

  it('places the card at the ZIP centre and the metro follows', () => {
    const ny = rep.items.find((x) => x.externalId === '270003493')!;
    expect(metroFor(ny.lat!, ny.lon!, ny.state)).toBe('new-york');
    const plano = rep.items.find((x) => x.externalId === '270005737')!;
    expect(metroFor(plano.lat!, plano.lon!, plano.state)).toBe('dallas-fort-worth');
    const chi = rep.items.find((x) => x.externalId === '270002974')!;
    expect(metroFor(chi.lat!, chi.lon!, chi.state)).toBe('chicago');
  });
});

describe('the allowable contract date is the earliest contract day, not a deadline (review P1-1)', () => {
  const rep = one(ROWS);
  const ny = rep.items.find((x) => x.externalId === '270003493')!;
  const open = (now: string) => one(ROWS, new Date(now)).items.map((i) => i.externalId);

  it('is never stored as dueDate, so no deadline reads it', () => {
    for (const i of rep.items) {
      const d = i.data as Record<string, unknown>;
      expect(d).not.toHaveProperty('dueDate');
      expect(d.contractFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(deadlineOf({ source: i.source, data: d, expires_at: i.expiresAt })).toBeNull();
    }
  });

  it('is a heads-up, never act now, for the electrical trade', () => {
    expect(labelFor({ source: ny.source, kind: ny.kind, subtype: 'bid', title: ny.title, summary: ny.summary }, 'electrical')).toBe('coming_soon');
  });

  it('never says due, deadline-as-fact, days left or closes within 24 hours, on any day up to the date', () => {
    for (const now of ['2026-11-25T18:00:00Z', '2026-11-30T12:00:00Z', '2026-11-30T23:30:00Z']) {
      for (const lang of ['en', 'es'] as const) {
        const line = bidCardLine({ dueDate: null, expiresAt: ny.expiresAt, source: 'bids-erate' }, new Date(now), lang);
        expect(line).not.toMatch(/\bDue\b|vence|days? left|faltan?|closes within|cierra en menos|Bids accepted|Se aceptan ofertas/i);
        expect(line).toContain(lang === 'en' ? 'ask the school or library for its bid deadline' : 'pregunte a la escuela o biblioteca por su fecha límite para ofertas');
      }
    }
  });

  it('drops a request whose date is today, past, tomorrow or less than two days away, and keeps one two or more days out (review 2 finding 6)', () => {
    const withDate = (d: string) => byApp('270003493').map((r) => ({ ...r, allowable_contract_date: `${d}T00:00:00.000` }));
    expect(one(withDate('2026-11-24')).items).toEqual([]);
    expect(one(withDate('2026-11-25')).items).toEqual([]); // today
    expect(one(withDate('2026-11-26')).items).toEqual([]); // tomorrow, 6 hours from NOW
    expect(one(withDate('2026-11-27')).items).toEqual([]); // 30 hours: under two days
    expect(one(withDate('2026-11-28')).items).toHaveLength(1); // 54 hours
    // the edge is 48 hours exactly: 2026-11-28T00:00Z is kept from 2026-11-26T00:00Z and dropped a second later
    expect(one(withDate('2026-11-28'), new Date('2026-11-26T00:00:00Z')).items).toHaveLength(1);
    expect(one(withDate('2026-11-28'), new Date('2026-11-26T00:00:01Z')).items).toEqual([]);
    expect(MIN_DAYS_AHEAD).toBe(2);
    expect(one(withDate('2026-11-27')).closed).toBe(1);
  });

  it('a stored row closes at the start of its date', () => {
    // with a clock inside the window the card is ingested; the stored row then closes at the start of its date (bidClosed below)
    expect(open('2026-11-29T00:00:00Z')).toContain('270003493');
    expect(open('2026-11-30T00:00:01Z')).not.toContain('270003493');
    expect(open('2026-12-12T00:00:00Z')).toContain('270002974');
    expect(open('2026-12-12T00:00:01Z')).not.toContain('270002974');
    expect(bidClosed({ source: ny.source, subtype: 'bid', expires_at: ny.expiresAt }, Date.parse('2026-12-01T00:00:00Z'))).toBe(true);
    expect(bidClosed({ source: ny.source, subtype: 'bid', expires_at: ny.expiresAt }, Date.parse('2026-11-30T23:59:59Z'))).toBe(false);
  });

  it('drops past requests from the live fixture (2015, 2017, spring 2026)', () => {
    for (const gone of ['160003906', '170063985', '260026114', '260024231']) expect(rep.items.map((i) => i.externalId)).not.toContain(gone);
    expect(rep.closed).toBe(4);
  });

  it('drops a missing date and one more than 120 days out (not a real 28 day window)', () => {
    const nodate = byApp('270003493').map((r) => ({ ...r, allowable_contract_date: undefined }));
    expect(one(nodate).items).toEqual([]);
    const far = byApp('270003493').map((r) => ({ ...r, allowable_contract_date: '2027-12-01T00:00:00.000' }));
    expect(one(far).items).toEqual([]);
  });

  it('asks the portal for requests from today on, newest date first, in pages', () => {
    const q = buildErateQuery(NOW);
    expect(q.get('$where')).toContain("allowable_contract_date>='2026-11-25T00:00:00'");
    expect(q.get('$where')).toContain("fcc_form_470_status in('Certified','Canceled')");
    expect(q.get('$where')).toContain("service_type in('Internal Connections')");
    expect(q.get('$order')).toBe('allowable_contract_date DESC,application_number DESC,:id');
    expect(q.get('$limit')).toBe(String(ERATE_PAGE_SIZE));
    expect(q.has('$offset')).toBe(false);
    expect(buildErateQuery(NOW, 5000).get('$offset')).toBe('5000');
    expect(closesAt('2026-12-01')).toBe(Date.parse('2026-12-01T00:00:00Z'));
  });
});

describe('served-area filter', () => {
  it('keeps ZIPs in a served area (the real isServedZip) and counts the rest', () => {
    const rep = one(ROWS);
    expect(rep.items.map((i) => i.state).sort()).toEqual(['IL', 'NY', 'NY', 'TX']);
  });

  it('drops a real row moved to a ZIP outside every served area (one field changed: Bloomington IL 61701) and counts it', () => {
    const moved = byApp('270003493').map((r) => ({ ...r, billed_entity_zip: '61701', billed_entity_state: 'IL', billed_entity_city: 'BLOOMINGTON' }));
    const rep = one(moved);
    expect(rep.items).toEqual([]);
    expect(rep.notServed).toBe(1);
  });

  it('drops a ZIP that does not belong to the state the row says, an unknown ZIP and a missing ZIP', () => {
    const wrongState = byApp('270003493').map((r) => ({ ...r, billed_entity_state: 'TX' }));
    expect(one(wrongState).items).toEqual([]);
    for (const zip of ['00000', 'abc', '', undefined]) {
      expect(one(byApp('270003493').map((r) => ({ ...r, billed_entity_zip: zip }))).items).toEqual([]);
    }
  });

  it('uses the served test it is given', () => {
    const none = parseErate(ROWS, { now: NOW, served: () => false });
    expect(none.items).toEqual([]);
    expect(none.notServed).toBe(4);
    const all = parseErate(ROWS, { now: NOW, served: () => true });
    expect(all.items).toHaveLength(4);
  });

  it('accepts a ZIP+4 and uses the first five digits', () => {
    const plus4 = byApp('270005737').map((r) => ({ ...r, billed_entity_zip: '75093-1234' }));
    expect(one(plus4).items[0].zip).toBe('75093');
  });
});

describe('trade routing (documented in erate-config.ts)', () => {
  const SERVICE_TYPES = ['Internal Connections', 'Basic Maintenance of Internal Connections', 'Managed Internal Broadband Services', 'Data Transmission and/or Internet Access'];
  // every function that appears on open rows today (2026-11-25)
  const FUNCTIONS = [
    'Switches and Necessary Software and Licenses', 'Switches', 'Internet Access and Data Transmission Service', 'Cabling',
    'Wireless Access Points and Necessary Software and Licenses', 'Wireless Access Points', 'Antennas, Connectors, and Related Components', 'Existing Equipment',
    'Uninterruptable Power Supply/Battery Backup and Necessary Software and Licenses', 'Uninterruptable Power Supply/Battery Backup',
    'Firewall Service, Components, and Necessary Software and Licenses', 'Firewall Service and Components', 'Racks', 'Standalone Data Transmission Service',
    'Category One Network Equipment', 'Wireless Controllers and Necessary Software and Licenses', 'Wireless Controllers', 'Category One Maintenance and Operations',
    'Leased Dark Fiber', 'Leased Lit Fiber', 'Routers and Necessary Software and Licenses', 'Routers', 'Standalone Internet Access Service', 'Leased Equipment',
    'Services Provided Over Third-Party Networks', 'Self-provisioned Network (Applicant Owned and Operated Network)', 'Caching and Necessary Software and Licenses', 'Caching',
    'Cellular Data Plan/Air Card Service',
  ];

  it('routes exactly one service/function pair, installation cabling, to electrical; Basic Maintenance routes to nothing', () => {
    const hits: string[] = [];
    for (const st of SERVICE_TYPES) for (const fn of FUNCTIONS) for (const inst of [true, false]) {
      const r = routeFor({ service_type: st, function: fn, installation_initial: inst });
      if (r) hits.push(`${st} | ${fn} | ${inst}`);
    }
    expect(hits).toEqual(['Internal Connections | Cabling | true']);
    for (const r of ERATE_ROUTES) {
      expect(r.trades).toEqual(['electrical']);
      expect(r.trades).not.toContain('security');
      expect(r.trades).not.toContain('general-contractor');
    }
  });

  it('the query asks only for the one service type', () => {
    const where = buildErateQuery(NOW).get('$where') ?? '';
    expect(where).toContain("service_type in('Internal Connections')");
    expect(where).not.toContain('Basic Maintenance');
  });

  it('a maintenance-only application (Evanston: its install line buys cable with no installation) routes nowhere', () => {
    const rep = one(byApp('270001007'));
    expect(rep.items).toEqual([]);
    expect(rep.noTrade).toBe(1);
  });

  it('equipment and carrier lines of a served school route nowhere (Evanston without any cabling line)', () => {
    const only = byApp('270001007').filter((r) => r.function !== 'Cabling');
    expect(one(only).noTrade).toBe(1);
    expect(one(only).items).toEqual([]);
  });

  it('names the applicant as the portal types it', () => {
    expect(['School', 'School District', 'Library', 'Library System', 'Consortium', 'Other', undefined].map(whoFor)).toEqual([
      'school', 'school-district', 'library', 'library-system', 'consortium', 'either', 'either',
    ]);
  });
});

describe('contact fields and free text never survive ingest (review P1-3)', () => {
  // MADE-UP values, flagged so they can be searched for. They sit in the columns the portal really has (contact, technical contact,
  // authorized person, billed entity email and phone, street address, consulting firm, narrative text).
  const SECRETS = [
    'Pat Quillfeather', 'pquillfeather@example.org', '404-555-0142', '(212) 555-0199', 'Robin Tanglewood', 'rtanglewood@gmail.example',
    '14 Zebra Lane', 'Marki Dixonwell', 'Director of Procurement Test', 'fundsforlearning-test@example.net', 'See the RFP at http://secret.example.org/rfp',
    'call Sam Brightwater at 770 555 0123', 'sbrightwater@example.com',
  ];
  const withContacts = (r: Record<string, unknown>): Record<string, unknown> => ({
    ...r,
    contact_name: SECRETS[0], contact_email: SECRETS[1], contact_phone: SECRETS[2], contact_address1: SECRETS[6], contact_city: 'Atlanta',
    technical_contact_name: SECRETS[4], technical_contact_email: SECRETS[5], technical_contact_phone: SECRETS[3], technical_contact_title: 'IT lead',
    authorized_person_name: SECRETS[7], authorized_person_email: SECRETS[1], authorized_person_phone: SECRETS[2], authorized_person_title: SECRETS[8],
    authorized_person_address: SECRETS[6], authorized_person_employer: SECRETS[0],
    billed_entity_email: SECRETS[12], billed_entity_phone: SECRETS[2], ben_address_1: SECRETS[6], ben_address_2: 'Suite 9', website_url: 'http://secret.example.org',
    consulting_firm_data: `{Funds for Learning|16024808|${SECRETS[2]}|${SECRETS[9]}}`,
    category_one_description: `${SECRETS[10]}. ${SECRETS[11]}`, category_two_description: SECRETS[11], state_or_local_restrictions_1: SECRETS[10],
    other_function: SECRETS[11], rfp_documents: { url: 'https://publicdata.usac.org/secret-rfp.pdf' }, form_nickname: SECRETS[0],
  });

  it('pickAllowed copies only the allowed columns', () => {
    const picked = pickAllowed(withContacts(ROWS[5]));
    expect(Object.keys(picked).every((k) => (ERATE_FIELDS as readonly string[]).includes(k))).toBe(true);
    expect(Object.keys(picked).some((k) => ERATE_NEVER_READ.includes(k))).toBe(false);
  });

  it('no stored record, summary, title, link or data field holds a contact value (contact columns on every row)', () => {
    const rep = parseErate(ROWS.map(withContacts), { now: NOW });
    expect(rep.items).toHaveLength(4);
    const blob = JSON.stringify(rep);
    for (const s of SECRETS) expect(blob.toLowerCase()).not.toContain(s.toLowerCase());
    expect(blob).not.toMatch(/@/);
    expect(blob).not.toMatch(/\d{3}[-. )]+\d{3}[-. ]\d{4}/);
    expect(blob).not.toContain('secret.example');
    for (const i of rep.items) {
      expect(i).not.toHaveProperty('contacts');
      expect(i).not.toHaveProperty('licenseRefs');
      expect(Object.keys(i.data ?? {}).some((k) => ERATE_NEVER_READ.includes(k) || /contact|email|phone|address/i.test(k))).toBe(false);
    }
  });

  it('the query never asks for a contact, address or narrative column, and the allow list overlaps none of them', () => {
    const q = buildErateQuery(NOW);
    const asked = (q.get('$select') ?? '').split(',');
    expect(asked).toEqual([...ERATE_FIELDS]);
    for (const bad of ERATE_NEVER_READ) {
      expect(asked).not.toContain(bad);
      expect(q.get('$where') ?? '').not.toContain(bad);
    }
    for (const f of ERATE_FIELDS) expect(ERATE_NEVER_READ).not.toContain(f);
  });

  // The review's attack names and cities. By owner decision (review 2) neither column is requested, printed or stored, so these prove it three
  // ways: the query does not select them, the portal stand-in (which refuses any other column) returns none, and a portal that returned them
  // anyway (parseErate called directly) still leaves them out of every stored field.
  const ATTACK_NAMES = [
    'Maria Lopez Home Day Care', 'Jane Doe Learning Center', 'Lincoln High School attn John Smith', 'Lincoln Public Library, Jane Doe Director',
    'Lincoln School jsmith at gmail dot com', 'Lincoln School 404-555-0142', 'Jane Doe School', 'Jane Doe Charter School', 'Saoirse Okonjo School',
    'Mrs Jane Doe School', 'John Smith Lincoln High School', 'Jane Doe Plano ISD', 'Jane Doe School District', 'Jsmith At Aol Com Lincoln School',
    'Prince of Peace Catholic School', 'Dallas ISD',
  ];
  const ATTACK_CITIES = ['Astoria call Jane Doe 212-555-0199', 'jane.doe@gmail.com', 'Saoirse Okonjo', 'Astoria Jane Doe', 'x'.repeat(60), 'Astoria (call Pat)'];
  const PERSON_BITS = /Jane|Maria|Lopez|John|Smith|jsmith|Doe\b|Saoirse|Okonjo|Pat\b|Quillfeather|404|555|gmail|aol|Catholic|Dallas ISD|Peace|x{10}/;

  it('the reader asks for neither the name nor the city column', () => {
    const asked = (buildErateQuery(NOW).get('$select') ?? '').split(',');
    expect(asked).not.toContain('billed_entity_name');
    expect(asked).not.toContain('billed_entity_city');
    expect(ERATE_NEVER_READ).toContain('billed_entity_name');
    expect(ERATE_NEVER_READ).toContain('billed_entity_city');
  });

  it.each(ATTACK_NAMES.flatMap((n) => ATTACK_CITIES.slice(0, 3).map((c) => [n, c] as const)))('prints and stores neither %j nor the city %j', async (name, city) => {
    const rows = byApp('270003493').map((r) => ({ ...r, billed_entity_name: name, billed_entity_city: city }));
    const out = await adapters[0].fetch(ctx({ [BIDS_FLAG]: '1', [ERATE_FLAG]: '1' }, fakePortal(rows)));
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('A school in Astoria is asking for bids on network cabling');
    expect(out[0].summary).toBe('E-Rate request (FCC Form 470) | contract may be signed from 2026-12-01');
    expect(out[0].city).toBe('Astoria');
    expect(JSON.stringify(out)).not.toMatch(PERSON_BITS);
    // a portal that ignored $select and sent the columns anyway
    const direct = one(rows);
    expect(direct.items).toHaveLength(1);
    expect(JSON.stringify(direct)).not.toMatch(PERSON_BITS);
    expect(direct.items[0].title).toBe('A school in Astoria is asking for bids on network cabling');
  });

  it.each(ATTACK_CITIES)('uses the ZIP table city whatever the portal city says: %j', (city) => {
    const rows = byApp('270003493').map((r) => ({ ...r, billed_entity_city: city }));
    expect(one(rows).items[0].title).toBe('A school in Astoria is asking for bids on network cabling');
    expect(one(rows).items[0].city).toBe('Astoria');
  });

  it('stores applicant_type and funding_year only as mapped values', async () => {
    const rows = byApp('270003493').map((r) => ({ ...r, applicant_type: 'School call Jane Doe 212-555-0199', funding_year: '2027 call Jane Doe' }));
    const out = await adapters[0].fetch(ctx({ [BIDS_FLAG]: '1', [ERATE_FLAG]: '1' }, fakePortal(rows)));
    const d = out[0].data as Record<string, unknown>;
    expect(d.who).toBe('either');
    expect(d.fundingYear).toBeNull();
    expect(out[0].title).toBe('A school or library in Astoria is asking for bids on network cabling');
    expect(JSON.stringify(out)).not.toMatch(/Jane|555/);
  });

  it('rebuilds the form link from host and path: no user info, query, fragment or port, https only', () => {
    expect(formLink('https://jane.doe%40gmail.com@publicdata.usac.org/EPC/x.pdf?tel=212-555-0199#frag')).toBe('https://publicdata.usac.org/EPC/x.pdf');
    expect(formLink('https://user:pass@publicdata.usac.org/EPC/x.pdf')).toBe('https://publicdata.usac.org/EPC/x.pdf');
    expect(formLink('https://publicdata.usac.org/EPC/x.pdf?a=b')).toBe('https://publicdata.usac.org/EPC/x.pdf');
    expect(formLink('https://publicdata.usac.org:8443/EPC/x.pdf')).toBeNull();
    expect(formLink('http://publicdata.usac.org/EPC/x.pdf')).toBeNull();
    expect(formLink('https://publicdata.usac.org/EPC/jane@gmail.com.pdf')).toBeNull();
    expect(formLink('https://publicdata.usac.org/EPC/%0d%0aX.pdf')).toBeNull();
    expect(formLink('https://publicdata.usac.org/')).toBeNull();
    const rows = byApp('270003493').map((r) => ({ ...r, form_pdf: { url: 'https://jane.doe%40gmail.com@publicdata.usac.org/EPC/x.pdf?tel=212-555-0199' } }));
    const rep = one(rows);
    expect(rep.items[0].url).toBe('https://publicdata.usac.org/EPC/x.pdf');
    expect(JSON.stringify(rep)).not.toMatch(/gmail|555|tel=/);
  });

  it('the fixture itself holds no contact column (it keeps the portal\'s own name and city values, which the reader never requests)', () => {
    for (const r of ROWS) for (const k of Object.keys(r)) if (k !== 'billed_entity_name' && k !== 'billed_entity_city') expect(ERATE_NEVER_READ).not.toContain(k);
    expect(JSON.stringify(ROWS)).not.toMatch(/@/);
  });
});

describe('card copy in English and Spanish', () => {
  const rep = parseErate(ROWS, { now: NOW });
  const ny = rep.items.find((x) => x.externalId === '270003493')!;
  const chi = rep.items.find((x) => x.externalId === '270002974')!;
  const brief = { source: ny.source, kind: ny.kind, subtype: 'bid', title: ny.title, summary: ny.summary, label: 'coming_soon' as const, trade: 'electrical', url: ny.url, occurredAt: ny.occurredAt };

  it('says in plain words what it is, in English', () => {
    expect(ny.title).toBe('A school in Astoria is asking for bids on network cabling');
    expect(erateTitle('library', 'Mount Vernon', 'cabling')).toBe('A library in Mount Vernon is asking for bids on network cabling');
    const card = cardBrief(brief);
    expect(card.family).toBe('school-bid');
    expect(card.why).toBe('A school or library is asking for bids on cabling; nothing is awarded.');
    expect(card.why.length).toBeLessThanOrEqual(80);
    expect(card.uncertain).toBe('High confidence the request is listed; only USAC-registered providers (a SPIN) are paid.');
    expect(card.uncertain.length).toBeLessThanOrEqual(88);
    expect(card.next).toBe('Read the whole request; it may cover more than cabling.');
    expect(card.source.label).toBe('E-Rate school and library network bids (USAC FCC Form 470)');
    expect(card.source.linkText).toBe('Open the public source');
    expect(card.source.recordLink).toBe(true);
  });

  it('the card line gives the earliest contract day, sends the member to the school for the bid deadline, and says who can be paid', () => {
    // a stored row that somehow held a buyer still prints none
    expect(bidCardLine({ buyer: 'St Joseph Catholic Academy', dueDate: null, expiresAt: ny.expiresAt, source: 'bids-erate' }, NOW, 'en')).toBe(
      'A contract may be signed from Dec 1, 2026; ask the school or library for its bid deadline. Only providers registered with USAC (a SPIN) can be paid for E-Rate work.',
    );
    expect(bidCardLine({ dueDate: null, expiresAt: chi.expiresAt, source: 'bids-erate' }, NOW, 'en')).toBe(
      'A contract may be signed from Dec 14, 2026; ask the school or library for its bid deadline. Only providers registered with USAC (a SPIN) can be paid for E-Rate work.',
    );
    // other bids keep their wording
    expect(bidCardLine({ buyer: 'Water & Power', dueDate: '2026-12-01', expiresAt: '2026-12-02T10:00:00.000Z', source: 'bids-la' }, NOW, 'en')).toBe('Buyer: Water & Power. Due Dec 1, 2026, 7 days left.');
  });

  it('says the same in Spanish: title, summary, line, brief and source', () => {
    expect(localizeTitle(ny.title, 'es', ny.source)).toBe('Una escuela en Astoria pide ofertas para cableado de red');
    expect(localizeTitle(chi.title, 'es', chi.source)).toBe('Un distrito escolar en Chicago pide ofertas para cableado de red');
    expect(localizeTitle(rep.items.find((x) => x.externalId === '270004329')!.title, 'es', 'bids-erate')).toBe(
      'Un grupo de escuelas y bibliotecas en Harrison pide ofertas para cableado de red',
    );
    expect(localizeSummary(ny.summary, 'es', ny.source)).toBe('Solicitud E-Rate (formulario 470 de la FCC) | se puede firmar un contrato a partir del 1 dic 2026');
    expect(bidCardLine({ buyer: 'St Joseph Catholic Academy', dueDate: null, expiresAt: ny.expiresAt, source: 'bids-erate' }, NOW, 'es')).toBe(
      'Se puede firmar un contrato a partir del 1 dic 2026; pregunte a la escuela o biblioteca por su fecha límite para ofertas. Solo se paga por trabajo de E-Rate a proveedores registrados en USAC (con un SPIN).',
    );
    const card = cardBriefLang(brief, 'es');
    expect(card.why).toBe('Una escuela o biblioteca pide ofertas para cableado; aún no se ha adjudicado.');
    expect(card.uncertain).toContain('la solicitud está publicada');
    expect(card.uncertain).toContain('solo se paga a proveedores registrados en USAC (un SPIN)');
    expect(card.next).toBe('Lea toda la solicitud; puede incluir más que cableado.');
    expect(card.source.label).toBe('Ofertas de red de escuelas y bibliotecas (E-Rate, formulario 470 de USAC)');
    expect(card.source.linkText).toBe('Abrir la fuente pública');
  });

  it('English rebuilds to itself and every other family is untouched', () => {
    expect(localizeTitle(ny.title, 'en', ny.source)).toBe(ny.title);
    expect(briefFamilyOf({ source: 'bids-la' })).toBe('city-bid');
    expect(briefFamilyOf({ source: 'bids-erate' })).toBe('school-bid');
    expect(briefForLang({ source: 'bids-erate', label: 'coming_soon', trade: 'electrical' }, 'en')).toEqual(briefFor({ source: 'bids-erate', label: 'coming_soon', trade: 'electrical' }));
  });

  it('follows the copy rules in both languages: no banned words, no em-dash, no claim about who wins or who may bid', () => {
    const texts: string[] = [];
    for (const i of rep.items) {
      for (const lang of ['en', 'es'] as const) {
        texts.push(localizeTitle(i.title, lang, i.source), localizeSummary(i.summary, lang, i.source) ?? '');
        texts.push(bidCardLine({ expiresAt: i.expiresAt, source: i.source }, NOW, lang));
        for (const label of ['coming_soon', 'act_now'] as const) {
          const c = cardBriefLang({ source: i.source, subtype: 'bid', title: i.title, summary: i.summary, label, trade: 'electrical', url: i.url, occurredAt: i.occurredAt }, lang);
          texts.push(c.why, c.next, c.uncertain, c.source.label, c.source.linkText);
        }
      }
    }
    for (const who of ['school', 'school-district', 'library', 'library-system', 'consortium', 'either'] as const) texts.push(localizeTitle(erateTitle(who, 'X', 'cabling'), 'es', 'bids-erate'));
    for (const text of texts) {
      expect(text.length).toBeGreaterThan(0);
      for (const re of BANNED) expect(text, text).not.toMatch(re);
      expect(text).not.toMatch(/\b(?:cliente potencial|garantizad[oa]|canvass|knock)\b/i);
    }
    for (const who of ['school', 'school-district', 'library', 'library-system', 'consortium', 'either'] as const) {
      expect(localizeTitle(erateTitle(who, 'X', 'cabling'), 'es', 'bids-erate')).toMatch(/ en X pide ofertas para cableado de red$/);
    }
  });

  it('keeps a row whose title is not an E-Rate title as it is', () => {
    expect(localizeTitle('A school in Astoria is asking for bids on lunch trays', 'es', 'bids-erate')).toBe('A school in Astoria is asking for bids on lunch trays');
  });
});

describe('HOLLER_ERATE_ENABLED hides stored rows at once (review P1-2)', () => {
  const ny = parseErate(ROWS, { now: NOW }).items.find((x) => x.externalId === '270003493')!;
  const row = { source: ny.source, subtype: 'bid', expires_at: ny.expiresAt };
  const la = { source: 'bids-la', subtype: 'bid', expires_at: '2026-12-20T00:00:00.000Z' };
  const permit = { source: 'socrata-chicago-permits', subtype: 'permit', expires_at: null };
  const nowMs = NOW.getTime();

  it('erateHidden reads only the E-Rate source', () => {
    expect(erateHidden(row, false)).toBe(true);
    expect(erateHidden(row, true)).toBe(false);
    expect(erateHidden(la, false)).toBe(false);
    expect(erateHidden(null, false)).toBe(false);
  });

  it('bidHidden: bids on and E-Rate off hides only the E-Rate row; both on shows it; bids off hides every bid', () => {
    expect(bidHidden(row, true, nowMs, false)).toBe(true);
    expect(bidHidden(la, true, nowMs, false)).toBe(false);
    expect(bidHidden(row, true, nowMs, true)).toBe(false);
    expect(bidHidden(la, false, nowMs, true)).toBe(true);
    expect(bidHidden(permit, true, nowMs, false)).toBe(false);
  });

  it('with the real env: empty switch hides, a set switch shows (the default reads at call time)', () => {
    vi.stubEnv(BIDS_FLAG, '1');
    vi.stubEnv(ERATE_FLAG, '');
    expect(bidHidden(row, undefined, nowMs)).toBe(true);
    expect(bidHidden(la, undefined, nowMs)).toBe(false);
    vi.stubEnv(ERATE_FLAG, '1');
    expect(bidHidden(row, undefined, nowMs)).toBe(false);
  });

  it('public pages (withoutHiddenBids), member reads (dropHiddenBids) and the match path drop the row', () => {
    expect(withoutHiddenBids([row, la, permit], nowMs, true, false)).toEqual([la, permit]);
    expect(withoutHiddenBids([row, la, permit], nowMs, true, true)).toEqual([row, la, permit]);
    const matches = [{ signal: row }, { signal: [la] }, { signal: permit }, { signal: null }];
    expect(dropHiddenBids(matches, true, nowMs, false).map((m) => m.signal)).toEqual([[la], permit, null]);
    const profile: MatchProfile = { user_id: 'u', categories: ['electrical'], lat: ny.lat!, lon: ny.lon!, state: 'NY', radius_mi: 25 };
    const sig: MatchSignal = { id: 1, source: ny.source, kind: ny.kind, title: ny.title, summary: ny.summary, categories: ny.categories, lat: ny.lat ?? null, lon: ny.lon ?? null, state: ny.state ?? null, severity: 2, occurred_at: ny.occurredAt, data: ny.data };
    vi.stubEnv(ERATE_FLAG, '1');
    expect(matchOne(sig, profile, true, nowMs)).not.toBeNull();
    expect(matchOne(sig, profile, true, nowMs)?.label).toBe('coming_soon');
    vi.stubEnv(ERATE_FLAG, '');
    expect(matchOne(sig, profile, true, nowMs)).toBeNull();
  });

  it('query filters: E-Rate rows are excluded in SQL while only that switch is off', () => {
    const calls: string[][] = [];
    const q = { not(col: string, op: string, v: string) { calls.push([col, op, v]); return q; } };
    excludeBidsInQuery(q, true, true);
    expect(calls).toEqual([]);
    excludeBidsInQuery(q, true, false);
    expect(calls).toEqual([['source', 'eq', 'bids-erate']]);
    calls.length = 0;
    excludeBidsInQuery(q, false, true);
    expect(calls).toEqual([['source', 'like', 'bids-%']]);
    expect(excludeBidsInQuery({ nope: 1 }, true, false)).toEqual({ nope: 1 });
  });

  it('place counts subtract the stored E-Rate rows while only that switch is off', async () => {
    const seen: string[] = [];
    const builder = (): Record<string, unknown> => {
      const b: Record<string, unknown> = {
        like: (c: string, v: string) => (seen.push(`like ${c} ${v}`), b),
        eq: (c: string, v: string) => (seen.push(`eq ${c} ${v}`), b),
        gt: () => b,
        lte: () => b,
        limit: async () => ({ data: [{ place_slug: 'astoria-ny' }], error: null }),
      };
      return b;
    };
    const sb = { from: () => ({ select: () => builder() }) };
    expect(await bidCountsByPlace(sb, nowMs, true, true)).toEqual({});
    expect(await bidCountsByPlace(sb, nowMs, true, false)).toEqual({ 'astoria-ny': 1 });
    expect(seen).toEqual(['eq source bids-erate']);
    seen.length = 0;
    expect(await bidCountsByPlace(sb, nowMs, false, true)).toEqual({ 'astoria-ny': 1 });
    expect(seen).toEqual(['like source bids-%']);
  });
});

function ctx(env: Record<string, string | undefined>, fetchImpl: typeof fetch, logs: string[] = [], extra: Partial<AdapterContext> = {}): AdapterContext {
  return { since: new Date(0), now: NOW, fetch: fetchImpl, env, log: (m) => logs.push(m), ...extra };
}

describe('cancelled forms and the row limit (review P2-6, P2-7)', () => {
  const adapter = adapters[0];
  const on = { [BIDS_FLAG]: '1', [ERATE_FLAG]: '1' };
  const cancelledRows = (id: string) => byApp(id).map((r) => ({ ...r, fcc_form_470_status: 'Canceled' }));

  it('a Canceled form is not a card and its number is reported', () => {
    const rep = one(cancelledRows('270003493'));
    expect(rep.items).toEqual([]);
    expect(rep.notOpen).toBe(1);
    expect(rep.cancelled).toEqual(['270003493']);
  });

  it('closes the stored card of a cancelled form (expires_at = now) and leaves every other row alone', async () => {
    const db = new FakeDb({
      holler_signals: [
        { id: 1, source: 'bids-erate', external_id: '270003493', expires_at: '2026-12-01T00:00:00.000Z' },
        { id: 2, source: 'bids-erate', external_id: '270005737', expires_at: '2026-12-21T00:00:00.000Z' },
        { id: 3, source: 'bids-la', external_id: '270003493', expires_at: '2026-12-01T00:00:00.000Z' },
      ],
    });
    const logs: string[] = [];
    const rows = [...cancelledRows('270003493'), ...byApp('270005737')];
    const out = await adapter.fetch(ctx(on, fakePortal(rows), logs, { db: db as unknown as Db }));
    expect(out.map((i) => i.externalId)).toEqual(['270005737']);
    const t = db.tables.holler_signals;
    expect(t[0].expires_at).toBe(NOW.toISOString());
    expect(t[1].expires_at).toBe('2026-12-21T00:00:00.000Z');
    expect(t[2].expires_at).toBe('2026-12-01T00:00:00.000Z');
    expect(logs.join('\n')).toContain('asked to close stored cards for 1 cancelled form');
    // and the stored row is now hidden everywhere the bid rules are read
    expect(bidClosed({ source: 'bids-erate', subtype: 'bid', expires_at: t[0].expires_at }, NOW.getTime())).toBe(true);
    expect(bidHidden({ source: 'bids-erate', subtype: 'bid', expires_at: t[0].expires_at }, true, NOW.getTime(), true)).toBe(true);
  });

  it('writes nothing on a dry scan, without a client, or when nothing was cancelled; a write error is logged, not thrown', async () => {
    const mk = () => new FakeDb({ holler_signals: [{ id: 1, source: 'bids-erate', external_id: '270003493', expires_at: '2026-12-01T00:00:00.000Z' }] });
    const logs: string[] = [];
    const dry = mk();
    await adapter.fetch(ctx(on, fakePortal(cancelledRows('270003493')), logs, { db: dry as unknown as Db, dry: true }));
    expect(dry.calls).toEqual([]);
    await adapter.fetch(ctx(on, fakePortal(cancelledRows('270003493')), logs));
    const none = mk();
    await adapter.fetch(ctx(on, fakePortal(byApp('270005737')), logs, { db: none as unknown as Db }));
    expect(none.calls).toEqual([]);
    const failing = mk();
    failing.failOn['holler_signals.update'] = 'permission denied';
    const l2: string[] = [];
    expect(await retireCancelled({ db: failing as unknown as Db, log: (m) => l2.push(m) }, ['270003493'], NOW)).toBe(0);
    expect(l2.join(' ')).toContain('could not close cancelled forms');
  });

  const filler = (n: number, from = 0) =>
    Array.from({ length: n }, (_, i) => ({ ...byApp('270003493')[0], application_number: String(300000000 + from + i), allowable_contract_date: '2026-12-01T00:00:00.000' }));

  it('a full page asks for the next page, newest date first, exactly a second apart (the portal Crawl-delay), and stops at a short page', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const seen: URLSearchParams[] = [];
    const stamps: number[] = [];
    const portal = fakePortal([...filler(ERATE_PAGE_SIZE), ...byApp('270005737')], seen);
    const f = (async (url: string, init: RequestInit) => (stamps.push(Date.now()), portal(url, init))) as unknown as typeof fetch;
    const logs: string[] = [];
    const p = adapter.fetch(ctx(on, f, logs));
    await vi.runAllTimersAsync();
    const out = await p;
    expect(seen.map((q) => q.get('$offset'))).toEqual([null, '5000']);
    expect(seen.every((q) => q.get('$order') === 'allowable_contract_date DESC,application_number DESC,:id')).toBe(true);
    expect(out.length).toBe(ERATE_PAGE_SIZE + 1);
    expect(stamps).toHaveLength(2);
    expect(stamps[1] - stamps[0]).toBe(ERATE_PAGE_PAUSE_MS);
    expect(ERATE_PAGE_PAUSE_MS).toBeGreaterThanOrEqual(1000); // robots.txt Crawl-delay: 1
    expect(logs.join('\n')).toContain('in 2 pages');
    expect(logs.join('\n')).not.toContain('WARNING');
  });

  it('logs a warning when the page limit is reached with rows still to read, and keeps every gap at the pause', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const seen: URLSearchParams[] = [];
    const stamps: number[] = [];
    const portal = fakePortal(filler(ERATE_PAGE_SIZE * 4 + 10), seen);
    const f = (async (url: string, init: RequestInit) => (stamps.push(Date.now()), portal(url, init))) as unknown as typeof fetch;
    const logs: string[] = [];
    const p = adapter.fetch(ctx(on, f, logs));
    await vi.runAllTimersAsync();
    await p;
    expect(seen).toHaveLength(4);
    expect(stamps.slice(1).map((t, i) => t - stamps[i])).toEqual([ERATE_PAGE_PAUSE_MS, ERATE_PAGE_PAUSE_MS, ERATE_PAGE_PAUSE_MS]);
    expect(logs.join('\n')).toMatch(/WARNING page limit reached \(4 pages of 5000 rows\)/);
  });

  it('stops paging when what is left of the time budget is under one request timeout, and says so', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const seen: URLSearchParams[] = [];
    const portal = fakePortal(filler(ERATE_PAGE_SIZE * 4), seen);
    // every page takes 15 s: page 1 ends at 15 s, page 2 (after the pause) at 31 s; 38 - 31 - 1 = 6 s is under the 20 s timeout, so no page 3
    const slow = (async (url: string, init: RequestInit) => {
      const r = await portal(url, init);
      vi.setSystemTime(Date.now() + 15_000);
      return r;
    }) as unknown as typeof fetch;
    const logs: string[] = [];
    const p = adapter.fetch(ctx(on, slow, logs));
    await vi.runAllTimersAsync();
    await p;
    expect(seen).toHaveLength(2);
    expect(logs.join('\n')).toMatch(/WARNING time budget reached after 2 pages/);
    expect(ERATE_TIME_BUDGET_MS).toBeLessThan(DEFAULT_ADAPTER_TIMEOUT_MS);
    expect(ERATE_PAGE_TIMEOUT_MS + ERATE_PAGE_PAUSE_MS).toBeLessThan(ERATE_TIME_BUDGET_MS);
  });

  it('never sends the cancelled-form write once the budget is spent (the scan has given up on the adapter)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const db = new FakeDb({ holler_signals: [{ id: 1, source: 'bids-erate', external_id: '270003493', expires_at: '2026-12-01T00:00:00.000Z' }] });
    const portal = fakePortal(cancelledRows('270003493'));
    const late = (async (url: string, init: RequestInit) => {
      const r = await portal(url, init);
      vi.setSystemTime(Date.now() + ERATE_TIME_BUDGET_MS + 1000);
      return r;
    }) as unknown as typeof fetch;
    const logs: string[] = [];
    await adapter.fetch(ctx(on, late, logs, { db: db as unknown as Db }));
    expect(db.calls).toEqual([]);
    expect(db.tables.holler_signals[0].expires_at).toBe('2026-12-01T00:00:00.000Z');
    expect(logs.join('\n')).toContain('time budget spent, cancelled forms left for the next run');
    // inside the budget the same run does write
    const db2 = new FakeDb({ holler_signals: [{ id: 1, source: 'bids-erate', external_id: '270003493', expires_at: '2026-12-01T00:00:00.000Z' }] });
    await adapter.fetch(ctx(on, portal, [], { db: db2 as unknown as Db }));
    expect(db2.calls).toContain('holler_signals.update');
  });

  it('the stand-in refuses a query outside the documented shape (name or city column, a missing clause, another literal, an unknown parameter, a bad offset)', async () => {
    const portal = fakePortal(ROWS);
    const ok = buildErateQuery(NOW);
    const call = async (mut: (q: URLSearchParams) => void) => {
      const q = new URLSearchParams(ok);
      mut(q);
      return (await portal(`https://opendata.usac.org/resource/jt8s-3q52.json?${q.toString()}`)).status;
    };
    expect(await call(() => undefined)).toBe(200);
    expect(await call((q) => q.set('$select', `${q.get('$select')},billed_entity_name`))).toBe(400);
    expect(await call((q) => q.set('$select', `${q.get('$select')},billed_entity_city`))).toBe(400);
    expect(await call((q) => q.set('$select', `${q.get('$select')},contact_email`))).toBe(400);
    expect(await call((q) => q.set('$where', (q.get('$where') ?? '').replace("'Internal Connections'", "'Internal Connections','Basic Maintenance of Internal Connections'")))).toBe(400);
    expect(await call((q) => q.set('$where', (q.get('$where') ?? '').replace(" AND function in('Cabling')", '')))).toBe(400);
    expect(await call((q) => q.set('$order', 'allowable_contract_date DESC,billed_entity_name'))).toBe(400);
    expect(await call((q) => q.set('$limit', '5001'))).toBe(400);
    expect(await call((q) => q.set('$offset', '123'))).toBe(400);
    expect(await call((q) => q.set('$group', 'application_number'))).toBe(400);
    expect(await call((q) => q.set('extra', '1'))).toBe(400);
  });
});

describe('switches and the registered adapter', () => {
  const adapter = adapters[0];

  it('is registered after the other bid sources and is off by default', () => {
    expect(ALL_ADAPTERS.find((a) => a.id === 'bids-erate')).toBe(adapter);
    expect(adapter.kind).toBe('contract');
    expect(adapter.flag).toBe(BIDS_FLAG);
    expect(adapter.extraFlags?.map((f) => f.name)).toEqual([ERATE_FLAG]);
    expect(adapter.probation).toBeUndefined();
    expect(missingEnvFor(adapter, {})).toEqual([BIDS_FLAG, ERATE_FLAG]);
  });

  it('names the switch that is off', () => {
    vi.stubEnv(BIDS_FLAG, '1');
    expect(missingEnvFor(adapter, {})).toEqual([ERATE_FLAG]);
    vi.stubEnv(ERATE_FLAG, 'yes');
    expect(missingEnvFor(adapter, {})).toEqual([]);
    vi.stubEnv(BIDS_FLAG, '');
    expect(missingEnvFor(adapter, {})).toEqual([BIDS_FLAG]);
  });

  it('makes no request with either switch off', async () => {
    for (const env of [{}, { [BIDS_FLAG]: '1' }, { [ERATE_FLAG]: '1' }, { [BIDS_FLAG]: '0', [ERATE_FLAG]: '1' }]) {
      const f = vi.fn();
      const logs: string[] = [];
      expect(await adapter.fetch(ctx(env, f as unknown as typeof fetch, logs))).toEqual([]);
      expect(f).not.toHaveBeenCalled();
      expect(logs[0]).toMatch(/skipped, HOLLER_(?:ERATE|BIDS)_ENABLED is off/);
    }
  });

  it('with both on: the real query, parsed by the portal stand-in, gives cards from the real parse path; one request, no token, the Holler agent', async () => {
    const seen: URLSearchParams[] = [];
    const calls: Array<[string, RequestInit]> = [];
    const portal = fakePortal(ROWS.map((r) => ({ ...r, contact_email: 'pquillfeather@example.org', contact_name: 'Pat Quillfeather' })), seen);
    const f = vi.fn(async (url: string, init: RequestInit) => (calls.push([url, init]), portal(url, init)));
    const logs: string[] = [];
    const out = await adapter.fetch(ctx({ [BIDS_FLAG]: '1', [ERATE_FLAG]: 'true', SOCRATA_APP_TOKEN: 'should-not-be-sent' }, f as unknown as typeof fetch, logs));
    // the stand-in applied the query: Certified/Canceled, Cabling, Internal Connections, date from today. The Evanston application (maintenance only) has an
    // Internal Connections cabling line with no installation, so it reaches the parser and routes nowhere.
    expect(out.map((i) => i.externalId).sort()).toEqual(['270002974', '270003493', '270004329', '270005737']);
    expect(f).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
    expect(seen[0].get('$select')).toBe(ERATE_FIELDS.join(','));
    const [url, init] = calls[0];
    expect(url.startsWith('https://opendata.usac.org/resource/jt8s-3q52.json?')).toBe(true);
    expect(url).not.toMatch(/contact|email|phone|authorized|address|description/i);
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/^Holler\//);
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('x-app-token');
    expect(logs.join(' ')).toContain('4 kept');
    expect(JSON.stringify(out)).not.toMatch(/Quillfeather|pquillfeather|@/);
  });

  it('the stand-in refuses a query with a column the dataset does not have, so a typo fails here', async () => {
    const res = await fakePortal(ROWS)('https://opendata.usac.org/resource/jt8s-3q52.json?%24select=nope');
    expect(res.status).toBe(400);
  });

  it('a failed or odd response gives nothing and a log line without request detail', async () => {
    const env = { [BIDS_FLAG]: '1', [ERATE_FLAG]: '1' };
    const logs: string[] = [];
    expect(await adapter.fetch(ctx(env, (async () => new Response('x', { status: 503 })) as unknown as typeof fetch, logs))).toEqual([]);
    expect(await adapter.fetch(ctx(env, (async () => new Response('{"error":true}', { status: 200 })) as unknown as typeof fetch, logs))).toEqual([]);
    expect(await adapter.fetch(ctx(env, (async () => { throw new Error('boom https://x?secret=1'); }) as unknown as typeof fetch, logs))).toEqual([]);
    expect(logs.join('\n')).toContain('HTTP 503');
    expect(logs.join('\n')).not.toContain('secret');
  });
});

describe('small helpers', () => {
  it('tidyPlace title-cases a portal city', () => {
    expect(tidyPlace('MOUNT VERNON')).toBe('Mount Vernon');
    expect(tidyPlace("o'fallon")).toBe("O'Fallon");
    expect(tidyPlace('WINSTON-SALEM')).toBe('Winston-Salem');
  });
});
