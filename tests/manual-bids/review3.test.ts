// Review 3 fixes: retire then re-add, place names, bid numbers, the signed confirm key, visible formula strips, the address screen.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { buildManualBid, contactFound, knownPlaceName, onlyPersonName } from '@/lib/signals/manual-bids/record';
import { confirmKeyOf, confirmKeyValid, CONFIRM_TTL_MS, quickAdd, retireBid, type ServiceDeps } from '@/lib/signals/manual-bids/service';
import { findExisting, publishManualBids, retireManualBid, listManualBids } from '@/lib/signals/manual-bids/store';
import { fakeTables } from '@/tests/match/fake-table';
import type { Db } from '@/lib/signals/store';

const NOW = new Date('2026-11-25T15:00:00Z');
const base = { url: 'https://mariettaga.gov/Bids.aspx?bidID=412', title: 'Roof replacement at Fire Station 3', agency: 'City of Marietta', dueDate: '2026-12-15', place: '30060' };
const served = () => true;
const build = (over: Record<string, string>) => buildManualBid({ ...base, ...over }, { now: NOW, served });

afterEach(() => vi.unstubAllEnvs());

function realDeps() {
  const fdb = fakeTables(
    { holler_signals: [], holler_matches: [], holler_alert_log: [], holler_work_profiles: [], holler_profiles: [] },
    { conflict: { holler_signals: ['source', 'external_id'], holler_matches: ['user_id', 'signal_id'], holler_alert_log: ['user_id', 'signal_id'] } },
  );
  let clock = NOW.getTime();
  const deps: ServiceDeps = {
    gate: async () => ({ ok: true, userId: 'owner' }),
    db: () => fdb as unknown as Db,
    now: () => new Date(clock),
    bidsOn: () => true,
    findExisting,
    publish: publishManualBids,
    retire: retireManualBid,
    list: listManualBids,
    served,
  };
  return { fdb, deps, tick: () => (clock += 60_000) };
}

async function add(deps: ServiceDeps, fields: Record<string, string>) {
  const p = await quickAdd(deps, fields);
  if (!p.ok || p.step !== 'preview') return p;
  return quickAdd(deps, fields, p.confirmKey);
}

describe('P1-1: a retired bid never blocks its corrected version', () => {
  const WITH = { ...base, solicitationId: 'RFP 26-014' };
  const cases: Array<[string, Record<string, string>, Record<string, string>]> = [
    ['wrong due date, no number', base, { ...base, dueDate: '2026-12-18' }],
    ['wrong ZIP, no number', base, { ...base, place: '30062' }],
    ['wrong trade, no number', { ...base, trade: 'plumbing' }, { ...base, trade: 'roofing' }],
    ['wrong link, no number', base, { ...base, url: 'https://mariettaga.gov/Bids.aspx?bidID=413' }],
    ['wrong due date, number given', WITH, { ...WITH, dueDate: '2026-12-18' }],
    ['typo in the title, number given', { ...WITH, title: 'Roof replacment at Fire Station 3' }, WITH],
    ['wrong link, number given', WITH, { ...WITH, url: 'https://mariettaga.gov/Bids.aspx?bidID=413' }],
    ['wrong ZIP, number given', WITH, { ...WITH, place: '30062' }],
    ['wrong trade, number given', { ...WITH, trade: 'plumbing' }, { ...WITH, trade: 'roofing' }],
    ['wrong due date, number left off the second time', WITH, { ...base, dueDate: '2026-12-18' }],
  ];
  it.each(cases)('%s: publish, retire, re-add', async (_name, first, corrected) => {
    const { fdb, deps, tick } = realDeps();
    expect(await add(deps, first)).toMatchObject({ ok: true, step: 'done', inserted: 1 });
    const id = fdb.tables.holler_signals[0].id as number;
    tick();
    expect(await retireBid(deps, String(id))).toMatchObject({ ok: true });
    expect(fdb.tables.holler_signals[0].external_id).toMatch(/:retired:\d+$/);
    tick();
    expect(await add(deps, corrected)).toMatchObject({ ok: true, step: 'done', inserted: 1 });
    const open = fdb.tables.holler_signals.filter((r: { data: { retiredAt?: string } }) => !r.data.retiredAt);
    expect(open).toHaveLength(1);
    // The same corrected bid a second time is still a duplicate.
    expect(await add(deps, corrected)).toMatchObject({ ok: false, field: 'duplicate' });
  });
});

describe('P2-1: bare place names and real agency names', () => {
  const REFUSED_BEFORE = [
    'Flowery Branch', 'Villa Rica', 'Locust Grove', 'Avondale Estates', 'Bee Cave', 'Wake Forest', 'Chapel Hill', 'Saint George', 'St. George', 'Santa Monica',
    'Beverly Hills', 'San Fernando', 'West Hollywood', 'Long Beach', 'Santa Clarita', 'San Mateo', 'San Bruno', 'San Rafael', 'Glen Ellyn', 'Saint Charles',
    'Wellstar Kennestone', 'Perimeter CIDs', 'Lewis R. Slaton Courthouse', 'Dallas Love Field', 'Barbara Jordan Terminal', 'Sam Rayburn Tollway', 'Ben Taub',
    'Pennington Biomedical', 'Marietta GA',
  ];
  it('the 29 names the third review saw refused are accepted and stored as typed', () => {
    expect(REFUSED_BEFORE).toHaveLength(29);
    for (const agency of REFUSED_BEFORE) {
      const r = build({ agency });
      expect(r.ok, agency).toBe(true);
      if (r.ok) expect(r.view.agency).toBe(agency);
    }
  });
  it('a town in the geo data is never a person', () => {
    for (const p of ['Chapel Hill', 'Wake Forest', 'Santa Monica', 'Beverly Hills', 'Villa Rica', 'Locust Grove', 'St. George', 'Marietta GA', 'Douglas County']) {
      expect(knownPlaceName(p), p).toBe(true);
      expect(onlyPersonName(p, 'agency'), p).toBe(false);
      expect(onlyPersonName(p, 'title'), p).toBe(false);
    }
    expect(onlyPersonName('Bee Cave', 'agency')).toBe(false);
    expect(knownPlaceName('John Q. Smith')).toBe(false);
    expect(build({ title: 'John Q. Smith' })).toEqual({ ok: false, problem: 'person_name' });
  });
});

describe('P2-2: bid numbers in the number field', () => {
  it('10+ digit ids and SFGOV~ ids are accepted; a number written like a phone is refused', () => {
    for (const sol of ['SFGOV~0000007082', '4400012345', 'RFP 2026000123', '20260001234567', 'BL153-26', 'RP-026-26']) {
      const r = build({ solicitationId: sol });
      expect(r.ok, sol).toBe(true);
      if (r.ok) expect(r.view.solicitationId).toBe(sol);
    }
    for (const sol of ['404-555-0147', '(404) 555-0147', '404.555.0147', '404 555 0147', '+1 404-555-0147', '(404)5550147']) {
      expect(build({ solicitationId: sol }), sol).toMatchObject({ ok: false, problem: 'contact_sol' });
    }
  });
  it('the title and agency phone check is unchanged', () => {
    expect(contactFound('Roof repair 4045550147')).toBe('phone number');
    expect(contactFound('4400012345', { numberField: true })).toBeNull();
  });
  it('a number over 60 characters is refused, not cut', () => {
    expect(build({ solicitationId: 'X'.repeat(61) })).toMatchObject({ ok: false, problem: 'too_long' });
  });
});

describe('P2-7: the confirm key is signed by the server', () => {
  const fields = { ...base };
  it('a key made without the server secret, a key from another secret, an old key and a tampered key are refused', () => {
    vi.stubEnv('CRON_SECRET', 'server-secret-for-tests');
    const key = confirmKeyOf(fields, 'manual:x', NOW);
    expect(confirmKeyValid(key, fields, 'manual:x', NOW)).toBe(true);
    // What review 3 computed in the browser: a plain hash of the fields.
    const plain = createHash('sha256').update(JSON.stringify([Object.entries(fields).sort(), 'manual:x'])).digest('hex').slice(0, 32);
    expect(confirmKeyValid(plain, fields, 'manual:x', NOW)).toBe(false);
    expect(confirmKeyValid(confirmKeyOf(fields, 'manual:x', NOW, 'other'), fields, 'manual:x', NOW)).toBe(false);
    expect(confirmKeyValid(key, fields, 'manual:x', new Date(NOW.getTime() + CONFIRM_TTL_MS + 1))).toBe(false);
    expect(confirmKeyValid(key.replace(/.$/, (c) => (c === '0' ? '1' : '0')), fields, 'manual:x', NOW)).toBe(false);
    expect(confirmKeyValid(key, { ...fields, title: 'Other' }, 'manual:x', NOW)).toBe(false);
    vi.stubEnv('CRON_SECRET', 'rotated');
    expect(confirmKeyValid(key, fields, 'manual:x', NOW)).toBe(false);
  });
  it('quick add refuses a self-made key', async () => {
    vi.stubEnv('CRON_SECRET', 'server-secret-for-tests');
    const { deps, fdb } = realDeps();
    expect(await quickAdd(deps, fields, `${NOW.getTime()}.${'a'.repeat(40)}`)).toMatchObject({ ok: false, field: 'changed' });
    expect(fdb.tables.holler_signals).toHaveLength(0);
  });
});

describe('P2-4: a removed leading character is shown, never silent', () => {
  it('the preview lists each strip', () => {
    const r = build({ title: '+/- 40 Acres of Mowing', agency: '"The" City of Marietta' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.title).toBe('/- 40 Acres of Mowing');
    expect(r.view.notes).toEqual([
      'Title: leading "+" removed (spreadsheet formula characters).',
      'Agency: leading """ removed (spreadsheet formula characters).',
    ]);
    const plain = build({});
    expect(plain.ok && plain.view.notes).toEqual([]);
  });
});

describe('the address screen: PO boxes and house numbers that look like years', () => {
  it('refuses PO box forms and 1900-2099 house numbers ending a street address; years stay safe', () => {
    for (const t of ['City of Marietta, P.O.Box 1234', 'City of Marietta, PO Box 12', 'City of Marietta, POB 12', 'City of Marietta, Post Office Box 9', 'City of Marietta, P. O. Box 9']) {
      expect(contactFound(t), t).toBe('street address');
    }
    for (const t of ['Roof repair at 2015 Oak Hollow Dr', 'Roof repair at 2015 Oak Hollow Dr, Marietta', 'Paving 1950 Spring St (rear lot)', '2001 Johnson Ferry Rd']) {
      expect(contactFound(t), t).toBe('street address');
    }
    for (const t of ['2026 LMIG Road Resurfacing', 'FY 2027 Street Resurfacing Program', '2026 Annual Sidewalk and Trail Repairs', 'ITB 2026-08 Whitlock Avenue Sidewalk Improvements', '2027PS001 - Campus-Wide Fire Alarm System Replacement']) {
      expect(contactFound(t), t).toBeNull();
    }
  });
});
