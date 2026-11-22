// The re-review's probe 03 (logs/REV2-LOOKUP-probe-tests/03-false-refusal.test.ts), kept as a regression test (redo 2, decision 7): false refusals. Twenty ordinary single-location contractors, each with ONE listing of its
// own, looked up through lookupForCards against a small stand-in for the Business Listings search. The stand-in keeps the documented
// contract (title, location_coordinate "lat,lon,km", limit; total_count = every listing "relevant to your request"; items cut at limit) and
// is run under the two readings of the UNDOCUMENTED title match:
//   phrase:  a listing is relevant when its title contains the sent title as a phrase (the reading the code hopes for);
//   anyword: a listing is relevant when its title shares ANY word with the sent title (a full-text OR match; the documented sample
//            `title: "pizza"` -> "Pizza Mate", "Four Side Vegan Pizza" fits both readings).
// The names all pass lib/contacts/org.ts (a name the classifier refuses is never stored as a contact, so it never reaches the lookup).
import { afterAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { lookupForCards, lookupSettings, newBudget, distanceKm, nameRefusal } from '@/lib/enrich/business-lookup';
import { cleanOrgName } from '@/lib/contacts/org';
import { lookupZip } from '@/lib/geo';
import type { ContactRecord } from '@/lib/contacts/types';
import { ENV, NOW, jsonRes, listingsBody, newDb } from './helpers';

interface Fx {
  /** The name as the permit writes it. */
  record: string;
  /** The job (the permit's city) and what the record says about the contractor's own place. */
  job: { city: string; state: string };
  own: { state?: string; zip?: string };
  /** The contractor's ONE public listing. */
  listing: { title: string; zip: string; phone: string; url: string | null; at?: [number, number]; address?: string; zipField?: unknown };
  note: string;
}
const ATL = { city: 'Atlanta', state: 'GA' };
const CHI = { city: 'Chicago', state: 'IL' };
const AUS = { city: 'Austin', state: 'TX' };
const FX: Fx[] = [
  // Atlanta permits: the record names the contractor only (no address columns).
  { record: 'PEACHTREE ROOFING LLC', job: ATL, own: {}, listing: { title: 'Peachtree Roofing', zip: '30318', phone: '+14045550101', url: 'https://www.peachtreeroofing.example/' }, note: 'in the city' },
  { record: 'ACME ROOFING LLC', job: ATL, own: {}, listing: { title: 'Acme Roofing', zip: '30030', phone: '+14045550102', url: 'http://acmeroofing.example' }, note: 'Decatur, inside 25 km' },
  { record: 'SUMMIT ROOFING LLC', job: ATL, own: {}, listing: { title: 'Summit Roofing', zip: '30004', phone: '+17705550103', url: 'https://summitroofing.example/' }, note: 'office in Alpharetta, 40 km from the Atlanta centre' },
  { record: 'BUCKHEAD PAINTING CO', job: ATL, own: {}, listing: { title: 'Buckhead Painting Company', zip: '30305', phone: '+14045550104', url: 'https://buckheadpainting.example/' }, note: 'Co / Company' },
  { record: 'SUPERIOR ELECTRICAL SERVICES LLC', job: ATL, own: {}, listing: { title: 'Superior Electrical Services', zip: '30080', phone: '+17705550105', url: 'https://superiorelectrical.example/' }, note: 'Smyrna, inside 25 km' },
  { record: 'PRO TECH HVAC LLC', job: ATL, own: {}, listing: { title: 'ProTech HVAC', zip: '30309', phone: '+14045550106', url: 'https://protechhvac.example/' }, note: 'listing writes the name as one word' },
  { record: 'HOMETOWN DRYWALL', job: ATL, own: {}, listing: { title: 'Hometown Drywall, LLC', zip: '30310', phone: '+14045550107', url: null }, note: 'phone only' },
  { record: 'NORTHSIDE HEATING & AIR', job: ATL, own: {}, listing: { title: 'Northside Heating and Air', zip: '30342', phone: '+14045550108', url: 'https://northsidehvac.example/' }, note: '& / and' },
  { record: 'EVERGREEN TREE CARE', job: ATL, own: {}, listing: { title: 'Evergreen Tree Care', zip: '30307', phone: '+14045550109', url: 'https://www.facebook.com/evergreentreecareatl' }, note: 'website is a Facebook page' },
  { record: 'TRUE NORTH BUILDERS', job: ATL, own: {}, listing: { title: 'True North Builders', zip: '30043', phone: '+16785550110', url: 'https://truenorthbuilders.example/' }, note: 'office in Lawrenceville, 43 km from the Atlanta centre' },
  // Chicago permits: contact_N_city / _state / _zipcode (the city is kept only when it is "Chicago").
  { record: 'MIDWEST MECHANICAL INC', job: CHI, own: { state: 'IL', zip: '60607' }, listing: { title: 'Midwest Mechanical', zip: '60607', phone: '+13125550111', url: 'https://midwestmechanical.example/' }, note: 'ZIP on the record' },
  { record: 'LAKESHORE MECHANICAL CONTRACTORS', job: CHI, own: { state: 'IL', zip: '60613' }, listing: { title: 'Lakeshore Mechanical Contractors, Inc.', zip: '60613', phone: '+17735550112', url: 'https://lakeshoremech.example/' }, note: 'ZIP on the record' },
  { record: 'PRAIRIE STATE ELECTRIC', job: CHI, own: { state: 'IL', zip: '60521' }, listing: { title: 'Prairie State Electric', zip: '60521', phone: '+16305550113', url: 'https://prairiestateelectric.example/' }, note: 'suburb ZIP (Hinsdale) on the record' },
  { record: 'KEYSTONE MASONRY', job: CHI, own: { state: 'IN', zip: '46320' }, listing: { title: 'Keystone Masonry', zip: '46320', phone: '+12195550114', url: 'https://keystonemasonry.example/' }, note: 'Indiana contractor, ZIP on the record' },
  { record: 'BRIGHT SIDE ELECTRIC', job: CHI, own: { state: 'IL', zip: '60457' }, listing: { title: 'Bright Side Electric Inc', zip: '60455', phone: '+17085550115', url: 'https://brightsideelectric.example/', address: '7800 W 87th St, Bridgeview, IL 60455, United States', zipField: null }, note: 'listing has no zip field and its address ends ", United States"' },
  { record: 'PRECISION PLUMBING LLC', job: CHI, own: { state: 'IL', zip: '60618' }, listing: { title: 'Precision Plumbing', zip: '60618', phone: '+17735550116', url: 'https://precisionplumbingchi.example/' }, note: 'ZIP on the record; a common name' },
  // Austin permits: contractor_city (dropped unless "Austin") and contractor_zip.
  { record: 'CORNERSTONE CONSTRUCTION', job: AUS, own: { zip: '78664' }, listing: { title: 'Cornerstone Construction', zip: '78664', phone: '+15125550117', url: 'https://cornerstoneatx.example/' }, note: 'Round Rock ZIP, no state on the record' },
  { record: 'APEX ROOFING', job: AUS, own: { zip: '78745' }, listing: { title: 'Apex Roofing & Restoration', zip: '78745', phone: '+15125550118', url: 'https://apexroofingatx.example/' }, note: 'listing adds "& Restoration"' },
  { record: 'CLEAR VIEW WINDOWS', job: AUS, own: { zip: '78704' }, listing: { title: 'Clear View Windows', zip: '78704', phone: '(512) 555-0119', url: 'https://clearviewwindows.example/' }, note: 'phone written (512) 555-0119' },
  { record: 'SOUTHERN CONCRETE', job: AUS, own: { state: 'TX' }, listing: { title: 'Southern Concrete', zip: '78660', phone: '+15125550120', url: 'https://southernconcrete.example/' }, note: 'state only on the record; office in Pflugerville' },
];

/** Other businesses near the three cities whose titles share a trade word (what a real metro area holds). */
const TRADE_WORDS = ['Roofing', 'Painting', 'Electrical', 'HVAC', 'Drywall', 'Heating', 'Tree', 'Builders', 'Mechanical', 'Electric', 'Masonry', 'Plumbing', 'Construction', 'Windows', 'Concrete', 'Services', 'Care', 'Air'];
const OTHER_FIRST = ['Oakline', 'Brightway', 'Stonegate', 'Halcyon', 'Redbud', 'Ironclad', 'Bluebird', 'Fairmont', 'Glenwood', 'Harbor', 'Kingsley', 'Larkspur', 'Maplewood', 'Nordic', 'Orchard', 'Pioneer', 'Quarry', 'Ridgeline', 'Sawgrass', 'Timberline', 'Uptown', 'Valor', 'Westbrook', 'Yellowstone', 'Zenith'];
const CENTRES: [number, number, string][] = [[33.749, -84.388, '30303'], [41.85, -87.65, '60607'], [30.2672, -97.7431, '78701'], [41.6099, -87.5079, '46320'], [30.5145, -97.668, '78664'], [41.80, -87.93, '60521']];
interface L { title: string; lat: number; lon: number; zip: string; phone: string | null; url: string | null; address?: string; zipField?: unknown }
// 25 other businesses per trade word round each centre (a real metro area holds far more than 20 titles with "Roofing" or "Electric" inside 25 km).
const OTHERS: L[] = CENTRES.flatMap(([lat, lon, zip], c) =>
  TRADE_WORDS.flatMap((t, ti) => OTHER_FIRST.map((f, fi) => ({ title: `${f} ${t}`, lat: lat + ((ti % 5) - 2) * 0.02, lon: lon + ((fi % 5) - 2) * 0.02, zip, phone: `+1312${String(5560000 + c * 1000 + ti * 25 + fi)}`, url: null }))),
);
// two near-names that a phrase match also returns
OTHERS.push({ title: 'Precision Plumbing & Sewer Experts', lat: 41.95, lon: -87.70, zip: '60618', phone: '+17735559001', url: null });
OTHERS.push({ title: 'Acme Roofing Supply', lat: 33.78, lon: -84.41, zip: '30318', phone: '+14045559002', url: null });

const OWN: L[] = FX.map((f) => {
  const z = lookupZip(f.listing.zip)!;
  const [lat, lon] = f.listing.at ?? [z.lat + 0.004, z.lon - 0.004];
  return { title: f.listing.title, lat, lon, zip: f.listing.zip, phone: f.listing.phone, url: f.listing.url, address: f.listing.address, zipField: f.listing.zipField };
});
const DB = [...OWN, ...OTHERS];
const norm = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

const totals: number[] = [];
function api(mode: 'phrase' | 'anyword') {
  return vi.fn(async (_url: unknown, init?: { body?: string }) => {
    const task = JSON.parse(init!.body!)[0] as { title: string; location_coordinate: string; limit: number };
    const [lat, lon, km] = task.location_coordinate.split(',').map(Number);
    const q = norm(task.title);
    const qw = new Set(q.split(' ').filter((w) => w.length > 2 && w !== 'and'));
    const hits = DB.filter((l) => distanceKm(lat, lon, l.lat, l.lon) <= km).filter((l) => (mode === 'phrase' ? ` ${norm(l.title)} `.includes(` ${q} `) : norm(l.title).split(' ').some((w) => qw.has(w))));
    const items = hits.slice(0, task.limit).map((l) => {
      const z = lookupZip(l.zip)!;
      const street = '100 Example St';
      return {
        type: 'business_listing', title: l.title, phone: l.phone, url: l.url, domain: l.url ? new URL(l.url).hostname : null,
        address: l.address ?? `${street}, ${z.city}, ${z.state} ${l.zip}`,
        address_info: { borough: null, address: street, city: z.city, zip: l.zipField === undefined ? l.zip : l.zipField, region: null, country_code: 'US' },
        latitude: l.lat, longitude: l.lon, is_claimed: true,
      };
    });
    totals.push(hits.length);
    return jsonRes(listingsBody(items, 0.012 + 0.00036 * items.length, hits.length));
  });
}

const out: string[] = [];
afterAll(async () => {
  console.log('\n' + out.join('\n') + '\n');
});

async function runAll(mode: 'phrase' | 'anyword') {
  const rows: { fx: Fx; attached: boolean; right: boolean; reason: string; total: number | null }[] = [];
  for (const [i, fx] of FX.entries()) {
    const name = cleanOrgName(fx.record);
    expect(name, fx.record).not.toBeNull();
    expect(nameRefusal(name!), fx.record).toBeNull();
    const c: ContactRecord = { signalId: i + 1, role: 'contractor', name: name!, city: null, state: fx.own.state ?? null, zip: fx.own.zip ?? null };
    const fetch = api(mode);
    const db = newDb();
    const budget = newBudget(lookupSettings(ENV));
    const got = await lookupForCards(new Map([[c.signalId, [c]]]), [{ signalId: c.signalId, city: fx.job.city, state: fx.job.state, contact: c }], budget, { db: db as never, fetch: fetch as never, env: ENV, now: () => NOW, sleep: async () => {} });
    const listing = got.get(c.signalId)?.[0].listing;
    const total: number | null = fetch.mock.calls.length ? totals[totals.length - 1] : null;
    const skipped = Object.keys(budget.skipped).join(',');
    const cacheRow = db.tables.holler_business_lookup[0];
    // the reason is not stored: re-derive it from a direct call
    const { lookupBusiness, lookupInputFor } = await import('@/lib/enrich/business-lookup');
    const input = lookupInputFor(c, [c], fx.job);
    const direct = input ? await lookupBusiness(input, { db: newDb() as never, fetch: api(mode) as never, env: ENV, now: () => NOW }) : null;
    const reason = listing ? 'found' : direct ? (direct.status === 'not_found' ? (direct.reason ?? 'not_found') : direct.status === 'skipped' ? `skipped:${direct.reason}` : direct.status) : `skipped:${skipped || 'no_place'}`;
    const digits = fx.listing.phone.replace(/\D/g, '').slice(-10);
    const right = !!listing && (listing.phone ?? '').replace(/\D/g, '') === digits;
    rows.push({ fx, attached: !!listing, right, reason, total });
    void cacheRow;
  }
  return rows;
}

describe('3. false refusals: 20 ordinary contractors with one listing each', () => {
  it('phrase reading of title', async () => {
    const rows = await runAll('phrase');
    const n = rows.filter((r) => r.attached).length;
    out.push(`TITLE MATCH = PHRASE: ${n} of ${rows.length} attached (${rows.filter((r) => r.attached && !r.right).length} wrong)`);
    for (const r of rows) out.push(`  ${r.attached ? 'ATTACHED' : 'REFUSED '} ${r.fx.record.padEnd(34)} ${r.fx.job.city.padEnd(8)} own=${JSON.stringify(r.fx.own).padEnd(28)} listing "${r.fx.listing.title}" ${r.fx.listing.zip}  total_count=${r.total}  -> ${r.reason}  [${r.fx.note}]`);
    expect(rows.every((r) => !r.attached || r.right)).toBe(true); // nothing wrong was attached
    expect(n).toBeGreaterThanOrEqual(15); // the commander's bar for redo 2: 15 or more of 20, 0 wrong
    if (process.env.LOOKUP_FALSE_REFUSAL_OUT) (await import('node:fs')).writeFileSync(process.env.LOOKUP_FALSE_REFUSAL_OUT, out.join('\n') + '\n');
  });
  it('any-word reading of title', async () => {
    const rows = await runAll('anyword');
    const n = rows.filter((r) => r.attached).length;
    out.push(`TITLE MATCH = ANY WORD: ${n} of ${rows.length} attached`);
    const reasons = rows.reduce<Record<string, number>>((m, r) => ((m[r.reason] = (m[r.reason] ?? 0) + 1), m), {});
    out.push(`  reasons: ${JSON.stringify(reasons)}; total_count range ${Math.min(...rows.map((r) => r.total ?? 0))} to ${Math.max(...rows.map((r) => r.total ?? 0))}`);
    expect(rows.every((r) => !r.attached || r.right)).toBe(true);
    expect(n).toBe(0); // under the any-word reading every answer is cut: nothing is attached (and the circuit breaker stops the day)
    if (process.env.LOOKUP_FALSE_REFUSAL_OUT) (await import('node:fs')).writeFileSync(process.env.LOOKUP_FALSE_REFUSAL_OUT, out.join('\n') + '\n');
  });
});
