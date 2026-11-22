/**
 * Round 15 integration fixtures (unit I): the cards that exercise every branch's additive field together.
 *
 * Built through the real code, like brief-fixtures.ts: the NYC heat card gets its company from the real `lookupManagers` over the committed
 * HPD sample (fake fetch over tests/signals/fixtures/nyc-hpd-heat-sample-2026-11-21.json, no network), the Raleigh permit comes out of the real
 * ArcGIS parser (company, phone, licence number, project value, site), the deadline card is the real federal bid parser, and the routed card is
 * the real permit classifier. Each record is run through the real matcher (buildCase), so no card is shown to a trade the rules do not give it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FeedItem } from '@/components/feed';
import type { DigestItem } from '@/lib/email/templates';
import { formatDistance, timeAgo } from '@/components/format';
import { lookupManagers, clearManagerCache } from '@/lib/signals/adapters/nyc-hpd';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { bidCardLine } from '@/lib/signals/bid-card';
import { parseMoney } from '@/lib/signals/permit-value';
import type { SignalInput } from '@/lib/signals/types';
import { FIXTURES, NOW, buildCase, type FixtureCase } from './brief-fixtures';

const fx = (n: string) => JSON.parse(readFileSync(join(__dirname, '../fixtures', n), 'utf8')) as unknown;

/** A fake of the two NYC datasets over the committed sample of live rows. No network. */
async function managerOf(bbl: string) {
  const sample = JSON.parse(readFileSync(join(__dirname, 'fixtures/nyc-hpd-heat-sample-2026-11-21.json'), 'utf8')) as {
    registrations: { registrationid: string; boroid: string; block: string; lot: string }[];
    contacts: { registrationid: string }[];
  };
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  const f: typeof fetch = async (input) => {
    const u = new URL(String(input));
    const where = u.searchParams.get('$where') ?? '';
    if (u.pathname.endsWith('/tesw-yqqr.json')) {
      return json(sample.registrations.filter((r) => where.includes(`boroid='${r.boroid}' AND block='${r.block}' AND lot='${r.lot}'`)));
    }
    if (u.pathname.endsWith('/feu5-w2e2.json')) return json(sample.contacts.filter((c) => where.includes(`'${c.registrationid}'`)));
    return json([]);
  };
  clearManagerCache();
  const out = await lookupManagers([bbl], { fetch: f });
  const b = bbl.replace(/^(\d)(\d{5})(\d{4})$/, (_m, boro, block, lot) => `${boro}-${Number(block)}-${Number(lot)}`);
  return out.get(b) ?? null;
}

/** A heat row whose lot has a registered company in the sample (the first sample BBL that resolves). */
async function heatWithManager(): Promise<FixtureCase> {
  const sample = JSON.parse(readFileSync(join(__dirname, 'fixtures/nyc-hpd-heat-sample-2026-11-21.json'), 'utf8')) as { heatRowBbls: string[] };
  let manager = null;
  for (const bbl of sample.heatRowBbls) {
    manager = await managerOf(bbl);
    if (manager) break;
  }
  if (!manager) throw new Error('no sample BBL resolves to a company');
  const heat = parseSocrata(fx('socrata-nyc-311.json'), SOCRATA_DATASETS.find((d) => d.id === 'socrata-nyc-311')!).find((s) => /HEAT/.test(s.title))!;
  const signal: SignalInput = { ...heat, data: { ...(heat.data ?? {}), managerName: manager.name, managerRole: manager.role } };
  return buildCase('no-heat 311 with the registered company', signal, ['hvac'], 'Harbor Heating');
}

/** A Raleigh remodel permit (routed to a painter): company, phone, licence number, project value and site, as the real parser reads them. */
function raleighPermit(): FixtureCase {
  const rows = {
    features: [
      {
        attributes: {
          permitnum: 'BLDR-2026-0001', issueddate: Date.parse('2026-11-19T00:00:00Z'), description: 'Interior remodel of kitchen and two bathrooms', permittype: 'Residential Building', workclass: 'Alteration',
          estprojectcost: 12500, originaladdress1: '100 TEST ST', originalzip: '27601', contractorcompanyname: 'SUMMIT ROOFING & SIDING INC', contractorphone: '(919) 555-0150',
          contractorlicnum: '75000',
        },
        geometry: { x: -78.64, y: 35.78 },
      },
    ],
  };
  const items = parseArcgis(rows, ARCGIS_DATASETS.find((d) => d.id === 'arcgis-raleigh-permits')!);
  if (!items[0]) throw new Error('Raleigh fixture row was not parsed');
  return buildCase('Raleigh permit with company, licence number and value', items[0], ['painting'], 'Capital City Painting');
}

export interface ShipCase extends FixtureCase {
  /** What the member sees besides the record: contacts for a member whose plan reads them (never a locked account). */
  contacts?: FeedItem['contacts'];
  jobValue?: number | null;
  managerName?: string | null;
  managerRole?: string | null;
}

const dataOf = (c: FixtureCase) => (c.signal.data ?? {}) as Record<string, unknown>;

/** Every card of brief-fixtures plus the three that exercise the merged branches. */
export async function shipCases(): Promise<ShipCase[]> {
  const heat = await heatWithManager();
  const permit = raleighPermit();
  const base: ShipCase[] = FIXTURES.map((c) => ({
    ...c,
    // the Chicago roof permit prints its value from the stored data.jobValue, the way page.tsx passes it
    jobValue: parseMoney(dataOf(c).jobValue as string | number | undefined),
    managerName: (dataOf(c).managerName as string | undefined) ?? null,
    managerRole: (dataOf(c).managerRole as string | undefined) ?? null,
  }));
  const withContacts = (c: FixtureCase): ShipCase => ({
    ...c,
    jobValue: parseMoney(dataOf(c).jobValue as string | number | undefined),
    contacts: (c.signal.contacts ?? []).map((k) => ({ ...k })) as FeedItem['contacts'],
  });
  return [...base, { ...heat, managerName: dataOf(heat).managerName as string, managerRole: dataOf(heat).managerRole as string }, withContacts(permit)];
}

/** What page.tsx builds for one case (the web feed item). */
export const shipFeedItem = (c: ShipCase, i: number): FeedItem => ({
  id: i + 1, signalId: c.signal.id, status: 'new', kind: c.signal.kind, source: c.signal.source, subtype: (dataOf(c).subtype as string | undefined) ?? null,
  title: c.signal.title, summary: c.signal.summary ?? null, url: c.signal.url ?? null, distance: formatDistance(c.match.distance_mi),
  place: [c.signal.city, c.signal.state].filter(Boolean).join(', ') || null, city: c.signal.city ?? null, state: c.signal.state ?? null, county: null, zip: null,
  ago: timeAgo(c.signal.occurredAt, NOW.getTime()), occurredAt: c.signal.occurredAt, draft: null, label: c.label, trade: c.trade, deadline: c.deadline,
  jobValue: c.jobValue ?? null, managerName: c.managerName ?? null, managerRole: c.managerRole ?? null,
  bidLine: dataOf(c).subtype === 'bid' ? bidCardLine({ buyer: dataOf(c).buyer as string, dueDate: dataOf(c).dueDate as string, expiresAt: c.signal.expiresAt ?? null }, NOW) : null,
  ...(c.contacts && c.contacts.length > 0 ? { contacts: c.contacts } : {}),
});

/** What the digest cron builds for one case. */
export const shipDigestItem = (c: ShipCase): DigestItem => ({
  kind: c.signal.kind, source: c.signal.source, subtype: (dataOf(c).subtype as string | undefined) ?? null, title: c.signal.title, summary: c.signal.summary ?? null,
  place: [c.signal.city, c.signal.state].filter(Boolean).join(', ') || null, occurredAt: c.signal.occurredAt, sourceUrl: c.signal.url ?? null,
  label: c.label, trade: c.trade, deadline: c.deadline, jobValue: c.jobValue ?? null, managerName: c.managerName ?? null, managerRole: c.managerRole ?? null,
  bidLine: dataOf(c).subtype === 'bid' ? bidCardLine({ buyer: dataOf(c).buyer as string, dueDate: dataOf(c).dueDate as string, expiresAt: c.signal.expiresAt ?? null }, NOW) : null,
});
