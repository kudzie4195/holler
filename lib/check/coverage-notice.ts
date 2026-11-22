import { enabledDatasets, SIGNAL_TRADES, type SignalTypeId } from '@/lib/signals/capabilities';
import { localSourcesNear, LOCAL_COVERAGE_RADIUS_MI } from '@/lib/check/coverage';
import { agePhrase, isBehind, STATE_SEVERITY, type SourceState } from '@/lib/signals/source-state';

/**
 * The calm one-line coverage notice (PLAN-2.0 item 2.4): when a source that covers a place and a trade is delayed, degraded or
 * unavailable, say so next to the results, so a partial picture is never presented as the full one. Pure: the caller passes the
 * source states (lib/signals/source-state-snapshot.ts) and the clock.
 *
 * What counts as "covers": a local feed (Socrata or ArcGIS dataset, lib/check/coverage.ts) whose centre is within `radiusMi` of the
 * place and whose record type is tagged with one of the member's trades, plus the two national weather feeds (alerts and storm
 * reports) when the trade receives them. A source that is "not set up yet" is never mentioned: Holler never promised it. A source with
 * no known state (the health read failed, or it is not in the table yet) is not mentioned either: no state, no claim.
 *
 * Wording: plain and calm. No "lead". It never says a record is missing, only that some recent ones may be.
 */
export interface CoverageNotice {
  /** The one line to show. */
  line: string;
  /** The affected sources, worst first, one per name (several layers of one county are one entry). */
  affected: Array<{ name: string; state: SourceState; lastSuccessAt: string | null }>;
}

export interface StateLookup {
  [sourceId: string]: { state: string; lastSuccessAt: string | null } | undefined;
}

const TYPE_NOUN: Partial<Record<SignalTypeId, string>> = {
  permit: 'permits',
  '311': '311 requests',
  inspection: 'food inspections',
  business: 'business licenses',
  violation: 'code violations',
  'event-permit': 'event permits',
};

const NATIONAL: Array<{ id: string; name: string; type: SignalTypeId }> = [
  { id: 'nws', name: 'Weather alerts', type: 'weather-alert' },
  { id: 'spc', name: 'Storm reports', type: 'storm-report' },
];

function receives(type: SignalTypeId, trades: readonly string[]): boolean {
  if (trades.length === 0) return true;
  const tagged: readonly string[] = SIGNAL_TRADES[type] ?? [];
  return trades.some((t) => tagged.includes(t));
}

function isState(s: string): s is SourceState {
  return s === 'healthy' || s === 'delayed' || s === 'degraded' || s === 'unavailable' || s === 'not_set_up';
}

const VERB: Record<'delayed' | 'degraded' | 'unavailable', string> = {
  delayed: 'are delayed',
  degraded: 'are not updating reliably',
  unavailable: 'are unavailable right now',
};

export function coverageNotice(input: {
  lat: number;
  lon: number;
  /** Search radius in miles. Defaults to the area check's 25. */
  radiusMi?: number;
  /** The trade ids the screen is about (one on /check, the member's plan trades in the app). Empty = every trade. */
  trades: readonly string[];
  states: StateLookup | null | undefined;
  now: number;
}): CoverageNotice | null {
  const { states } = input;
  if (!states) return null;
  const candidates: Array<{ id: string; name: string }> = [];
  const datasets = new Map(enabledDatasets().map((d) => [d.id, d]));
  for (const c of localSourcesNear(input.lat, input.lon, input.radiusMi ?? LOCAL_COVERAGE_RADIUS_MI)) {
    const ds = datasets.get(c.id);
    const noun = ds ? TYPE_NOUN[ds.subtype] : undefined;
    if (!ds || !noun || !receives(ds.subtype, input.trades)) continue;
    candidates.push({ id: c.id, name: `${c.city} ${noun}` });
  }
  for (const n of NATIONAL) if (receives(n.type, input.trades)) candidates.push({ id: n.id, name: n.name });

  // One entry per name. Within a name the worst state wins; of equals, the oldest last update.
  const byName = new Map<string, CoverageNotice['affected'][number]>();
  for (const c of candidates) {
    const s = states[c.id];
    if (!s || !isState(s.state) || !isBehind(s.state)) continue;
    const cur = byName.get(c.name);
    const next = { name: c.name, state: s.state, lastSuccessAt: s.lastSuccessAt };
    const worse =
      !cur ||
      STATE_SEVERITY[next.state] < STATE_SEVERITY[cur.state] ||
      (next.state === cur.state && (next.lastSuccessAt ?? '') < (cur.lastSuccessAt ?? ''));
    if (worse) byName.set(c.name, next);
  }
  const affected = [...byName.values()].sort(
    (a, b) => STATE_SEVERITY[a.state] - STATE_SEVERITY[b.state] || a.name.localeCompare(b.name),
  );
  if (affected.length === 0) return null;

  const [main, ...rest] = affected;
  const t = main.lastSuccessAt ? Date.parse(main.lastSuccessAt) : NaN;
  const last = Number.isFinite(t) ? `last update ${agePhrase(input.now - t)} ago` : 'no update yet';
  const more = rest.length > 0 ? ` ${rest.length} more ${rest.length === 1 ? 'source near you is' : 'sources near you are'} also behind.` : '';
  const verb = VERB[main.state as 'delayed' | 'degraded' | 'unavailable'];
  return { line: `${main.name} ${verb}; ${last}.${more} Some recent records may be missing here.`, affected };
}
