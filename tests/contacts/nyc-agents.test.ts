import { describe, expect, it, vi } from 'vitest';
import {
  chooseRegistration,
  classifyAgents,
  joinComplaint,
  normalizeHouseNumber,
  normalizeStreet,
  parseBbl,
  parseHouseNumber,
  parseIncidentAddress,
  pickAgent,
} from '@/lib/contacts/nyc-agents';
import { CHUNK_SIZE, buildAgentsQuery, buildRegistrationsQuery, chunk, joinNycComplaints } from '@/lib/contacts/nyc-agents-fetch';
import { buildNycHpdAgentsAdapter, buildHeatQuery, countJoinStatuses } from '@/lib/signals/adapters/nyc-hpd-agents';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { feedCount } from '@/lib/seo/home-live';
import { sanitizeSample } from '@/lib/signals/samples';
import * as F from './fixtures/nyc-agents';

vi.mock('server-only', () => ({}));

describe('parseBbl', () => {
  it('splits a 10-digit bbl and drops leading zeros (SOURCED 2026-11-22 recon: 3013020001 -> 3 / 1302 / 1)', () => {
    expect(parseBbl('3013020001')).toEqual({ boroid: '3', block: '1302', lot: '1' });
    expect(parseBbl('1012180001')).toEqual({ boroid: '1', block: '1218', lot: '1' });
    expect(parseBbl('1000010010')).toEqual({ boroid: '1', block: '1', lot: '10' });
    expect(parseBbl(' 2024760022 ')).toEqual({ boroid: '2', block: '2476', lot: '22' });
  });
  it('accepts a number, a trailing .0 and the dashed form', () => {
    expect(parseBbl(3013020001)).toEqual({ boroid: '3', block: '1302', lot: '1' });
    expect(parseBbl('3013020001.0')).toEqual({ boroid: '3', block: '1302', lot: '1' });
    expect(parseBbl('3-01302-0001')).toEqual({ boroid: '3', block: '1302', lot: '1' });
  });
  it('rejects anything else', () => {
    for (const bad of [undefined, null, '', '301302001', '30130200011', 'abc', '6013020001', '0013020001', '3000000001', '3013020000', {}, NaN]) {
      expect(parseBbl(bad as unknown), String(bad)).toBeNull();
    }
  });
});

describe('address normalisation', () => {
  it('makes W 87 ST, WEST 87 STREET and ordinals one street', () => {
    const want = 'WEST 87 STREET';
    for (const s of ['WEST   87 STREET', 'W 87 ST', 'W 87th St.', 'west 87th street', 'W. 87 STREET']) expect(normalizeStreet(s), s).toBe(want);
  });
  it('handles avenues, ordinals, saints and directions', () => {
    expect(normalizeStreet('2nd Ave')).toBe('2 AVENUE');
    expect(normalizeStreet('2 AVENUE')).toBe('2 AVENUE');
    expect(normalizeStreet('SECOND AVENUE')).toBe('2 AVENUE');
    expect(normalizeStreet('ST MARKS PL')).toBe('SAINT MARKS PLACE');
    expect(normalizeStreet('SULLIVAN PL')).toBe('SULLIVAN PLACE');
    expect(normalizeStreet('E 3 ST')).toBe('EAST 3 STREET');
    expect(normalizeStreet('AVENUE OF THE AMERICAS')).toBe('6 AVENUE');
    expect(normalizeStreet('AVENUE N')).toBe('AVENUE N');
    expect(normalizeStreet('SEVENTH AVE')).toBe('7 AVENUE');
    expect(normalizeStreet(undefined)).toBe('');
  });
  it('parses plain, hyphenated Queens and lettered house numbers', () => {
    expect(parseHouseNumber('175')).toEqual({ n: 175, sub: null, letter: '' });
    expect(parseHouseNumber('41-10')).toEqual({ n: 41, sub: 10, letter: '' });
    expect(parseHouseNumber('041-010')).toEqual({ n: 41, sub: 10, letter: '' });
    expect(parseHouseNumber('12A')).toEqual({ n: 12, sub: null, letter: 'A' });
    expect(normalizeHouseNumber('0012a')).toBe('12A');
    expect(parseHouseNumber('1/2')).toBeNull();
    expect(parseHouseNumber('')).toBeNull();
  });
  it('splits an incident address', () => {
    expect(parseIncidentAddress('175 WEST   87 STREET')).toEqual({ house: { n: 175, sub: null, letter: '' }, street: 'WEST 87 STREET' });
    expect(parseIncidentAddress('41-10 QUEENS BOULEVARD')).toEqual({ house: { n: 41, sub: 10, letter: '' }, street: 'QUEENS BOULEVARD' });
    expect(parseIncidentAddress('BROADWAY')).toBeNull();
    expect(parseIncidentAddress('1915 1/2 MAIN ST')).toBeNull();
    expect(parseIncidentAddress(null)).toBeNull();
  });
});

describe('chooseRegistration', () => {
  it('175 W 87 St: the single registration (SOURCED 2026-11-22 recon)', () => {
    const c = chooseRegistration(F.COMPLAINT_175_W87.incident_address, [F.REG_175_W87]);
    expect(c).toMatchObject({ status: 'matched', step: 'exact', candidates: 1 });
    expect(c.registration?.registrationid).toBe('139274');
  });
  it('77 Sullivan Place, 7 registrations on the lot: exactly 373108, by address', () => {
    expect(F.REGS_SULLIVAN_LOT).toHaveLength(7);
    const c = chooseRegistration(F.COMPLAINT_77_SULLIVAN.incident_address, F.REGS_SULLIVAN_LOT);
    expect(c.status).toBe('matched');
    expect(c.registration?.registrationid).toBe('373108');
    expect(c.candidates).toBe(7);
  });
  it('never returns another building of the lot', () => {
    for (const addr of ['1700 BEDFORD AVENUE', '11 MCKEEVER PLACE', '220 MONTGOMERY STREET', '1680 BEDFORD AVENUE', '1700 BEDFORD AVE']) {
      const c = chooseRegistration(addr, F.REGS_SULLIVAN_LOT);
      expect(c.registration?.registrationid ?? null).not.toBe('373108');
    }
    // a Sullivan Place number that is not 77 -> none, not "the one Sullivan row"
    expect(chooseRegistration('79 SULLIVAN PLACE', F.REGS_SULLIVAN_LOT)).toMatchObject({ registration: null, status: 'none' });
    expect(chooseRegistration('75 SULLIVAN PLACE', F.REGS_SULLIVAN_LOT).registration).toBeNull();
    // right number, wrong street
    expect(chooseRegistration('77 BEDFORD AVENUE', F.REGS_SULLIVAN_LOT).registration).toBeNull();
  });
  it('a house number inside a low..high range on the same side matches; the other side and outside do not', () => {
    const r = [{ ...F.REGS_SULLIVAN_LOT[3] }];
    expect(chooseRegistration('1680 BEDFORD AVENUE', r)).toMatchObject({ status: 'matched', step: 'range' });
    expect(chooseRegistration('1726 BEDFORD AVENUE', r).status).toBe('matched');
    expect(chooseRegistration('1681 BEDFORD AVENUE', r).status).toBe('none');
    expect(chooseRegistration('1728 BEDFORD AVENUE', r).status).toBe('none');
    expect(chooseRegistration('1670 BEDFORD AVENUE', r).status).toBe('none');
  });
  it('exact beats range, and two registrations at the same step are ambiguous (null)', () => {
    const wide = { registrationid: 'A', streetname: 'BEDFORD AVENUE', housenumber: '1672', lowhousenumber: '1672', highhousenumber: '1726' };
    const exact = { registrationid: 'B', streetname: 'BEDFORD AVENUE', housenumber: '1680', lowhousenumber: '1680', highhousenumber: '1680' };
    expect(chooseRegistration('1680 BEDFORD AVE', [wide, exact]).registration?.registrationid).toBe('B');
    const other = { ...wide, registrationid: 'C' };
    expect(chooseRegistration('1680 BEDFORD AVE', [wide, other])).toMatchObject({ registration: null, status: 'ambiguous', step: 'range' });
    expect(chooseRegistration('1672 BEDFORD AVE', [wide, other])).toMatchObject({ registration: null, status: 'ambiguous', step: 'exact' });
  });
  it('the same registration on two rows is not ambiguous', () => {
    const a = { registrationid: 'A', streetname: 'WEST 87 STREET', housenumber: '175', lowhousenumber: '175', highhousenumber: '175' };
    expect(chooseRegistration('175 W 87 ST', [a, { ...a }]).status).toBe('matched');
  });
  it('hyphenated Queens numbers compare as pairs', () => {
    const q = { registrationid: 'Q', streetname: 'QUEENS BOULEVARD', housenumber: '41-10', lowhousenumber: '41-10', highhousenumber: '41-20' };
    expect(chooseRegistration('41-10 QUEENS BLVD', [q])).toMatchObject({ status: 'matched', step: 'exact' });
    expect(chooseRegistration('41-14 QUEENS BLVD', [q])).toMatchObject({ status: 'matched', step: 'range' });
    expect(chooseRegistration('41-15 QUEENS BLVD', [q]).status).toBe('none');
    expect(chooseRegistration('41-22 QUEENS BLVD', [q]).status).toBe('none');
    expect(chooseRegistration('42-14 QUEENS BLVD', [q]).status).toBe('none');
  });
  it('an unreadable address or no registrations is none', () => {
    expect(chooseRegistration('', [F.REG_175_W87]).status).toBe('none');
    expect(chooseRegistration('175 WEST 87 STREET', []).status).toBe('none');
  });
});

describe('pickAgent', () => {
  it('an individual agent (no corporationname) gives no contact (SOURCED 2026-11-22: Sam Rosen row)', () => {
    expect(pickAgent([F.AGENT_INDIVIDUAL])).toBeNull();
    expect(classifyAgents([F.AGENT_INDIVIDUAL])).toMatchObject({ status: 'agent-individual', agent: null });
  });
  it('a company agent gives the company and its city/state/zip, and no person field', () => {
    const a = pickAgent([F.AGENT_139274]);
    expect(a).toEqual({ company: 'Skyline Associates LLC', businessCity: 'New York', businessState: 'NY', businessZip: '10019' });
    expect(Object.keys(a!).sort()).toEqual(['businessCity', 'businessState', 'businessZip', 'company']);
  });
  it('only type exactly Agent counts; other contact types are ignored', () => {
    expect(classifyAgents([{ registrationid: '1', type: 'SiteManager', corporationname: 'Skyline Associates LLC' }]).status).toBe('no-agent');
    expect(classifyAgents([{ registrationid: '1', type: 'agent', corporationname: 'Skyline Associates LLC' }]).status).toBe('no-agent');
    expect(classifyAgents([]).status).toBe('no-agent');
  });
  it('a corporationname that cleanOrgName refuses is never returned, and is only counted', () => {
    const c = classifyAgents([{ registrationid: '1', type: 'Agent', corporationname: 'John Smith' }]);
    expect(c).toMatchObject({ agent: null, status: 'agent-individual', rejectedNames: 1 });
    expect(JSON.stringify(c)).not.toMatch(/Smith/);
  });
  it('two different accepted companies are ambiguous; the same company twice is fine', () => {
    const a = { registrationid: '1', type: 'Agent', corporationname: 'Skyline Associates LLC' };
    expect(classifyAgents([a, { ...a, corporationname: 'SKYLINE ASSOCIATES LLC' }]).status).toBe('matched');
    expect(classifyAgents([a, { ...a, corporationname: 'Harbor Realty Group LLC' }])).toMatchObject({ status: 'ambiguous', agent: null });
  });
  it('drops a malformed city, state or zip instead of passing it on', () => {
    const a = pickAgent([{ type: 'Agent', corporationname: 'Skyline Associates LLC', businesscity: '12 Main St', businessstate: 'New York', businesszip: 'abc' }]);
    expect(a).toEqual({ company: 'Skyline Associates LLC', businessCity: null, businessState: null, businessZip: null });
  });
});

describe('joinComplaint', () => {
  const regsFor = (b: { boroid: string; block: string; lot: string }) => (b.block === '1302' ? F.REGS_SULLIVAN_LOT : b.block === '1218' ? [F.REG_175_W87] : []);
  const contacts: Record<string, typeof F.AGENT_139274[]> = { '139274': [F.AGENT_139274], '373108': [F.AGENT_FIELDBRIDGE] };
  const j = (c: { bbl: string; incident_address: string }) => joinComplaint(c.bbl, c.incident_address, regsFor, (id) => contacts[id] ?? []);

  it('175 W 87 St matches and names the company', () => {
    expect(j(F.COMPLAINT_175_W87)).toMatchObject({ status: 'matched', step: 'exact', candidates: 1, agent: { company: 'Skyline Associates LLC' } });
  });
  it('77 Sullivan Place resolves to registration 373108; FIELDBRIDGE ASSOCIATES LLC is refused as ALL CAPS by cleanOrgName, so no company', () => {
    const r = j(F.COMPLAINT_77_SULLIVAN);
    expect(r.candidates).toBe(7);
    // the registration is the right one (contacts are looked up for 373108 only), but the agent name does not pass the strict filter
    expect(r.agent).toBeNull();
    expect(r.status).toBe('agent-individual');
    expect(r.rejectedNames).toBe(1);
  });
  it('statuses: no bbl, no rows, other building, no agent rows', () => {
    expect(joinComplaint(undefined, '1 MAIN ST', regsFor, () => []).status).toBe('no-bbl');
    expect(joinComplaint('4000010001', '1 MAIN ST', regsFor, () => []).status).toBe('no-registration');
    expect(j({ bbl: '3013020001', incident_address: '79 SULLIVAN PLACE' }).status).toBe('no-registration');
    expect(joinComplaint(F.COMPLAINT_175_W87.bbl, F.COMPLAINT_175_W87.incident_address, regsFor, () => []).status).toBe('no-agent');
    const amb = [{ registrationid: 'A', streetname: 'BEDFORD AVENUE', housenumber: '1', lowhousenumber: '1', highhousenumber: '9' }, { registrationid: 'B', streetname: 'BEDFORD AVENUE', housenumber: '1', lowhousenumber: '1', highhousenumber: '9' }];
    expect(joinComplaint('3013020001', '1 BEDFORD AVE', () => amb, () => []).status).toBe('ambiguous');
  });
});

describe('batching', () => {
  const mkBbl = (i: number) => String(1_000_000_000 + (i + 1) * 10_000 + 1);
  const complaints = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, bbl: mkBbl(i), incidentAddress: `${i + 1} MAIN STREET` }));
  const okFetch = () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string) => {
      calls.push(decodeURIComponent(String(url).replace(/\+/g, ' ')));
      return { ok: true, status: 200, json: async () => [] } as Response;
    });
    return { f: f as unknown as typeof fetch, calls };
  };

  it('chunk splits by size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 50)).toEqual([]);
  });
  it('queries use IN on boroid and registrationid, digits only, and select no person column', () => {
    const q = buildRegistrationsQuery([{ boroid: '3', block: '1302', lot: '1' }, { boroid: '1', block: '1218', lot: "1' OR '1'='1" }]);
    expect(q.get('$where')).toBe("boroid IN ('3') AND ((boroid='3' AND block='1302' AND lot='1'))");
    const a = buildAgentsQuery(['373108', "1' OR 1=1", '139274']);
    expect(a.get('$where')).toBe("registrationid IN ('373108','139274') AND type='Agent'");
    expect(a.get('$select')).not.toMatch(/firstname|lastname|middleinitial|businesshousenumber|businessstreetname/);
  });
  it('120 complaints make 3 registration chunks of at most 50 BBLs', async () => {
    const { f, calls } = okFetch();
    const r = await joinNycComplaints(complaints(120), { fetch: f });
    expect(calls).toHaveLength(3);
    const tuples = calls.map((c) => (c.match(/boroid='\d' AND block=/g) ?? []).length);
    expect(tuples.sort((a, b) => b - a)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 20]);
    expect(r.calls).toBe(3);
    expect(r.byKey.size).toBe(120); // every BBL answered with 0 rows -> no-registration
    expect([...r.byKey.values()].every((v) => v.status === 'no-registration')).toBe(true);
    for (const c of calls) expect(c.length).toBeLessThan(8000);
  });
  it('the call cap is never exceeded and unanswered complaints are skipped, not counted as misses', async () => {
    const { f, calls } = okFetch();
    const r = await joinNycComplaints(complaints(300), { fetch: f, maxCalls: 2 });
    expect(calls).toHaveLength(2);
    expect(r.calls).toBe(2);
    expect(r.byKey.size).toBe(100);
    expect(r.skipped).toHaveLength(200);
  });
  it('a failed chunk skips its complaints; the app token header is sent when given', async () => {
    let n = 0;
    const headers: Record<string, string>[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      headers.push(init.headers as Record<string, string>);
      return n++ === 0 ? ({ ok: false, status: 503 } as Response) : ({ ok: true, status: 200, json: async () => [] } as Response);
    }) as unknown as typeof fetch;
    const r = await joinNycComplaints(complaints(60), { fetch: f, appToken: 'tok', chunkSize: 50 });
    expect(headers.every((h) => h['X-App-Token'] === 'tok')).toBe(true);
    expect(r.byKey.size + r.skipped.length).toBe(60);
    expect(r.skipped.length).toBeGreaterThan(0);
  });
  it('end to end: registrations, then agents, matched by address', async () => {
    const f = (async (url: string) => {
      const u = decodeURIComponent(String(url));
      if (u.includes('/tesw-yqqr.json')) return { ok: true, status: 200, json: async () => [F.REG_175_W87] } as Response;
      if (u.includes('/feu5-w2e2.json')) return { ok: true, status: 200, json: async () => [{ registrationid: '139274', type: 'Agent', corporationname: 'Skyline Associates LLC', businesscity: 'New York', businessstate: 'NY', businesszip: '10019' }] } as Response;
      throw new Error('unexpected ' + u);
    }) as unknown as typeof fetch;
    const r = await joinNycComplaints([{ key: '71204274', bbl: F.COMPLAINT_175_W87.bbl, incidentAddress: F.COMPLAINT_175_W87.incident_address }], { fetch: f });
    expect(r.calls).toBe(2);
    expect(r.byKey.get('71204274')).toMatchObject({ status: 'matched', agent: { company: 'Skyline Associates LLC' } });
  });
});

describe('nyc-hpd-agents adapter', () => {
  const heat = (o: Record<string, string>) => ({ complaint_type: 'HEAT/HOT WATER', descriptor: 'ENTIRE BUILDING', descriptor_2: 'NO HOT WATER', created_date: new Date().toISOString().slice(0, 19), latitude: '40.78', longitude: '-73.97', borough: 'MANHATTAN', ...o });
  const rows = [
    heat({ unique_key: '71204274', incident_address: F.COMPLAINT_175_W87.incident_address, incident_zip: '10024', bbl: F.COMPLAINT_175_W87.bbl }),
    heat({ unique_key: '71198289', incident_address: F.COMPLAINT_77_SULLIVAN.incident_address, incident_zip: '11225', bbl: F.COMPLAINT_77_SULLIVAN.bbl, borough: 'BROOKLYN' }),
    heat({ unique_key: '71199768', incident_address: '975 WALTON AVENUE', incident_zip: '10452', bbl: '2024760022', borough: 'BRONX' }),
    heat({ unique_key: '71199999', incident_address: '5 NOWHERE STREET', incident_zip: '10001', bbl: '' }),
    { ...heat({ unique_key: '71100000', incident_address: '1 OTHER STREET', bbl: '1000010001' }), complaint_type: 'HEATING' },
  ];
  const ctxFor = (log: string[] = []) => {
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      const u = decodeURIComponent(String(url));
      urls.push(u);
      if (u.includes('/erm2-nwe9.json')) return { ok: true, status: 200, json: async () => rows } as Response;
      if (u.includes('/tesw-yqqr.json')) return { ok: true, status: 200, json: async () => [F.REG_175_W87, ...F.REGS_SULLIVAN_LOT] } as Response;
      return { ok: true, status: 200, json: async () => [F.AGENT_139274, F.AGENT_FIELDBRIDGE] } as Response;
    }) as unknown as typeof fetch;
    return { urls, ctx: { since: new Date(0), now: new Date(), fetch: fetchFn, env: {}, log: (m: string) => log.push(m) } };
  };

  it('is a probation adapter, registered, and not counted as a live feed', () => {
    const a = buildNycHpdAgentsAdapter();
    expect(a.probation).toBe(true);
    expect(ALL_ADAPTERS.find((x) => x.id === 'nyc-hpd-agents')?.probation).toBe(true);
    expect(feedCount(ALL_ADAPTERS.map((x) => ({ id: x.id, kind: x.kind, requiresEnv: x.requiresEnv ?? [], probation: x.probation })), {})).toBe(
      feedCount(ALL_ADAPTERS.filter((x) => x.id !== 'nyc-hpd-agents').map((x) => ({ id: x.id, kind: x.kind, requiresEnv: x.requiresEnv ?? [], probation: x.probation })), {}),
    );
  });
  it('is in no coverage list: not an enabled dataset, not a guide data source', async () => {
    const { enabledDatasets } = await import('@/lib/signals/capabilities');
    const { GUIDE_DATA_SPECS } = await import('@/lib/seo/guide-data');
    expect(enabledDatasets().some((d) => d.id === 'nyc-hpd-agents')).toBe(false);
    expect(Object.values(GUIDE_DATA_SPECS).flatMap((g) => g.sources)).not.toContain('nyc-hpd-agents');
  });
  it('reuses the live 311 query plus the exact heat complaint_type', () => {
    const w = buildHeatQuery(new Date('2026-11-22T12:00:00Z')).get('$where')!;
    expect(w).toContain("upper(complaint_type) like '%HEAT%'");
    expect(w).toMatch(/created_date > '2026-11-19T07:00:00'/);
    expect(w.endsWith("AND complaint_type='HEAT/HOT WATER'")).toBe(true);
  });
  it('emits one signal per heat complaint with the live title and summary, joinStatus and an agent contact only when found', async () => {
    const { ctx } = ctxFor();
    const out = await buildNycHpdAgentsAdapter().fetch(ctx);
    expect(out.map((o) => o.externalId).sort()).toEqual(['71198289', '71199768', '71199999', '71204274']);
    const by = Object.fromEntries(out.map((o) => [o.externalId, o]));
    expect(by['71204274'].title).toMatch(/^311 request in New York City: HEAT\/HOT WATER/);
    expect(by['71204274'].summary).toContain('HEAT/HOT WATER');
    expect(by['71204274'].source).toBe('nyc-hpd-agents');
    expect(by['71204274'].data).toMatchObject({ joinStatus: 'matched', subtype: 'hpd-agent', baseSubtype: '311', matchStep: 'exact' });
    expect(by['71204274'].contacts).toEqual([{ role: 'business', name: 'Skyline Associates LLC', city: 'New York', state: 'NY', zip: '10019' }]);
    expect(by['71198289'].data?.joinStatus).toBe('agent-individual'); // FIELDBRIDGE in ALL CAPS is refused by cleanOrgName
    expect(by['71198289'].contacts).toBeUndefined();
    expect(by['71199768'].data?.joinStatus).toBe('no-registration');
    expect(by['71199999'].data?.joinStatus).toBe('no-bbl');
    expect(countJoinStatuses(out)).toEqual({ matched: 1, ambiguous: 0, 'no-registration': 1, 'no-bbl': 1, 'agent-individual': 1, 'no-agent': 0, 'not-attempted': 0 });
  });
  it('the contact survives the sample sanitizer (a 311 subtype would lose it)', async () => {
    const out = await buildNycHpdAgentsAdapter().fetch(ctxFor().ctx);
    const kept = sanitizeSample(out.find((o) => o.externalId === '71204274')!);
    expect(kept.contacts?.[0]).toMatchObject({ role: 'business', name: 'Skyline Associates LLC', state: 'NY', zip: '10019' });
  });
  it('calls stay within the cap', async () => {
    const { ctx, urls } = ctxFor();
    await buildNycHpdAgentsAdapter().fetch(ctx);
    expect(urls.length).toBeLessThanOrEqual(1 + 24);
  });
  it('privacy: no first or last name from any fixture row appears anywhere in the output', async () => {
    const out = await buildNycHpdAgentsAdapter().fetch(ctxFor().ctx);
    const everything = JSON.stringify([out, out.map(sanitizeSample)]);
    for (const n of F.PERSON_NAMES) expect(everything, n).not.toMatch(new RegExp(`\\b${n}\\b`, 'i'));
    expect(everything).not.toMatch(/firstname|lastname/i);
    const all = [F.AGENT_MAXWELL, F.AGENT_PROVIDENT, F.AGENT_INDIVIDUAL, F.AGENT_FIELDBRIDGE, F.AGENT_139274];
    const picked = JSON.stringify(all.map((c) => ({ c: classifyAgents([c]), p: pickAgent([c]) })));
    for (const n of F.PERSON_NAMES) expect(picked, n).not.toMatch(new RegExp(`\\b${n}\\b`, 'i'));
  });
});

// ---- review r13 fixes (P2-1, -2, -3, -7, -8, -10, -11) ------------------------------------------------------------------------------
describe('review r13 fixes', () => {
  const reg = (id: string, house: string, lo = house, hi = house, extra: Record<string, string> = {}) => ({ registrationid: id, boroid: '1', block: '10', lot: '1', streetname: 'MAIN STREET', housenumber: house, lowhousenumber: lo, highhousenumber: hi, ...extra });
  const json = (rows: unknown[]) => ({ ok: true, status: 200, json: async () => rows }) as Response;

  it('P2-2: a letter suffix is part of the house number in the exact and the range step', () => {
    expect(chooseRegistration('12 MAIN STREET', [reg('A', '12A')]).status).toBe('none');
    expect(chooseRegistration('12A MAIN STREET', [reg('A', '12')]).status).toBe('none');
    expect(chooseRegistration('12A MAIN STREET', [reg('A', '12A')])).toMatchObject({ status: 'matched', step: 'exact' });
    // range with a lettered endpoint
    expect(chooseRegistration('12 MAIN STREET', [reg('A', '10', '12A', '12A')]).status).toBe('none');
    expect(chooseRegistration('12 MAIN STREET', [reg('A', '10', '10', '12A')]).status).toBe('none');
    expect(chooseRegistration('12A MAIN STREET', [reg('A', '10', '10', '14')]).status).toBe('none'); // suffixed: endpoint strings only
    expect(chooseRegistration('12A MAIN STREET', [reg('A', '10', '10', '12A')])).toMatchObject({ status: 'matched', step: 'range' });
    expect(chooseRegistration('12 MAIN STREET', [reg('A', '10', '10', '14')])).toMatchObject({ status: 'matched', step: 'range' });
    expect(chooseRegistration('10 MAIN STREET', [reg('A', '10', '10', '14')]).status).toBe('matched'); // plain endpoint
  });

  it('P2-7: the registration dataset has registrationenddate (recon): expired registrations are ignored, and counted', () => {
    const now = new Date('2026-11-22T12:00:00Z');
    const old = reg('OLD', '5', '5', '5', { registrationenddate: '2026-09-01T00:00:00.000' });
    const live = reg('LIVE', '5', '5', '5', { registrationenddate: '2027-09-01T00:00:00.000' });
    expect(chooseRegistration('5 MAIN STREET', [old], now)).toMatchObject({ status: 'none', candidates: 0, expired: 1 });
    expect(chooseRegistration('5 MAIN STREET', [old, live], now)).toMatchObject({ status: 'matched', candidates: 1, expired: 1 });
    expect(chooseRegistration('5 MAIN STREET', [reg('X', '5', '5', '5', { registrationenddate: 'garbage' })], now).status).toBe('matched');
    expect(buildRegistrationsQuery([{ boroid: '1', block: '10', lot: '1' }]).get('$select')).toContain('registrationenddate');
    const j = joinComplaint('1000100001', '5 MAIN STREET', () => [old], () => [], now);
    expect(j).toMatchObject({ status: 'no-registration', expired: 1, registrationId: null });
  });

  it('P2-1: joinComplaint records the parsed bbl, the chosen registration id and the candidate count; no bbl is its own status', () => {
    const r = joinComplaint('1000100001', '5 MAIN STREET', () => [reg('77', '5'), reg('78', '7')], () => [{ registrationid: '77', type: 'Agent', corporationname: 'Skyline Associates LLC' }]);
    expect(r).toMatchObject({ status: 'matched', bbl: '1000100001', registrationId: '77', candidates: 2 });
    expect(joinComplaint('1000100001', '9 MAIN STREET', () => [reg('77', '5')], () => [])).toMatchObject({ status: 'no-registration', bbl: '1000100001', registrationId: null, candidates: 1 });
    for (const bad of [undefined, '', '123', '6000100001', '1000000001']) expect(joinComplaint(bad, '5 MAIN STREET', () => [reg('77', '5')], () => [])).toMatchObject({ status: 'no-bbl', bbl: null, registrationId: null });
  });

  it('P2-1: sample rows carry bbl, registrationId, candidates and a distinct no-bbl status', async () => {
    const heat = (o: Record<string, string>) => ({ complaint_type: 'HEAT/HOT WATER', descriptor: 'ENTIRE BUILDING', created_date: new Date().toISOString().slice(0, 19), latitude: '40.78', longitude: '-73.97', borough: 'MANHATTAN', ...o });
    const rows = [
      heat({ unique_key: '1', incident_address: '175 WEST 87 STREET', incident_zip: '10024', bbl: '1012180001' }),
      heat({ unique_key: '2', incident_address: '5 NOWHERE STREET', incident_zip: '10001', bbl: 'abc' }),
      heat({ unique_key: '3', incident_address: '9 OTHER STREET', incident_zip: '10001', bbl: '1000990001' }),
    ];
    const f = (async (url: string) => {
      const u = decodeURIComponent(String(url));
      if (u.includes('/erm2-nwe9.json')) return json(rows);
      if (u.includes('/tesw-yqqr.json')) return json([F.REG_175_W87, { ...reg('9', '1'), block: '99', lot: '1' }]);
      return json([F.AGENT_139274]);
    }) as unknown as typeof fetch;
    const out = await buildNycHpdAgentsAdapter().fetch({ since: new Date(0), now: new Date(), fetch: f, env: {}, log: () => {} });
    const by = Object.fromEntries(out.map((o) => [o.externalId, o.data]));
    expect(by['1']).toMatchObject({ joinStatus: 'matched', bbl: '1012180001', registrationId: '139274', registrationCandidates: 1 });
    expect(by['2']).toMatchObject({ joinStatus: 'no-bbl', bbl: null, registrationId: null, registrationCandidates: 0 });
    expect(by['3']).toMatchObject({ joinStatus: 'no-registration', bbl: '1000990001', registrationId: null, registrationCandidates: 1 });
  });

  it('P2-3: agent rows are fetched only for the chosen registration of each complaint, counted against the cap', async () => {
    const lotRegs = Array.from({ length: 40 }, (_, i) => reg(String(500 + i), String(i * 2 + 1), String(i * 2 + 1), String(i * 2 + 1)));
    const urls: string[] = [];
    const f = (async (url: string) => {
      const u = decodeURIComponent(String(url));
      urls.push(u);
      return json(u.includes('/tesw-yqqr.json') ? lotRegs : []);
    }) as unknown as typeof fetch;
    const r = await joinNycComplaints([{ key: 'a', bbl: '1000100001', incidentAddress: '5 MAIN STREET' }], { fetch: f });
    const agentUrls = urls.filter((u) => u.includes('/feu5-w2e2.json'));
    expect(agentUrls).toHaveLength(1);
    expect(agentUrls[0].replace(/\+/g, ' ')).toContain("registrationid IN ('502')");
    expect(r.calls).toBe(2);
    // a complaint that matches nothing makes no agent call at all
    urls.length = 0;
    await joinNycComplaints([{ key: 'b', bbl: '1000100001', incidentAddress: '6 MAIN STREET' }], { fetch: f });
    expect(urls.filter((u) => u.includes('/feu5-w2e2.json'))).toHaveLength(0);
    // 300 complaints on distinct 40-registration lots no longer exhaust the cap on irrelevant agent rows
    const fm = (async (url: string) => {
      const u = decodeURIComponent(String(url).replace(/\+/g, ' '));
      if (u.includes('/tesw-yqqr.json')) {
        const tuples = [...u.matchAll(/boroid='1' AND block='(\d+)' AND lot='1'/g)].map((m) => m[1]);
        return json(tuples.flatMap((b) => [{ ...reg(`${b}1`, '5'), block: b }, ...Array.from({ length: 39 }, (_, i) => ({ ...reg(`${b}x${i}`, String(1001 + i * 2)), block: b }))].map((x, i) => ({ ...x, registrationid: `${b}${String(i).padStart(2, '0')}` }))));
      }
      return json([]);
    }) as unknown as typeof fetch;
    const many = Array.from({ length: 300 }, (_, i) => ({ key: `k${i}`, bbl: String(1_000_000_000 + (i + 1) * 10_000 + 1), incidentAddress: '5 MAIN STREET' }));
    const rm = await joinNycComplaints(many, { fetch: fm });
    expect(rm.skipped).toHaveLength(0);
    expect(rm.calls).toBeLessThanOrEqual(24);
    expect(rm.byKey.size).toBe(300);
    expect([...rm.byKey.values()].every((v) => v.status === 'no-agent' && v.candidates === 40)).toBe(true);
  });

  it('P2-8: the run budget stops new requests, the rest are notAttempted, and the adapter emits them as not-attempted', async () => {
    let t = 0;
    const f = (async (url: string) => {
      const u = decodeURIComponent(String(url));
      t += 6_000; // each call "takes" 6 s
      return json(u.includes('/tesw-yqqr.json') ? [reg('9', '5')] : []);
    }) as unknown as typeof fetch;
    const cs = Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, bbl: String(1_000_000_000 + (i + 1) * 10_000 + 1), incidentAddress: '5 MAIN STREET' }));
    // 3 BBLs per query, so 2 registration calls; the deadline passes after the first (t = 6000 >= 5000)
    const r = await joinNycComplaints(cs, { fetch: f, chunkSize: 3, deadlineAt: 5_000, clock: () => t });
    expect(r.calls).toBe(1);
    expect(r.notAttempted.length).toBeGreaterThan(0);
    expect(r.byKey.size + r.notAttempted.length + r.skipped.length).toBe(6);
  });

  it('P2-8: the adapter budget is below the runner timeout, with room for a call to finish', async () => {
    const { DEFAULT_ADAPTER_TIMEOUT_MS } = await import('@/lib/signals/run');
    const m = await import('@/lib/signals/adapters/nyc-hpd-agents');
    expect(m.ADAPTER_TIMEOUT_MS).toBe(DEFAULT_ADAPTER_TIMEOUT_MS);
    expect(m.RUN_BUDGET_MS).toBeLessThanOrEqual(DEFAULT_ADAPTER_TIMEOUT_MS - 10_000);
    expect(m.HARD_LIMIT_MS).toBeLessThan(DEFAULT_ADAPTER_TIMEOUT_MS);
  });

  it('P2-8: an adapter run that passes its budget keeps the joined rows and marks the rest not-attempted', async () => {
    const real = Date.now;
    let t = 1_000_000;
    Date.now = () => t;
    try {
      const heat = (k: string, bbl: string) => ({ complaint_type: 'HEAT/HOT WATER', descriptor: 'ENTIRE BUILDING', created_date: new Date(real()).toISOString().slice(0, 19), latitude: '40.7', longitude: '-73.9', borough: 'MANHATTAN', unique_key: k, incident_address: '5 MAIN STREET', incident_zip: '10001', bbl });
      const rows = [heat('1', '1000100001'), heat('2', '1000200001')];
      const f = (async (url: string) => {
        const u = decodeURIComponent(String(url));
        if (u.includes('/erm2-nwe9.json')) return json(rows);
        t += 31_000; // the first lookup blows the budget
        return json(u.includes('/tesw-yqqr.json') ? [reg('9', '5')] : []);
      }) as unknown as typeof fetch;
      const out = await buildNycHpdAgentsAdapter().fetch({ since: new Date(0), now: new Date(real()), fetch: f, env: {}, log: () => {} });
      expect(out).toHaveLength(2);
      expect(out.every((o) => o.data?.joinStatus === 'not-attempted' || o.data?.joinStatus === 'no-registration' || o.data?.joinStatus === 'no-agent' || o.data?.joinStatus === 'matched')).toBe(true);
      expect(out.some((o) => o.data?.joinStatus === 'not-attempted')).toBe(true);
    } finally {
      Date.now = real;
    }
  });

  it('P2-11: queries are ordered, and the same input in any order makes the same queries', async () => {
    expect(buildRegistrationsQuery([{ boroid: '1', block: '10', lot: '1' }]).get('$order')).toBe('registrationid');
    expect(buildAgentsQuery(['1']).get('$order')).toBe('registrationcontactid');
    const run = async (cs: { key: string; bbl: string; incidentAddress: string }[]) => {
      const urls: string[] = [];
      const f = (async (u: string) => (urls.push(decodeURIComponent(String(u))), json([]))) as unknown as typeof fetch;
      await joinNycComplaints(cs, { fetch: f, chunkSize: 2 });
      return urls;
    };
    const cs = Array.from({ length: 5 }, (_, i) => ({ key: `k${i}`, bbl: String(1_000_000_000 + (5 - i) * 10_000 + 1), incidentAddress: '5 MAIN STREET' }));
    expect(await run(cs)).toEqual(await run([...cs].reverse()));
  });

  it('P2-11: a batch that returns the row limit is split and re-queried, never used truncated', async () => {
    const urls: string[] = [];
    const f = (async (url: string) => {
      const u = decodeURIComponent(String(url));
      urls.push(u);
      const blocks = [...u.matchAll(/block='(\d+)'/g)].map((m) => m[1]);
      // limit 2: a query for more than one BBL "returns" 2 rows (a full page); a single-BBL query returns its one row
      return json(blocks.length > 1 ? blocks.slice(0, 2).map((b) => ({ ...reg(`R${b}`, '5'), block: b })) : blocks.map((b) => ({ ...reg(`R${b}`, '5'), block: b })));
    }) as unknown as typeof fetch;
    const cs = [10, 11, 12, 13].map((b) => ({ key: `k${b}`, bbl: `1${String(b).padStart(5, '0')}0001`, incidentAddress: '5 MAIN STREET' }));
    const r = await joinNycComplaints(cs, { fetch: f, rowLimit: 2, maxCalls: 24 });
    const regCalls = urls.filter((u) => u.includes('/tesw-yqqr.json'));
    expect(regCalls.length).toBeGreaterThan(1); // the 4-BBL batch was split
    expect(r.byKey.size).toBe(4);
    expect(r.skipped).toHaveLength(0);
    for (const v of r.byKey.values()) expect(v.candidates).toBe(1);
  });

  it('P2-11: a single item that still fills a page is skipped, not mislabelled no-registration', async () => {
    const f = (async () => json([{ ...reg('1', '5') }, { ...reg('2', '7') }])) as unknown as typeof fetch;
    const r = await joinNycComplaints([{ key: 'a', bbl: '1000100001', incidentAddress: '5 MAIN STREET' }], { fetch: f, rowLimit: 2 });
    expect(r.byKey.size).toBe(0);
    expect(r.skipped).toEqual(['a']);
  });

  it('P2-10: a borough or New York (any case) becomes New York, and the sample keeps it for the NYC dataset', async () => {
    for (const c of ['New York', 'NEW YORK', 'new york', 'Brooklyn', 'BRONX', 'Queens', 'Staten Island', 'The Bronx']) {
      expect(pickAgent([{ type: 'Agent', corporationname: 'Skyline Associates LLC', businesscity: c, businessstate: 'NY', businesszip: '10019' }])?.businessCity, c).toBe('New York');
    }
    expect(pickAgent([{ type: 'Agent', corporationname: 'Skyline Associates LLC', businesscity: 'Scarsdale' }])?.businessCity).toBe('Scarsdale');
    const out = await buildNycHpdAgentsAdapter().fetch(
      (() => {
        const f = (async (url: string) => {
          const u = decodeURIComponent(String(url));
          if (u.includes('/erm2-nwe9.json')) return json([{ complaint_type: 'HEAT/HOT WATER', descriptor: 'ENTIRE BUILDING', created_date: new Date().toISOString().slice(0, 19), latitude: '40.7', longitude: '-73.9', borough: 'MANHATTAN', unique_key: '1', incident_address: '175 WEST 87 STREET', incident_zip: '10024', bbl: '1012180001' }]);
          if (u.includes('/tesw-yqqr.json')) return json([F.REG_175_W87]);
          return json([{ ...F.AGENT_139274, businesscity: 'BROOKLYN' }]);
        }) as unknown as typeof fetch;
        return { since: new Date(0), now: new Date(), fetch: f, env: {}, log: () => {} };
      })(),
    );
    const kept = sanitizeSample(out[0]);
    expect(kept.contacts?.[0]).toMatchObject({ name: 'Skyline Associates LLC', city: 'New York', state: 'NY', zip: '10019' });
  });
});
