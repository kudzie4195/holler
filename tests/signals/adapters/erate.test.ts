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
  ERATE_ROUTES,
  erateTitle,
  routeFor,
  whoFor,
} from '@/lib/signals/adapters/erate-config';
import { adapters, buildErateQuery, closesAt, formLink, institutionName, parseErate, pickAllowed, tidyPlace } from '@/lib/signals/adapters/erate';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { missingEnvFor } from '@/lib/signals/run';
import { BIDS_FLAG, ERATE_FLAG, bidHidden, isBidSignal } from '@/lib/signals/bid-sources';
import { bidCardLine } from '@/lib/signals/bid-card';
import { localizeTitle } from '@/lib/signals/title-i18n';
import { localizeSummary } from '@/lib/signals/summary-i18n';
import { briefFamilyOf, briefFor, cardBrief } from '@/lib/signals/brief';
import { briefForLang, cardBriefLang } from '@/lib/signals/brief-i18n';
import { labelFor } from '@/lib/signals/lead-rules';
import { metroFor } from '@/lib/geo/metros';
import { lookupZip } from '@/lib/geo';
import { BANNED } from '../banned';
import type { AdapterContext } from '@/lib/signals/types';

const ROWS = fixture as Array<Record<string, unknown>>;
const NOW = new Date('2026-11-25T18:00:00Z');
const byApp = (id: string) => ROWS.filter((r) => r.application_number === id);
const one = (rows: Array<Record<string, unknown>>, now = NOW) => {
  const rep = parseErate(rows, { now });
  return rep;
};

afterEach(() => vi.unstubAllEnvs());

describe('field mapping on real rows', () => {
  const rep = one(ROWS);

  it('keeps the five open, served, cabling requests and nothing else', () => {
    expect(rep.rows).toBe(18);
    expect(rep.applications).toBe(9);
    expect(rep.items.map((i) => i.externalId).sort()).toEqual(['270001007', '270002974', '270003493', '270004329', '270005737']);
    // dropped: 4 closed (2015, 2017, two libraries in spring 2026)
    expect(rep.closed).toBe(4);
    expect(rep.noTrade).toBe(0);
    expect(rep.notServed).toBe(0);
  });

  it('maps a school with a cabling installation line', () => {
    const i = rep.items.find((x) => x.externalId === '270003493')!;
    expect(i).toMatchObject({
      source: 'bids-erate',
      kind: 'contract',
      title: 'A school in Astoria is asking for bids on network cabling',
      summary: 'St Joseph Catholic Academy | E-Rate request (FCC Form 470) | bids accepted until 2026-12-01',
      url: 'https://publicdata.usac.org/EPC/Prd/Form470/270003493/11475/22877131-USAC_FCC_FORM_470_APPLICATION_270003493_CERTIFIED.pdf',
      city: 'Astoria',
      state: 'NY',
      zip: '11103',
      categories: ['electrical'],
      severity: 2,
      occurredAt: '2026-11-03T15:12:24.000Z',
      // the end of Dec 1 in the latest US zone (UTC-10): 34 hours after 00:00Z
      expiresAt: '2026-12-02T10:00:00.000Z',
    });
    expect(i.data).toMatchObject({
      subtype: 'bid',
      dataset: 'jt8s-3q52',
      solicitationId: '270003493',
      buyer: 'St Joseph Catholic Academy',
      bidType: 'E-Rate Form 470',
      applicantType: 'School',
      work: 'cabling',
      dueDate: '2026-12-01',
      noDueDate: false,
      loc: 'approx',
      approxLocation: true,
    });
    const z = lookupZip('11103')!;
    expect([i.lat, i.lon]).toEqual([z.lat, z.lon]);
  });

  it('says "maintenance" when only the maintenance cabling line routes (Evanston: the install line buys cable with no installation)', () => {
    const i = rep.items.find((x) => x.externalId === '270001007')!;
    expect(i.title).toBe('A school district in Evanston is asking for bids on maintenance of network cabling');
    expect((i.data as { work: string }).work).toBe('cabling_upkeep');
    expect(i.summary).toBe('Evanston Township High School District 202 | E-Rate request (FCC Form 470) | bids accepted until 2026-12-07');
  });

  it('prints a consortium and a district without a usable name', () => {
    expect(rep.items.find((x) => x.externalId === '270004329')!.title).toBe('A group of schools and libraries in Harrison is asking for bids on network cabling');
    const chi = rep.items.find((x) => x.externalId === '270002974')!;
    expect(chi.summary).toBe('E-Rate request (FCC Form 470) | bids accepted until 2026-12-14');
    expect((chi.data as { buyer: unknown }).buyer).toBeNull();
  });

  it('links to the form on USAC\'s own host, else to the dataset page', () => {
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
    expect(bidHidden({ source: i.source, subtype: 'bid', expires_at: i.expiresAt }, false, NOW.getTime())).toBe(true);
    expect(bidHidden({ source: i.source, subtype: 'bid', expires_at: i.expiresAt }, true, NOW.getTime())).toBe(false);
    // closes: hidden once the end of its allowable date has passed
    expect(bidHidden({ source: i.source, subtype: 'bid', expires_at: i.expiresAt }, true, Date.parse('2026-12-02T10:00:01Z'))).toBe(true);
  });

  it('places the card at the ZIP centre and the metro follows', () => {
    const el = rep.items.find((x) => x.externalId === '270001007')!;
    expect(metroFor(el.lat!, el.lon!, el.state)).toBe('chicago');
    const ny = rep.items.find((x) => x.externalId === '270003493')!;
    expect(metroFor(ny.lat!, ny.lon!, ny.state)).toBe('new-york');
    const plano = rep.items.find((x) => x.externalId === '270005737')!;
    expect(metroFor(plano.lat!, plano.lon!, plano.state)).toBe('dallas-fort-worth');
  });

  it('labels it Act Now by source (lead-rules SOURCE_DEFAULTS) for the electrical trade', () => {
    const i = rep.items[0];
    expect(labelFor({ source: i.source, kind: i.kind, subtype: 'bid', title: i.title, summary: i.summary }, 'electrical')).toBe('act_now');
  });
});

describe('date filter: only requests whose allowable contract date has not passed', () => {
  const open = (now: string) => one(ROWS, new Date(now)).items.map((i) => i.externalId).sort();

  it('keeps a request through the end of its allowable day and drops it after', () => {
    expect(open('2026-12-02T09:59:00Z')).toContain('270003493'); // allowable Dec 1: open until the end of Dec 1 in UTC-10
    expect(open('2026-12-02T10:00:00Z')).not.toContain('270003493');
    expect(open('2026-12-02T10:00:00Z')).toContain('270001007'); // Dec 7
    expect(open('2026-12-08T10:00:00Z')).not.toContain('270001007');
  });

  it('drops past requests from the live fixture (2015, 2017, spring 2026)', () => {
    const rep = one(ROWS);
    for (const gone of ['160003906', '170063985', '260026114', '260024231']) expect(rep.items.map((i) => i.externalId)).not.toContain(gone);
    expect(rep.closed).toBe(4);
  });

  it('drops a cancelled form (one real row with only its status changed) and a missing date', () => {
    const cancelled = byApp('270003493').map((r) => ({ ...r, fcc_form_470_status: 'Canceled' }));
    const rep = one(cancelled);
    expect(rep.items).toEqual([]);
    expect(rep.notOpen).toBe(1);
    const nodate = byApp('270003493').map((r) => ({ ...r, allowable_contract_date: undefined }));
    expect(one(nodate).items).toEqual([]);
    // a date more than 120 days out is not a 28 day window
    const far = byApp('270003493').map((r) => ({ ...r, allowable_contract_date: '2027-12-01T00:00:00.000' }));
    expect(one(far).items).toEqual([]);
  });

  it('asks the portal for open requests only, with a day of slack the parser then settles', () => {
    const q = buildErateQuery(NOW);
    expect(q.get('$where')).toContain("allowable_contract_date>='2026-11-24T00:00:00'");
    expect(q.get('$where')).toContain("fcc_form_470_status='Certified'");
    expect(closesAt('2026-12-01')).toBe(Date.parse('2026-12-02T10:00:00Z'));
  });
});

describe('served-area filter', () => {
  it('keeps ZIPs in a served area (the real isServedZip) and counts the rest', () => {
    const rep = one(ROWS);
    // Mount Vernon NY, Pearl River NY etc. are closed; the open ones are Evanston IL, Astoria NY, Plano TX, Harrison NY, Chicago IL
    expect(rep.items.map((i) => i.state).sort()).toEqual(['IL', 'IL', 'NY', 'NY', 'TX']);
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
    expect(none.notServed).toBe(5);
    const all = parseErate(ROWS, { now: NOW, served: () => true });
    expect(all.items).toHaveLength(5);
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

  it('routes exactly two service/function pairs, both to electrical, and nothing to security or general-contractor', () => {
    const hits: string[] = [];
    for (const st of SERVICE_TYPES) for (const fn of FUNCTIONS) for (const inst of [true, false]) {
      const r = routeFor({ service_type: st, function: fn, installation_initial: inst });
      if (r) hits.push(`${st} | ${fn} | ${inst}`);
    }
    expect(hits).toEqual([
      'Internal Connections | Cabling | true',
      'Basic Maintenance of Internal Connections | Cabling | true',
      'Basic Maintenance of Internal Connections | Cabling | false',
    ]);
    for (const r of ERATE_ROUTES) {
      expect(r.trades).toEqual(['electrical']);
      expect(r.trades).not.toContain('security');
      expect(r.trades).not.toContain('general-contractor');
    }
  });

  it('a cabling line with no installation (Evanston, 5300 feet of cable) alone routes nowhere', () => {
    const only = byApp('270001007').filter((r) => !(r.service_type === 'Basic Maintenance of Internal Connections' && r.function === 'Cabling'));
    const rep = one(only);
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

describe('contact fields never survive ingest', () => {
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

  it('no stored record, summary, title, link or data field holds a contact value', () => {
    const rep = parseErate(ROWS.map(withContacts), { now: NOW });
    expect(rep.items).toHaveLength(5);
    const blob = JSON.stringify(rep);
    for (const s of SECRETS) expect(blob).not.toContain(s);
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

  it('an institution name that holds a phone, an email, a link or reads as a person is left off the card, which still stands', () => {
    for (const bad of ['Maria Lopez', 'John Smith', 'Eastside School 404-555-0142', 'help@school.example.org Academy', 'Academy www.example.org', 'ACME WIDGETS INC', '']) {
      expect(institutionName(bad)).toBeNull();
    }
    expect(institutionName('ST JOSEPH CATHOLIC ACADEMY')).toBe('St Joseph Catholic Academy');
    expect(institutionName('SOUTHERN WESTCHESTER BOCES')).toBe('Southern Westchester BOCES');
    expect(institutionName('Prince of Peace Catholic School')).toBe('Prince of Peace Catholic School');
    const rows = byApp('270003493').map((r) => ({ ...r, billed_entity_name: 'Pat Quillfeather 404-555-0142' }));
    const rep = one(rows);
    expect(rep.items).toHaveLength(1);
    expect(rep.items[0].summary).toBe('E-Rate request (FCC Form 470) | bids accepted until 2026-12-01');
    expect(JSON.stringify(rep.items[0])).not.toContain('Quillfeather');
  });

  it('the fixture itself holds no contact column', () => {
    for (const r of ROWS) for (const k of Object.keys(r)) expect(ERATE_NEVER_READ).not.toContain(k);
    expect(JSON.stringify(ROWS)).not.toMatch(/@/);
  });
});

describe('card copy in English and Spanish', () => {
  const rep = parseErate(ROWS, { now: NOW });
  const ny = rep.items.find((x) => x.externalId === '270003493')!;
  const evanston = rep.items.find((x) => x.externalId === '270001007')!;

  it('says in plain words what it is, in English', () => {
    expect(ny.title).toBe('A school in Astoria is asking for bids on network cabling');
    expect(erateTitle('library', 'Mount Vernon', 'cabling')).toBe('A library in Mount Vernon is asking for bids on network cabling');
    const card = cardBrief({ source: ny.source, kind: ny.kind, subtype: 'bid', title: ny.title, summary: ny.summary, label: 'act_now', trade: 'electrical', url: ny.url, occurredAt: ny.occurredAt });
    expect(card.family).toBe('school-bid');
    expect(card.why).toBe('A school or library is asking for bids on cabling; nothing is awarded.');
    expect(card.why.length).toBeLessThanOrEqual(80);
    expect(card.uncertain).toBe('High confidence the request is listed; who may respond is not known.');
    expect(card.next).toBe("Check the deadline and the request's public page.");
    expect(card.source.label).toBe('E-Rate school and library network bids (USAC FCC Form 470)');
    expect(card.source.linkText).toBe('Open the public source');
    expect(card.source.recordLink).toBe(true);
  });

  it('shows the deadline as "bids accepted until <allowable contract date>", with the days left', () => {
    const now = new Date('2026-11-25T18:00:00Z');
    expect(bidCardLine({ buyer: 'St Joseph Catholic Academy', dueDate: '2026-12-01', expiresAt: ny.expiresAt, source: 'bids-erate' }, now, 'en')).toBe(
      'Buyer: St Joseph Catholic Academy. Bids accepted until Dec 1, 2026, 7 days left.',
    );
    // other bids keep their wording
    expect(bidCardLine({ buyer: 'Water & Power', dueDate: '2026-12-01', expiresAt: ny.expiresAt, source: 'bids-la' }, now, 'en')).toBe('Buyer: Water & Power. Due Dec 1, 2026, 7 days left.');
  });

  it('says the same in Spanish: title, summary, deadline line, brief and source', () => {
    expect(localizeTitle(ny.title, 'es', ny.source)).toBe('Una escuela en Astoria pide ofertas para cableado de red');
    expect(localizeTitle(evanston.title, 'es', evanston.source)).toBe('Un distrito escolar en Evanston pide ofertas para mantenimiento del cableado de red');
    expect(localizeTitle(rep.items.find((x) => x.externalId === '270004329')!.title, 'es', 'bids-erate')).toBe(
      'Un grupo de escuelas y bibliotecas en Harrison pide ofertas para cableado de red',
    );
    expect(localizeSummary(ny.summary, 'es', ny.source)).toBe('St Joseph Catholic Academy | Solicitud E-Rate (formulario 470 de la FCC) | se aceptan ofertas hasta el 1 dic 2026');
    expect(bidCardLine({ buyer: 'St Joseph Catholic Academy', dueDate: '2026-12-01', expiresAt: ny.expiresAt, source: 'bids-erate' }, new Date('2026-11-25T18:00:00Z'), 'es')).toMatch(
      /^Comprador: St Joseph Catholic Academy\. Se aceptan ofertas hasta el 1 dic 2026, faltan 7 días\.$/,
    );
    const card = cardBriefLang({ source: ny.source, kind: ny.kind, subtype: 'bid', title: ny.title, summary: ny.summary, label: 'act_now', trade: 'electrical', url: ny.url, occurredAt: ny.occurredAt }, 'es');
    expect(card.why).toBe('Una escuela o biblioteca pide ofertas para cableado; aún no se ha adjudicado.');
    expect(card.uncertain).toContain('la solicitud está publicada');
    expect(card.uncertain).toContain('no se sabe quién puede responder');
    expect(card.source.label).toBe('Ofertas de red de escuelas y bibliotecas (E-Rate, formulario 470 de USAC)');
    expect(card.source.linkText).toBe('Abrir la fuente pública');
  });

  it('English rebuilds to itself and every other family is untouched', () => {
    expect(localizeTitle(ny.title, 'en', ny.source)).toBe(ny.title);
    expect(briefFamilyOf({ source: 'bids-la' })).toBe('city-bid');
    expect(briefFamilyOf({ source: 'bids-erate' })).toBe('school-bid');
    expect(briefForLang({ source: 'bids-erate', label: 'act_now', trade: 'electrical' }, 'en')).toEqual(briefFor({ source: 'bids-erate', label: 'act_now', trade: 'electrical' }));
  });

  it('follows the copy rules in both languages: no banned words, no em-dash, no claim about who wins or who may bid', () => {
    const texts: string[] = [];
    for (const i of rep.items) {
      for (const lang of ['en', 'es'] as const) {
        texts.push(localizeTitle(i.title, lang, i.source), localizeSummary(i.summary, lang, i.source) ?? '');
        texts.push(bidCardLine({ buyer: (i.data as { buyer: string | null }).buyer, dueDate: (i.data as { dueDate: string }).dueDate, expiresAt: i.expiresAt, source: i.source }, NOW, lang));
        const c = cardBriefLang({ source: i.source, subtype: 'bid', title: i.title, summary: i.summary, label: 'act_now', trade: 'electrical', url: i.url, occurredAt: i.occurredAt }, lang);
        texts.push(c.why, c.next, c.uncertain, c.source.label, c.source.linkText);
      }
    }
    for (const who of ['school', 'school-district', 'library', 'library-system', 'consortium', 'either'] as const) {
      for (const work of ['cabling', 'cabling_upkeep'] as const) texts.push(localizeTitle(erateTitle(who, 'X', work), 'es', 'bids-erate'));
    }
    for (const text of texts) {
      expect(text.length).toBeGreaterThan(0);
      for (const re of BANNED) expect(text, text).not.toMatch(re);
      expect(text).not.toMatch(/\b(?:cliente potencial|garantizad[oa]|canvass|knock)\b/i);
    }
    // the Spanish twin of every English title is not English
    for (const who of ['school', 'school-district', 'library', 'library-system', 'consortium', 'either'] as const) {
      expect(localizeTitle(erateTitle(who, 'X', 'cabling'), 'es', 'bids-erate')).toMatch(/ en X pide ofertas para cableado de red$/);
    }
  });

  it('keeps a rows whose title is not an E-Rate title as it is', () => {
    expect(localizeTitle('A school in Astoria is asking for bids on lunch trays', 'es', 'bids-erate')).toBe('A school in Astoria is asking for bids on lunch trays');
  });
});

describe('switches and the registered adapter', () => {
  const adapter = adapters[0];
  const ctx = (env: Record<string, string | undefined>, fetchImpl: typeof fetch, logs: string[] = []): AdapterContext => ({
    since: new Date(0),
    now: NOW,
    fetch: fetchImpl,
    env,
    log: (m) => logs.push(m),
  });

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

  it('with both on: one request to the public SODA path, no token, the Holler agent, and cards back', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(ROWS), { status: 200 }));
    const logs: string[] = [];
    const out = await adapter.fetch(ctx({ [BIDS_FLAG]: '1', [ERATE_FLAG]: 'true', SOCRATA_APP_TOKEN: 'should-not-be-sent' }, f as unknown as typeof fetch, logs));
    expect(out).toHaveLength(5);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith('https://opendata.usac.org/resource/jt8s-3q52.json?')).toBe(true);
    expect(url).not.toMatch(/contact|email|phone|authorized|address|description/i);
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/^Holler\//);
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('x-app-token');
    expect(logs.join(' ')).toContain('5 kept');
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
