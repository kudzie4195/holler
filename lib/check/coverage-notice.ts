import { enabledDatasets, SIGNAL_TRADES, type SignalTypeId } from '@/lib/signals/capabilities';
import { localSourcesNear, LOCAL_COVERAGE_RADIUS_MI } from '@/lib/check/coverage';
import { agePhrase, isBehind, STATE_SEVERITY, type SourceState } from '@/lib/signals/source-state';
import { t as tr, localizeDate, type Lang } from '@/lib/i18n';

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
 * "Last update" is the newest record date the source actually returned (lastRecordAt), never the time of its last error-free run: a
 * source can run cleanly every hour and still have returned nothing new for a week. When the source is running but has returned
 * nothing for a while (repeated_empty / repeated_trouble) the line says "no new records since Nov 12" instead; a source that has never
 * returned a record says "no records received yet".
 *
 * Wording: plain and calm. No "lead". It never says a record is missing, only that some recent ones may be.
 */
export interface CoverageNotice {
  /** The one line to show. */
  line: string;
  /** The affected sources, worst first, one per name (several layers of one county are one entry). */
  affected: Array<{ name: string; state: SourceState; reason: string | null; lastRecordAt: string | null }>;
}

export interface StateLookup {
  [sourceId: string]: { state: string; reason?: string | null; lastRecordAt: string | null } | undefined;
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

/** "Nov 12", in UTC so the line reads the same on the server and in any test. */
function shortDate(t: number): string {
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Spanish twin of agePhrase (same rounding). */
function agePhraseLang(ageMs: number, lang: Lang): string {
  const mins = Math.max(0, Math.round(ageMs / 60_000));
  if (mins < 90) return tr(lang, mins <= 1 ? 'age.minute' : 'age.minutes', { n: Math.max(1, mins) });
  const hours = Math.round(mins / 60);
  if (hours < 48) return tr(lang, hours === 1 ? 'age.hour' : 'age.hours', { n: hours });
  return tr(lang, 'age.days', { n: Math.round(hours / 24) });
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
  /** 'es' writes the line and the source names in Spanish from the dictionary. English (the default) is unchanged. */
  lang?: Lang;
}): CoverageNotice | null {
  const lang: Lang = input.lang ?? 'en';
  const { states } = input;
  if (!states) return null;
  const candidates: Array<{ id: string; name: string }> = [];
  const datasets = new Map(enabledDatasets().map((d) => [d.id, d]));
  for (const c of localSourcesNear(input.lat, input.lon, input.radiusMi ?? LOCAL_COVERAGE_RADIUS_MI)) {
    const ds = datasets.get(c.id);
    const noun = ds ? TYPE_NOUN[ds.subtype] : undefined;
    if (!ds || !noun || !receives(ds.subtype, input.trades)) continue;
    candidates.push({ id: c.id, name: lang === 'en' ? `${c.city} ${noun}` : tr(lang, 'cov.name', { city: c.city, noun: tr(lang, `cov.type.${ds.subtype}` as 'cov.type.permit') }) });
  }
  for (const n of NATIONAL) if (receives(n.type, input.trades)) candidates.push({ id: n.id, name: lang === 'en' ? n.name : tr(lang, `cov.national.${n.id}` as 'cov.national.nws') });

  // One entry per name. Within a name the worst state wins; of equals, the oldest last update.
  const byName = new Map<string, CoverageNotice['affected'][number]>();
  for (const c of candidates) {
    const s = states[c.id];
    if (!s || !isState(s.state) || !isBehind(s.state)) continue;
    const cur = byName.get(c.name);
    const next = { name: c.name, state: s.state, reason: s.reason ?? null, lastRecordAt: s.lastRecordAt ?? null };
    const worse =
      !cur ||
      STATE_SEVERITY[next.state] < STATE_SEVERITY[cur.state] ||
      (next.state === cur.state && (next.lastRecordAt ?? '') < (cur.lastRecordAt ?? ''));
    if (worse) byName.set(c.name, next);
  }
  const affected = [...byName.values()].sort(
    (a, b) => STATE_SEVERITY[a.state] - STATE_SEVERITY[b.state] || a.name.localeCompare(b.name),
  );
  if (affected.length === 0) return null;

  const [main, ...rest] = affected;
  const t = main.lastRecordAt ? Date.parse(main.lastRecordAt) : NaN;
  if (lang !== 'en') {
    const quietEs = main.reason === 'repeated_empty' || main.reason === 'repeated_trouble';
    const lastEs = !Number.isFinite(t)
      ? tr(lang, 'cov.none')
      : quietEs
        ? tr(lang, 'cov.quiet', { date: (localizeDate(shortDate(t), lang) ?? '') })
        : tr(lang, 'cov.last', { age: agePhraseLang(input.now - t, lang) });
    const moreEs = rest.length > 0 ? (rest.length === 1 ? tr(lang, 'cov.more_one') : tr(lang, 'cov.more_many', { n: rest.length })) : '';
    return {
      line: tr(lang, 'cov.line', { name: main.name, verb: tr(lang, `cov.verb.${main.state}` as 'cov.verb.delayed'), last: lastEs, more: moreEs, tail: tr(lang, 'cov.tail') }),
      affected,
    };
  }
  const quiet = main.reason === 'repeated_empty' || main.reason === 'repeated_trouble';
  const last = !Number.isFinite(t)
    ? 'no records received yet'
    : quiet
      ? `no new records since ${shortDate(t)}`
      : `last update ${agePhrase(input.now - t)} ago`;
  const more = rest.length > 0 ? ` ${rest.length} more ${rest.length === 1 ? 'source near you is' : 'sources near you are'} also behind.` : '';
  const verb = VERB[main.state as 'delayed' | 'degraded' | 'unavailable'];
  return { line: `${main.name} ${verb}; ${last}.${more} Some recent records may be missing here.`, affected };
}
