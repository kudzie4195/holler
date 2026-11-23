import type { CategoryId } from '@/lib/signals/categories';
import { isAlertLabel, labelFor, OPPORTUNITY_LABELS, recordLabelInput, type OpportunityLabel } from '@/lib/signals/lead-rules';
import { METROS, metroFor, metroForCityState } from '@/lib/geo/metros';
import { cityBySlug, lookupZip } from '@/lib/geo';
import { placeSlugOfDataset } from '@/lib/signals/capabilities';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { CARTO_DATASETS } from '@/lib/signals/adapters/carto-datasets';
import { BID_DATASETS } from '@/lib/signals/adapters/city-bids';
import { JOHNS_CREEK_PERMITS } from '@/lib/signals/adapters/arcgis-johnscreek';
import { SALES_DATASETS } from '@/lib/signals/adapters/sales-datasets';
import { LOCAL_BID_SOURCES } from '@/lib/firecrawl/local-sources';
import { mayHaveContacts } from '@/lib/outreach/plan';
import { isResidentialHeatTitle, managedByLineFrom } from '@/lib/signals/managed-by';
import { isBehind, type SourceState } from '@/lib/signals/source-state';
import { KEYWORD_TRADE, type SectionStatus } from './quality';

/**
 * Per-metro scorecard for the owner (round 19 UNIFY: the other branch's scripts/metro-scorecard.sql idea, adapted to this base's label
 * engine and served by GET /api/admin/metros). Pure: rows in, report out; lib/admin/metros-load.ts reads the rows (selects only).
 *
 * For each of the 10 metros (lib/geo/metros.ts METROS, in that order):
 *   cards     every holler_alert_log row created in the last CARD_WINDOW_DAYS days (one row = one card in one member's feed), placed by
 *             its record: coordinates within the metro radius and the record's state one of the metro's states (metroFor), else the
 *             record's city and state (metroForCityState), the rule scripts/metro-scorecard.sql applies. Per trade (the alert log's
 *             trade; a keyword-watch match is KEYWORD_TRADE) and by this base's label: lib/signals/lead-rules.ts labelFor(record, trade),
 *             the same call the quality dashboard makes. alerted = act_now + coming_soon (isAlertLabel).
 *   contact   of the alerted cards whose record CAN carry a contact path in this base (lib/outreach/plan.ts mayHaveContacts: permits,
 *             new businesses, inspections, awards, bids; plus NYC no-heat 311 rows, which carry the registered managing company), the
 *             share that has one: a named organisation contact on file (holler_signal_contacts, any role but 'site', a name), or a
 *             managing company that passes managedByLineFrom. Other cards (weather, 311, violations) are not counted either way.
 *   waitlist  "Coming to your area" sign-ups whose ZIP is in the metro, from BOTH waitlist tables (round 19 merge): this base's
 *             holler_area_waitlist (new sign-ups) and the live site's holler_zip_waitlist (double opt-in: confirmed and not unsubscribed
 *             rows only). Counts only; a missing table is 'missing' for that table, never zero.
 *   sources   the registered adapters whose place is in the metro (dataset city and state, or its county anchor / fallback centre),
 *             by state (lib/signals/source-state.ts): healthy, behind (delayed, degraded, unavailable), not set up. Probation sources
 *             are listed apart with their sample rows of the last SAMPLE_WINDOW_DAYS days (holler_source_samples).
 * A read that failed is 'unavailable' (blank, never zero); a read that hit its page cap is 'partial'. No member id, title, name, phone,
 * address or record text is in the report: counts, shares, source ids and states only.
 */

export const CARD_WINDOW_DAYS = 7;
export const SAMPLE_WINDOW_DAYS = 14;
/** Bucket for a card whose record is in none of the 10 metros (or was pruned). */
export const OUTSIDE = '(outside the 10 metros)';

export type LabelCounts = Record<OpportunityLabel, number>;
const emptyLabels = (): LabelCounts => ({ act_now: 0, coming_soon: 0, market_insight: 0, context: 0 });

export interface MetroAlertRow {
  signal_id: number | null;
  trade: string | null;
  created_at: string;
}

export interface MetroSignalLite {
  id: number;
  source: string;
  kind: string;
  title: string | null;
  summary: string | null;
  lat: number | null;
  lon: number | null;
  state: string | null;
  city: string | null;
  subtype: string | null;
  /** For the label (lead-rules recordLabelInput): the state-level reach and a permit's stage update (review P3 item 14). */
  severity?: number | null;
  permitStage?: string | null;
  managerName?: string | null;
  managerRole?: string | null;
}

export interface CardCounts {
  total: number;
  byLabel: LabelCounts;
  /** act_now + coming_soon */
  alerted: number;
  /** alerted cards whose record can carry a contact path in this base */
  contactEligible: number;
  /** of those, the ones that have one */
  withContact: number;
  /** withContact / contactEligible; null when nothing was eligible or the contact read failed */
  contactShare: number | null;
}

export interface TradeCards extends CardCounts {
  trade: string;
}

export interface SourceCounts {
  total: number;
  healthy: number;
  behind: number;
  notSetUp: number;
  /** ids of the sources that are behind, worst first is not needed here: sorted by id */
  behindIds: string[];
}

export interface ProbationSource {
  id: string;
  /** Sample rows kept in the last SAMPLE_WINDOW_DAYS days; null when the samples table is missing or the count failed. */
  samples: number | null;
  state: SourceState | null;
}

export interface WaitlistCounts {
  /** holler_area_waitlist rows (this base's waitlist), null when that read failed or the table is missing */
  area: number | null;
  /** holler_zip_waitlist rows that are confirmed and not unsubscribed (the live site's waitlist), null when unavailable */
  zipConfirmed: number | null;
}

export interface MetroScore {
  id: string;
  label: string;
  cards: CardCounts;
  trades: TradeCards[];
  sources: SourceCounts | null;
  probation: ProbationSource[];
  waitlist: WaitlistCounts;
}

export interface MetroReport {
  generatedAt: string;
  windowDays: number;
  since: string;
  sampleWindowDays: number;
  sections: {
    cards: SectionStatus;
    contacts: SectionStatus;
    sources: SectionStatus;
    samples: SectionStatus | 'missing';
    areaWaitlist: SectionStatus | 'missing';
    zipWaitlist: SectionStatus | 'missing';
  };
  metros: MetroScore[];
  /** Cards whose record is in none of the 10 metros, or whose record is gone. */
  outside: CardCounts;
  /** Registered sources with no place (national feeds: weather, federal, events, public posts), by state. */
  national: SourceCounts | null;
  notes: string[];
}

export interface MetroInputs {
  now: Date;
  alerts: MetroAlertRow[];
  signals: MetroSignalLite[];
  /** Signal ids with a named organisation contact; null when that read failed. */
  namedContactIds: ReadonlySet<number> | null;
  /** Every registered adapter: id and whether it is on probation. */
  adapters: ReadonlyArray<{ id: string; probation?: boolean }>;
  /** Source states by id; null when the read failed. */
  states: ReadonlyMap<string, SourceState> | null;
  /** Probation sample counts by source id; 'missing' when the samples table is not there; null when the read failed. */
  samples: ReadonlyMap<string, number> | 'missing' | null;
  /** ZIPs of holler_area_waitlist rows (one per row); 'missing' or null (failed) like samples. */
  areaWaitlistZips?: readonly string[] | 'missing' | null;
  /** ZIPs of holler_zip_waitlist rows that are confirmed and not unsubscribed; 'missing' or null (failed). */
  zipWaitlistZips?: readonly string[] | 'missing' | null;
  status?: Partial<{ cards: SectionStatus; areaWaitlist: SectionStatus; zipWaitlist: SectionStatus }>;
}

/** The metro of a ZIP code (its centroid), or null. */
export function metroOfZip(zip: string): string | null {
  const z = lookupZip(zip);
  return z ? metroFor(z.lat, z.lon, z.state) : null;
}

function waitlistBy(zips: readonly string[] | 'missing' | null | undefined): Map<string, number> | null {
  if (!Array.isArray(zips)) return null;
  const out = new Map<string, number>();
  for (const z of zips) {
    const m = metroOfZip(z);
    if (m) out.set(m, (out.get(m) ?? 0) + 1);
  }
  return out;
}

// ---- where a source is --------------------------------------------------------------------------------------------------------------

type Placed = { id: string; city: string; state: string; zip?: string; fallbackCenter?: { lat: number; lon: number }; countyAnchor?: { lat: number; lon: number } };

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The metro of a place: a core city by name, else the point of the place the scanner files its rows under (placeSlugOfDataset). */
export function metroOfPlace(p: Omit<Placed, 'id'>): string | null {
  const byName = metroForCityState(p.city, p.state);
  if (byName) return byName;
  const slug = placeSlugOfDataset({ city: p.city, state: p.state, fallbackCenter: p.fallbackCenter, countyAnchor: p.countyAnchor });
  const c = (slug ? cityBySlug(slug) : undefined) ?? cityBySlug(`${slugify(p.city)}-${p.state.toLowerCase()}`);
  if (c) return metroFor(c.lat, c.lon, p.state);
  // A source configured by its office ZIP only (the Firecrawl agency pages): the ZIP centroid.
  return p.zip ? metroOfZip(p.zip) : null;
}

/** Every source with a place of its own (dataset tables), id to metro id (null: a place outside the 10 metros). */
export function sourcePlaces(): Map<string, string | null> {
  const list: Placed[] = [
    ...SOCRATA_DATASETS,
    ...ARCGIS_DATASETS,
    JOHNS_CREEK_PERMITS,
    ...CARTO_DATASETS,
    // Round 20 SALES: property sale sources (all on probation), listed under their metro.
    ...SALES_DATASETS,
    ...BID_DATASETS,
    ...LOCAL_BID_SOURCES,
  ];
  return new Map(list.map((d) => [d.id, metroOfPlace(d)]));
}

/** Registered sources that cover the whole country (no place of their own). tests/admin/metros.test.ts fails when an adapter is in neither list. */
export const NATIONAL_SOURCES: readonly string[] = ['nws', 'spc', 'fema', 'usgs', 'faa', 'usaspending', 'sam-gov', 'ticketmaster', 'bluesky', 'websearch-brave', 'websearch-serper'];

// ---- where a card is ------------------------------------------------------------------------------------------------------------------

/** The metro of a record: coordinates inside a metro circle in one of its states, else its city and state. Null when neither places it. */
export function metroOfRecord(s: Pick<MetroSignalLite, 'lat' | 'lon' | 'state' | 'city'>): string | null {
  if (typeof s.lat === 'number' && typeof s.lon === 'number') return metroFor(s.lat, s.lon, s.state ?? null);
  return metroForCityState(s.city, s.state);
}

/** Can this record carry a contact path in this base? (the "where this base can compute it" of the scorecard) */
export function contactEligible(s: Pick<MetroSignalLite, 'source' | 'kind' | 'title'>): boolean {
  if (mayHaveContacts(s.source, s.kind)) return true;
  return s.source === 'socrata-nyc-311' && isResidentialHeatTitle(s.title);
}

function emptyCards(): CardCounts {
  return { total: 0, byLabel: emptyLabels(), alerted: 0, contactEligible: 0, withContact: 0, contactShare: null };
}

function addCard(c: CardCounts, label: OpportunityLabel, eligible: boolean, has: boolean): void {
  c.total++;
  c.byLabel[label]++;
  if (!isAlertLabel(label)) return;
  c.alerted++;
  if (!eligible) return;
  c.contactEligible++;
  if (has) c.withContact++;
}

function finishCards<T extends CardCounts>(c: T, contactsOk: boolean): T {
  c.contactShare = contactsOk && c.contactEligible > 0 ? Math.round((c.withContact / c.contactEligible) * 1000) / 1000 : null;
  return c;
}

function sourceCounts(ids: readonly string[], states: ReadonlyMap<string, SourceState>): SourceCounts {
  const out: SourceCounts = { total: ids.length, healthy: 0, behind: 0, notSetUp: 0, behindIds: [] };
  for (const id of ids) {
    const st = states.get(id);
    if (st === 'healthy') out.healthy++;
    else if (st === 'not_set_up') out.notSetUp++;
    else if (st && isBehind(st)) {
      out.behind++;
      out.behindIds.push(id);
    }
  }
  out.behindIds.sort();
  return out;
}

export function buildMetroReport(input: MetroInputs): MetroReport {
  const nowMs = input.now.getTime();
  const since = new Date(nowMs - CARD_WINDOW_DAYS * 86_400_000).toISOString();
  const cardsStatus: SectionStatus = input.status?.cards ?? 'ok';
  const contactsOk = input.namedContactIds !== null;
  const sigBy = new Map(input.signals.map((s) => [s.id, s]));

  const perMetro = new Map<string, { cards: CardCounts; trades: Map<string, TradeCards> }>(METROS.map((m) => [m.id, { cards: emptyCards(), trades: new Map() }]));
  const outside = emptyCards();
  const sinceMs = Date.parse(since);
  if (cardsStatus !== 'unavailable') {
    for (const a of input.alerts) {
      const at = Date.parse(a.created_at);
      if (!Number.isFinite(at) || at < sinceMs || at > nowMs) continue;
      const s = a.signal_id === null ? undefined : sigBy.get(a.signal_id);
      const metro = s ? metroOfRecord(s) : null;
      const label: OpportunityLabel = s
        ? labelFor(recordLabelInput(s), (a.trade ?? null) as CategoryId | null)
        : 'context';
      const eligible = !!s && contactEligible(s);
      const has = !!s && contactsOk && (input.namedContactIds!.has(s.id) || managedByLineFrom(s.managerName, s.managerRole) !== null);
      if (!s || !metro || !perMetro.has(metro)) {
        addCard(outside, label, eligible, has);
        continue;
      }
      const m = perMetro.get(metro)!;
      addCard(m.cards, label, eligible, has);
      const trade = a.trade ?? KEYWORD_TRADE;
      let tc = m.trades.get(trade);
      if (!tc) m.trades.set(trade, (tc = { trade, ...emptyCards() }));
      addCard(tc, label, eligible, has);
    }
  }

  const places = sourcePlaces();
  const probationIds = new Set(input.adapters.filter((a) => a.probation).map((a) => a.id));
  const liveBy = new Map<string, string[]>();
  const probationBy = new Map<string, string[]>();
  const national: string[] = [];
  for (const a of input.adapters) {
    const metro = places.get(a.id);
    if (metro === undefined) {
      if (!probationIds.has(a.id)) national.push(a.id);
      continue;
    }
    if (metro === null) continue; // a city source outside the 10 metros
    const into = probationIds.has(a.id) ? probationBy : liveBy;
    into.set(metro, [...(into.get(metro) ?? []), a.id]);
  }
  const samples = input.samples;
  const areaBy = waitlistBy(input.areaWaitlistZips);
  const zipBy = waitlistBy(input.zipWaitlistZips);
  const metros: MetroScore[] = METROS.map((m) => {
    const pm = perMetro.get(m.id)!;
    const trades = [...pm.trades.values()]
      .map((t) => finishCards(t, contactsOk))
      .sort((a, b) => b.total - a.total || (a.trade < b.trade ? -1 : 1));
    return {
      id: m.id,
      label: m.label,
      cards: finishCards(pm.cards, contactsOk),
      trades,
      sources: input.states ? sourceCounts(liveBy.get(m.id) ?? [], input.states) : null,
      probation: (probationBy.get(m.id) ?? []).sort().map((id) => ({
        id,
        samples: samples instanceof Map ? (samples.get(id) ?? 0) : null,
        state: input.states?.get(id) ?? null,
      })),
      waitlist: { area: areaBy ? (areaBy.get(m.id) ?? 0) : null, zipConfirmed: zipBy ? (zipBy.get(m.id) ?? 0) : null },
    };
  });

  const notes: string[] = [];
  if (cardsStatus === 'unavailable') notes.push('The alert log could not be read: card counts are blank, not zero.');
  if (cardsStatus === 'partial') notes.push('The alert log hit its row limit: only the newest cards are counted.');
  if (!contactsOk) notes.push('The contact read failed: contact shares are blank, not zero.');
  if (samples === 'missing') notes.push('holler_source_samples is missing (apply migration 0032): probation sources are skipped by the scan and have no samples.');
  if (samples === null) notes.push('The samples count could not be read: probation sample counts are blank, not zero.');
  if (!input.states) notes.push('Source states could not be read: healthy and behind counts are blank, not zero.');
  const wlStatus = (v: readonly string[] | 'missing' | null | undefined, st: SectionStatus | undefined): SectionStatus | 'missing' =>
    v === 'missing' ? 'missing' : v === null || v === undefined ? 'unavailable' : (st ?? 'ok');
  notes.push(`Labels are this base's (lib/signals/lead-rules.ts labelFor: ${OPPORTUNITY_LABELS.join(', ')}). A card is one holler_alert_log row: one record in one member's feed.`);

  return {
    generatedAt: input.now.toISOString(),
    windowDays: CARD_WINDOW_DAYS,
    since,
    sampleWindowDays: SAMPLE_WINDOW_DAYS,
    sections: {
      cards: cardsStatus,
      contacts: contactsOk ? 'ok' : 'unavailable',
      sources: input.states ? 'ok' : 'unavailable',
      samples: samples === 'missing' ? 'missing' : samples === null ? 'unavailable' : 'ok',
      areaWaitlist: wlStatus(input.areaWaitlistZips, input.status?.areaWaitlist),
      zipWaitlist: wlStatus(input.zipWaitlistZips, input.status?.zipWaitlist),
    },
    metros,
    outside: finishCards(outside, contactsOk),
    national: input.states ? sourceCounts(national.sort(), input.states) : null,
    notes,
  };
}
