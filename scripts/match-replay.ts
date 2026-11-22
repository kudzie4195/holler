/**
 * Replays the REAL matcher (lib/signals/match.ts matchSignals) over a fixture of stored signal rows for synthetic members, and compares
 * it with the old trade rule (a record matched when its categories shared a trade with the member).
 *
 *   npx tsx scripts/match-replay.ts <fixture.json> [--json out.json]
 *
 * Fixture: the same rows as scripts/opportunity-replay.ts ({ id, source, kind, title, summary, categories, severity, state, city, lat,
 * lon, occurred_at, data }).
 * Members: one per trade in CATEGORY_IDS for every fixture city that has rows with coordinates, centred on the median point of that
 * city's rows, radius 25 miles, Starter plan (active), no keyword watches.
 * Both rules run with the scan's own per-member business cap (5 new-business rows, nearest first) and no 25-row cap, so the counts are
 * every row each rule lets through over the whole fixture.
 *   before: area test (matchArea, the scan's) and record categories overlap the member's trades, then pickHits.
 *   after:  matchSignals, unchanged, as the scan, rematch and the request flow call it.
 * Prints per trade: before, after, kept (both), dropped (before only), gained (after only), and after split by the member's label.
 * Exits 1 when an invariant fails:
 *   M1 no after-match is 'context' for its member (hitLabel).
 *   M2 no roofing member gets a roof permit (title names the Roof kind) as act or soon.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { CATEGORY_IDS } from '../lib/signals/categories';
import { MAX_BUSINESS_PER_USER, hitLabel, matchArea, matchSignals, pickHits, type Hit, type MatchProfile, type MatchSignal } from '../lib/signals/match';
import { matchScope } from '../lib/plan/scope';
import { permitKindsFromTitle, type Opportunity } from '../lib/signals/opportunity';

interface Row {
  id: number;
  source: string;
  kind: string;
  title: string | null;
  summary: string | null;
  categories: string[] | null;
  severity: number | null;
  state: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  occurred_at: string;
  data: Record<string, unknown> | null;
}

const args = process.argv.slice(2);
const fixturePath = args.find((a) => !a.startsWith('--'));
const jsonIdx = args.indexOf('--json');
const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : undefined;
if (!fixturePath) {
  console.error('usage: npx tsx scripts/match-replay.ts <fixture.json> [--json out.json]');
  process.exit(2);
}

const rows = JSON.parse(readFileSync(fixturePath, 'utf8')) as Row[];
const signals: MatchSignal[] = rows.map((r) => ({
  id: Number(r.id),
  kind: r.kind,
  source: r.source,
  title: r.title,
  summary: r.summary,
  categories: r.categories ?? [],
  lat: typeof r.lat === 'number' ? r.lat : null,
  lon: typeof r.lon === 'number' ? r.lon : null,
  state: r.state,
  severity: typeof r.severity === 'number' ? r.severity : 1,
  occurred_at: r.occurred_at,
  subtype: r.data && typeof r.data.subtype === 'string' ? r.data.subtype : null,
  data: r.data,
}));
const byId = new Map(signals.map((s) => [s.id, s]));
const nowMs = Math.max(...signals.map((s) => Date.parse(s.occurred_at)).filter(Number.isFinite));
const now = new Date(nowMs);

// ---- synthetic members --------------------------------------------------------------------------------------------------------
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const cityPoints = new Map<string, { state: string | null; lats: number[]; lons: number[] }>();
for (const r of rows) {
  if (!r.city || typeof r.lat !== 'number' || typeof r.lon !== 'number') continue;
  const key = `${r.city}, ${r.state ?? ''}`;
  const c = cityPoints.get(key) ?? { state: r.state, lats: [], lons: [] };
  c.lats.push(r.lat);
  c.lons.push(r.lon);
  cityPoints.set(key, c);
}
const cities = [...cityPoints.entries()].map(([name, c]) => ({ name, state: c.state, lat: median(c.lats), lon: median(c.lons), rows: c.lats.length }));
const profiles: (MatchProfile & { trade: string; city: string })[] = [];
for (const c of cities) {
  for (const t of CATEGORY_IDS) {
    profiles.push({
      user_id: `${t}@${c.name}`,
      trade: t,
      city: c.name,
      categories: [t],
      lat: c.lat,
      lon: c.lon,
      state: c.state,
      radius_mi: 25,
      plan: 'starter',
      subscription_status: 'active',
      extra_areas: [],
      keywords: [],
    });
  }
}
const profileById = new Map(profiles.map((p) => [p.user_id, p]));
const CAP = Number.MAX_SAFE_INTEGER;

// ---- before: the old rule (categories overlap), same area test and business cap -------------------------------------------------
const before = new Map<string, Set<number>>();
for (const p of profiles) {
  const trades = matchScope(p).categories;
  const hits: Hit[] = [];
  for (const s of signals) {
    if (!s.categories.some((c) => trades.includes(c))) continue;
    const where = matchArea(s, p);
    if (where) hits.push({ s, distance_mi: where.distance_mi });
  }
  before.set(p.user_id, new Set(pickHits(hits, nowMs, CAP, MAX_BUSINESS_PER_USER).map((h) => h.s.id)));
}

// ---- after: the real matcher ---------------------------------------------------------------------------------------------------
const after = new Map<string, Set<number>>();
const t0 = Date.now();
for (const r of matchSignals(signals, profiles, CAP, now)) {
  const set = after.get(r.user_id) ?? new Set<number>();
  set.add(r.signal_id);
  after.set(r.user_id, set);
}
const matchMs = Date.now() - t0;

// ---- per trade -------------------------------------------------------------------------------------------------------------------
interface TradeRow {
  trade: string;
  before: number;
  after: number;
  kept: number;
  dropped: number;
  gained: number;
  byLabel: Record<Opportunity, number>;
}
const perTrade = new Map<string, TradeRow>();
for (const t of CATEGORY_IDS) perTrade.set(t, { trade: t, before: 0, after: 0, kept: 0, dropped: 0, gained: 0, byLabel: { act: 0, soon: 0, intel: 0, context: 0 } });
const failures: string[] = [];
const gainedExamples = new Map<string, Map<string, number>>();
const droppedExamples = new Map<string, Map<string, number>>();
const titleKey = (t: string | null | undefined) =>
  String(t ?? '')
    .replace(/\bnear .*$/i, 'near *')
    .replace(/\bin [^:]+?(?=:|$)/, 'in *')
    .slice(0, 90);
const bump = (m: Map<string, Map<string, number>>, trade: string, k: string) => {
  const inner = m.get(trade) ?? new Map<string, number>();
  inner.set(k, (inner.get(k) ?? 0) + 1);
  m.set(trade, inner);
};

for (const p of profiles) {
  const row = perTrade.get(p.trade)!;
  const b = before.get(p.user_id) ?? new Set<number>();
  const a = after.get(p.user_id) ?? new Set<number>();
  row.before += b.size;
  row.after += a.size;
  for (const id of b) {
    if (a.has(id)) row.kept++;
    else {
      row.dropped++;
      bump(droppedExamples, p.trade, titleKey(byId.get(id)?.title));
    }
  }
  for (const id of a) {
    const s = byId.get(id)!;
    if (!b.has(id)) {
      row.gained++;
      bump(gainedExamples, p.trade, titleKey(s.title));
    }
    const label = hitLabel(s, profileById.get(p.user_id)!);
    row.byLabel[label]++;
    if (label === 'context') failures.push(`M1 context match: ${p.user_id} <- #${id} ${s.title}`);
    if (p.trade === 'roofing' && (label === 'act' || label === 'soon') && (s.kind === 'permit' || s.subtype === 'permit')) {
      if (permitKindsFromTitle(s.title).kinds.includes('roof')) failures.push(`M2 roof permit as ${label} for roofing: ${p.user_id} <- #${id} ${s.title}`);
    }
  }
}

// ---- report ----------------------------------------------------------------------------------------------------------------------
const out: string[] = [];
const log = (s = '') => out.push(s);
log(`match-replay: ${rows.length} rows, ${cities.length} cities with coordinates, ${CATEGORY_IDS.length} trades, ${profiles.length} members`);
log(`members: radius 25 mi, Starter (active), no keywords; per-member business cap ${MAX_BUSINESS_PER_USER}, no 25-row cap; matchSignals ran in ${matchMs} ms`);
log('');
const pad = (s: string | number, n: number) => String(s).padStart(n);
log(`${'trade'.padEnd(24)}${pad('before', 8)}${pad('after', 8)}${pad('kept', 8)}${pad('dropped', 9)}${pad('gained', 8)}${pad('act', 7)}${pad('soon', 7)}${pad('intel', 7)}${pad('context', 9)}`);
const tot = { before: 0, after: 0, kept: 0, dropped: 0, gained: 0, act: 0, soon: 0, intel: 0, context: 0 };
for (const r of perTrade.values()) {
  log(
    `${r.trade.padEnd(24)}${pad(r.before, 8)}${pad(r.after, 8)}${pad(r.kept, 8)}${pad(r.dropped, 9)}${pad(r.gained, 8)}${pad(r.byLabel.act, 7)}${pad(r.byLabel.soon, 7)}${pad(r.byLabel.intel, 7)}${pad(r.byLabel.context, 9)}`,
  );
  tot.before += r.before;
  tot.after += r.after;
  tot.kept += r.kept;
  tot.dropped += r.dropped;
  tot.gained += r.gained;
  tot.act += r.byLabel.act;
  tot.soon += r.byLabel.soon;
  tot.intel += r.byLabel.intel;
  tot.context += r.byLabel.context;
}
log(
  `${'TOTAL'.padEnd(24)}${pad(tot.before, 8)}${pad(tot.after, 8)}${pad(tot.kept, 8)}${pad(tot.dropped, 9)}${pad(tot.gained, 8)}${pad(tot.act, 7)}${pad(tot.soon, 7)}${pad(tot.intel, 7)}${pad(tot.context, 9)}`,
);
log('');
const top = (m: Map<string, number> | undefined, n = 4) =>
  [...(m ?? new Map()).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${v}x ${k}`)
    .join(' | ');
log('Most common dropped (old rule matched, now context) and gained (downstream or text-only) titles, per trade:');
for (const t of CATEGORY_IDS) {
  const d = top(droppedExamples.get(t));
  const g = top(gainedExamples.get(t));
  if (!d && !g) continue;
  log(`  ${t}`);
  if (d) log(`    dropped: ${d}`);
  if (g) log(`    gained:  ${g}`);
}
log('');
log(`M1 (no after-match is context for its member): ${failures.some((f) => f.startsWith('M1')) ? 'FAIL' : 'ok'}`);
log(`M2 (no roof permit is act or soon for a roofing member): ${failures.some((f) => f.startsWith('M2')) ? 'FAIL' : 'ok'}`);
for (const f of failures.slice(0, 40)) log(`  ${f}`);
if (failures.length > 40) log(`  ... ${failures.length - 40} more`);
log(failures.length ? `RESULT: FAIL (${failures.length})` : 'RESULT: PASS');

console.log(out.join('\n'));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ perTrade: [...perTrade.values()], totals: tot, failures }, null, 2));
process.exit(failures.length ? 1 : 0);
