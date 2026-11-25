/**
 * Round 19 RULES: replay of this product's label engine (lib/signals/lead-rules.ts) over the live export, with the proof the audit asked
 * for (review-ENGINE-compare.md section 5 and the RULES unit brief). Read-only: no database, no network, no clock.
 *
 *   npm run replay:rules                              defaults below
 *   npm run replay:rules -- <rows.json> <report.txt> <per-row.jsonl> <engine-compare.jsonl>
 *
 * Inputs: the live rows (public records, 21,366 rows of Nov 8 to Dec 6 2026) and, for the "before" column, the earlier per-row output of the
 * comparison (engine-compare.jsonl: engine A at 8bee203, whose labels equal this branch's base for every live source).
 * Engine B (the other team's engine, kept unchanged under reference/r10-engine) is loaded HERE ONLY, at run time, for the 4 by 4 table and
 * for its permit-kind vocabulary in invariant I1. No product file imports it (tests/integration/r19-unify-boundaries.test.ts).
 *
 * The ingest marks of lib/signals/repeat-marks.ts (the per-building heat count, repeated NWS alerts, storm reports listed twice, the
 * orders of one code-violation visit) are applied to the rows first, with the same pure functions the scan calls, as if every row arrived
 * in time order. The heat count is also run in three other arrival orders (review P2-5) to show it gives the same buildings.
 */
import { parseSocrataReport } from '../lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '../lib/signals/adapters/socrata-datasets';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CATEGORY_IDS, type CategoryId } from '../lib/signals/categories';
import { cannotBeDelivered, isAlertLabel, labelFor, RULES, ruleFor, SOURCE_DEFAULTS, type LabelInput, type OpportunityLabel } from '../lib/signals/lead-rules';
import { carriedTrades, routeKindsOf } from '../lib/signals/permit-routing';
import { matchOne, type MatchProfile, type MatchSignal } from '../lib/signals/match';
import {
  buildingKeyOf,
  heatTriggers,
  isWholeBuildingHeat,
  nwsRepeatKeyOf,
  nwsRepeats,
  nwsRootRef,
  orderMeaning,
  repeatsWithin,
  spcReportKeyOf,
  SPC_REPEAT_HOURS,
  withHeatMark,
  hasHeatMark,
  violationVisits,
  visitKeyOf,
  withAlsoCited,
  type TimelineRow,
} from '../lib/signals/repeat-marks';
import { businessTagFixEnabled, retagStoredBusinessRow } from '../lib/signals/mapping/business';
import { RULE_CHOICE_QUESTIONS, RULE_CHOICES, withRuleChoices } from '../lib/signals/rule-choices';

const ROWS = process.argv[2] ?? '/home/claude/gates/r19/data/signals-14d.json';
const OUT = process.argv[3] ?? '/home/claude/gates/r19/logs/RULES-replay.txt';
const PER_ROW = process.argv[4] ?? '/home/claude/gates/r19/data/rules-after.jsonl';
const BEFORE = process.argv[5] ?? '/home/claude/gates/r19/data/engine-compare.jsonl';
const REPO = join(__dirname, '..');

interface Row {
  id: number;
  source: string;
  kind: string;
  title: string | null;
  summary: string | null;
  categories: string[] | null;
  state: string | null;
  city: string | null;
  severity: number;
  occurred_at: string;
  url: string | null;
  data: Record<string, unknown> | null;
  lat: number | null;
  lon: number | null;
}

type Level = 'urgent' | 'heads-up' | 'background' | 'none';
const LEVELS: Level[] = ['urgent', 'heads-up', 'background', 'none'];
const LEVEL_OF: Record<OpportunityLabel, Level> = { act_now: 'urgent', coming_soon: 'heads-up', market_insight: 'background', context: 'none' };
const isAlert = (l: Level) => l === 'urgent' || l === 'heads-up';
const TRADES = CATEGORY_IDS as readonly CategoryId[];

const rowsRaw = JSON.parse(readFileSync(ROWS, 'utf8')) as Row[];
// Round 33: with HOLLER_BUSINESS_TAG_FIX_ENABLED on, the new-business rows are first re-tagged by their own licence type and the ones outside
// their city's area get no trade: this is the state the owner's re-tag SQL (round 33 report) leaves the stored rows in. Row count and order
// are kept (engine-compare.jsonl is aligned by row). Off (the default), nothing changes and the anchor numbers must hold.
const BUSINESS_FIX = businessTagFixEnabled();
// Side data the export lacks (read-only SELECTs of 2026-11-25, project ksctghdtklufgxblueqp): the stored ZIP of the rows whose point is not
// believable (lat = lon) or sits at the New York City Hall stand-in, and the ids of business rows that have a named business contact.
// Override with HOLLER_REPLAY_BUSINESS_SIDE=<path>.
// Default: the copy kept in the repo (tests/signals/__data__/business-replay-side.json, row ids and ZIPs only, no names or addresses).
const SIDE_PATH = process.env.HOLLER_REPLAY_BUSINESS_SIDE ?? join(process.cwd(), 'tests/signals/__data__/business-replay-side.json');
const SIDE: { zips: Record<string, string>; businessContactIds: string[] } = BUSINESS_FIX && existsSync(SIDE_PATH) ? JSON.parse(readFileSync(SIDE_PATH, 'utf8')) : { zips: {}, businessContactIds: [] };
if (BUSINESS_FIX && !existsSync(SIDE_PATH)) console.error(`WARNING: replay side file not found (${SIDE_PATH}): ZIPs and business contacts are unknown, so the switch-on numbers differ from the report.`);
const BUSINESS_CONTACT = new Set(SIDE.businessContactIds);
let businessRetagged = 0;
const rows: Row[] = BUSINESS_FIX
  ? rowsRaw.map((r) => {
      if (subtypeOfRaw(r) !== 'business') return r;
      const next = retagStoredBusinessRow({ ...r, zip: SIDE.zips[String(r.id)] ?? null });
      if (next.length === (r.categories ?? []).length && next.every((c) => (r.categories ?? []).includes(c))) return r;
      businessRetagged++;
      return { ...r, categories: next };
    })
  : rowsRaw;
function subtypeOfRaw(r: Row) { return typeof r.data?.subtype === 'string' && r.data.subtype ? (r.data.subtype as string) : null; }
const subtypeOf = (r: Row) => (typeof r.data?.subtype === 'string' && r.data.subtype ? (r.data.subtype as string) : null);

// ---- 1. ingest marks ------------------------------------------------------------------------------------------------------------
const t = (iso: string) => Date.parse(iso);
const heatTimeline: TimelineRow[] = rows.filter((r) => isWholeBuildingHeat(r) && buildingKeyOf(r)).map((r) => ({ key: buildingKeyOf(r) as string, t: t(r.occurred_at), id: String(r.id), stored: false }));
const heatHit = heatTriggers(heatTimeline);
const nwsTimeline: TimelineRow[] = rows.filter((r) => nwsRepeatKeyOf(r)).map((r) => ({ key: nwsRepeatKeyOf(r) as string, t: t(r.occurred_at), id: String(r.id), stored: false }));
const nwsRep = nwsRepeats(nwsTimeline);
const spcTimeline: TimelineRow[] = rows.filter((r) => spcReportKeyOf(r)).map((r) => ({ key: spcReportKeyOf(r) as string, t: t(r.occurred_at), id: String(r.id), stored: false }));
const spcRep = repeatsWithin(spcTimeline, SPC_REPEAT_HOURS);
const visits = violationVisits(
  rows
    .filter((r) => visitKeyOf(r))
    .map((r) => ({ key: visitKeyOf(r) as string, id: String(r.id), source: r.source, kind: r.kind, title: r.title, summary: r.summary, categories: r.categories ?? [], stored: false })),
);
const marked: Row[] = rows.map((r) => {
  const id = String(r.id);
  if (heatHit.has(id)) return { ...r, summary: withHeatMark(r.summary) };
  const root = nwsRep.get(id);
  if (root) return { ...r, data: { ...(r.data ?? {}), projectOf: nwsRootRef(root) } };
  const spcRoot = spcRep.get(id);
  if (spcRoot) return { ...r, data: { ...(r.data ?? {}), projectOf: `spc:${spcRoot}` } };
  const lead = visits.followerOf.get(id);
  if (lead) return { ...r, data: { ...(r.data ?? {}), projectOf: `${r.source}:${lead}` } };
  const cited = visits.alsoCited.get(id);
  const tags = visits.categories.get(id);
  if (cited || tags) return { ...r, ...(cited ? { summary: withAlsoCited(r.summary, cited) } : {}), ...(tags ? { categories: tags } : {}) };
  return r;
});
const follower = (r: Row) => typeof r.data?.projectOf === 'string' && (r.data.projectOf as string).length > 0;

// ---- 2. this engine, per pair ---------------------------------------------------------------------------------------------------
interface Opts {
  /** Count pairs on undeliverable rows and NWS repeats as the label says (the audit's simulation did). */
  labelsOnly?: boolean;
}
function inputOf(r: Row, labelsOnly: boolean): LabelInput {
  const base: LabelInput = { source: r.source, kind: r.kind, subtype: subtypeOf(r), title: r.title, summary: r.summary };
  return labelsOnly ? base : { ...base, lat: r.lat, lon: r.lon, state: r.state, severity: r.severity };
}
interface PairOut {
  lvl: Partial<Record<CategoryId, Level>>;
  rule: Partial<Record<CategoryId, string>>;
}
function runEngine(src: Row[], opts: Opts = {}): PairOut[] {
  return src.map((r) => {
    const input = inputOf(r, !!opts.labelsOnly);
    const carried = carriedTrades({ source: r.source, kind: r.kind, subtype: subtypeOf(r), title: r.title, summary: r.summary }, r.categories);
    const lvl: PairOut['lvl'] = {};
    const rule: PairOut['rule'] = {};
    for (const tr of TRADES) {
      if (!carried.includes(tr)) continue;
      if (!opts.labelsOnly && follower(r)) {
        rule[tr] = r.source === 'nws' ? 'nws-repeat (follower, repeat-marks.ts)' : r.source === 'spc' ? 'spc-repeat (follower, repeat-marks.ts)' : 'violation-visit (follower, repeat-marks.ts)';
        continue;
      }
      let l = LEVEL_OF[labelFor(input, tr)];
      // Round 33 (switch on): a licence with no named business is feed only (alert-gate.ts alertHoldFor, hold 'background').
      if (BUSINESS_FIX && !process.env.HOLLER_REPLAY_NO_LICENCE_HOLD && subtypeOf(r) === 'business' && isAlert(l) && !BUSINESS_CONTACT.has(String(r.id))) l = 'background';
      rule[tr] = ruleFor(input, tr)?.id ?? `default:${r.source}`;
      if (l !== 'none') lvl[tr] = l;
    }
    return { lvl, rule };
  });
}
const count = (out: PairOut[]) => {
  const c: Record<Level, number> = { urgent: 0, 'heads-up': 0, background: 0, none: 0 };
  for (const o of out) for (const l of Object.values(o.lvl)) c[l as Level]++;
  return c;
};

const after = runEngine(marked);
const labelsOnlyHeatOff = withRuleChoices({ heatPerBuilding: false }, () => runEngine(rows, { labelsOnly: true }));
const heatOnly: Row[] = rows.map((r) => (heatHit.has(String(r.id)) ? { ...r, summary: withHeatMark(r.summary) } : r));
const labelsOnlyHeatOn = runEngine(heatOnly, { labelsOnly: true });
const labelsOnlyAuditCalls = withRuleChoices({ shopLicenceAlerts: false, failedInspectionAlertsCommercialCleaners: false }, () => runEngine(heatOnly, { labelsOnly: true }));
// The round's first commit (6edfc79) defaults for owner call 6 (YES): what changing it to NO removed, labels only.
const labelsOnlyCall6Yes = withRuleChoices({ failedInspectionAlertsCommercialCleaners: true }, () => runEngine(heatOnly, { labelsOnly: true }));
const deliverableHeatOff = withRuleChoices({ heatPerBuilding: false }, () => runEngine(marked));

// ---- 3. before (engine A at the base) and engine B ------------------------------------------------------------------------------
interface CompareRow {
  id: number;
  a: Record<string, Level>;
  b: Record<string, Level>;
}
const before: CompareRow[] = readFileSync(BEFORE, 'utf8')
  .trim()
  .split('\n')
  .map((l) => {
    const j = JSON.parse(l) as CompareRow;
    return { id: j.id, a: j.a, b: j.b };
  });
if (before.length !== rows.length || before.some((b, i) => b.id !== rows[i].id)) throw new Error('engine-compare.jsonl is not aligned with the rows');

// Engine B, loaded at run time from the reference copy (never by product code).
type BModule = {
  opportunityTrades: (sig: unknown) => Partial<Record<string, 'act' | 'soon' | 'intel' | 'context'>>;
  PERMIT_KIND_LABELS: readonly { id: string; label: string }[];
  PERMIT_DOING: Record<string, string[]>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const engineB = require(join(REPO, 'reference', 'r10-engine', 'lib', 'signals', 'opportunity.ts')) as BModule;
const B_LEVEL: Record<string, Level> = { act: 'urgent', soon: 'heads-up', intel: 'background', context: 'none' };
let bMismatch = 0;
const bLevels: Record<string, Level>[] = rows.map((r, i) => {
  const got = engineB.opportunityTrades({ kind: r.kind, subtype: subtypeOf(r), source: r.source, title: r.title, summary: r.summary, categories: r.categories ?? [], severity: r.severity, data: r.data ?? {} });
  const out: Record<string, Level> = {};
  for (const tr of TRADES) out[tr] = B_LEVEL[got[tr] ?? 'context'];
  // engine B's matcher never delivers a trade it does not list; the earlier comparison stored the same levels
  for (const tr of TRADES) if (out[tr] !== before[i].b[tr]) bMismatch++;
  return out;
});

// ---- 4. report helpers ----------------------------------------------------------------------------------------------------------
const lines: string[] = [];
const P = (s = '') => lines.push(s);
const lv = (o: PairOut, tr: CategoryId): Level => o.lvl[tr] ?? 'none';
const fmt = (n: number) => n.toLocaleString('en-US');

P('RULES replay: this engine (lib/signals/lead-rules.ts) over the live export');
P(`Rows: ${fmt(rows.length)} from ${ROWS}. Trades: ${TRADES.length}. Pairs: ${fmt(rows.length * TRADES.length)}.`);
P(`Business tag fix (HOLLER_BUSINESS_TAG_FIX_ENABLED): ${BUSINESS_FIX ? `ON, ${fmt(businessRetagged)} stored business rows re-tagged by licence type before the engine runs` : 'OFF, stored tags used as they are (the anchor)'}.`);

// Round 33 (review P1-1): the live INGEST path, run on the repo's fixtures with the switch off and on, so a re-tag of stored rows cannot hide
// a feed that stores nothing. Switch off: the first two columns only. The SF live-shape rows are the 2026-11-16 capture's own shape (no type
// text, only self_reported_naics_code) with retail, food service, hotel and nonstore codes.
const ingestLines: string[] = [];
const ingestFailures: string[] = [];
{
  const fx = (f: string) => JSON.parse(readFileSync(join(REPO, 'tests', 'fixtures', f), 'utf8')) as Record<string, unknown>[];
  const sfLive = fx('socrata-sf-business-live-2026-11-16.json');
  const liveShape = (code: string, id: string) => ({ ...sfLive[0], uniqueid: id, self_reported_naics_code: code });
  const sets: Array<[string, Record<string, unknown>[]]> = [
    ['socrata-chicago-business', fx('socrata-chicago-business.json')],
    ['socrata-la-business', fx('socrata-la-business.json')],
    ['socrata-nyc-business', fx('socrata-nyc-business.json')],
    ['socrata-orlando-business', fx('socrata-orlando-business.json')],
    ['socrata-sf-business', fx('socrata-sf-business.json')],
    ['socrata-sf-business (live capture 2026-11-16)', sfLive],
    ['socrata-sf-business (live shape, NAICS 448140 retail, 722511 food, 721110 hotel, 454110 nonstore)', [liveShape('448140', 'ls-1'), liveShape('722511', 'ls-2'), liveShape('721110', 'ls-3'), liveShape('454110', 'ls-4')]],
  ];
  for (const [label, data] of sets) {
    const id = label.split(' ')[0];
    const d = SOCRATA_DATASETS.find((x) => x.id === id);
    if (!d) continue;
    const off = parseSocrataReport(data, d, { businessTagFix: false }).items;
    const on = parseSocrataReport(data, d, { businessTagFix: true }).items;
    ingestLines.push(`| ${label} | ${data.length} | ${off.length} | ${on.length} | ${on.map((i) => [...i.categories].sort().join('+')).filter((x, k, a) => a.indexOf(x) === k).join(' ; ') || '(none)'} |`);
    if (label.includes('live shape') && on.length !== 2) ingestFailures.push(`SF live-shape ingest stores ${on.length} of 2 expected rows with the switch on`);
  }
}
if (BUSINESS_FIX) {
  P('Live ingest of the repo fixtures, switch on (src/lib parseSocrataReport, the scan path): rows stored with the switch off and on');
  P('| fixture | rows | stored off | stored on | trade sets stored on |');
  P('|---|---|---|---|---|');
  ingestLines.forEach((l) => P(l));
  P();
}
P(`Ingest marks applied first (lib/signals/repeat-marks.ts): ${heatHit.size} NYC whole-building heat rows marked (building = point to 4 decimals, a 48 h window holding 3 complaints, one per building per 7 days); ${nwsRep.size} NWS rows marked as repeats of an alert less than 24 h from the first (same data.event, data.areaDesc and place: county, else point to 0.1 degree, else state); ${spcRep.size} storm reports marked as the second listing of a report (same type, value, point, clock time and remark, within ${SPC_REPEAT_HOURS} h); ${visits.followerOf.size} code-violation orders stored as followers of ${new Set(visits.followerOf.values()).size} visit cards (same source, point to 3 decimals, same day, and the same meaning for every trade: repeat-marks.ts orderMeaning).`);
P();

// ---- 5. alert pair counts --------------------------------------------------------------------------------------------------------
const cBefore: Record<Level, number> = { urgent: 0, 'heads-up': 0, background: 0, none: 0 };
for (const b of before) for (const tr of TRADES) cBefore[b.a[tr]]++;
const cB: Record<Level, number> = { urgent: 0, 'heads-up': 0, background: 0, none: 0 };
for (const b of bLevels) for (const tr of TRADES) cB[b[tr]]++;
const show = (name: string, c: Record<Level, number>) => P(`| ${name} | ${fmt(c.urgent + c['heads-up'])} | ${fmt(c.urgent)} | ${fmt(c['heads-up'])} | ${fmt(c.background)} |`);
P('## 1. Alert pairs (urgent + heads-up)');
P();
P('| Engine and stage | Alert pairs | Urgent | Heads-up | Background (feed only) |');
P('|---|---:|---:|---:|---:|');
show('Engine A before this unit (engine-compare.jsonl)', cBefore);
show('Engine B (reference/r10-engine, run now)', cB);
show('This engine, labels only (the audit\'s counting: every row, no repeats removed), heat rule OFF', count(labelsOnlyHeatOff));
show('This engine, labels only, heat rule ON (compare with the audit\'s 5,500, which includes line 3)', count(labelsOnlyHeatOn));
show('This engine, labels only, heat rule ON, owner calls 4 (shops) and 6 answered as the audit\'s simulation assumed (NO, NO)', count(labelsOnlyAuditCalls));
show('This engine, deliverable rows only, heat rule OFF', count(deliverableHeatOff));
show('This engine, FINAL (deliverable rows only, NWS repeats once, heat rule ON)', count(after));
show('For reference: labels only, heat rule ON, owner call 6 as the first commit had it (YES)', count(labelsOnlyCall6Yes));
P();
for (const [name, c] of [['labels only, heat rule ON (the audit\'s list includes line 3)', count(labelsOnlyHeatOn)], ['the same with owner calls 4 and 6 as the audit assumed', count(labelsOnlyAuditCalls)]] as const) {
  const n = c.urgent + c['heads-up'];
  P(`Against the audit's simulated 5,500 (1,194 urgent, 4,306 heads-up), ${name}: ${fmt(n)} alert pairs (${n >= 5500 ? '+' : ''}${((100 * (n - 5500)) / 5500).toFixed(1)}%), urgent ${fmt(c.urgent)}, heads-up ${fmt(c['heads-up'])}.`);
}
{
  const byRule = new Map<string, { u: number; h: number }>();
  for (const o of labelsOnlyHeatOn) for (const [tr, l] of Object.entries(o.lvl)) {
    if (!isAlert(l as Level)) continue;
    const id = o.rule[tr as CategoryId] ?? '';
    const e = byRule.get(id) ?? { u: 0, h: 0 };
    if (l === 'urgent') e.u++;
    else e.h++;
    byRule.set(id, e);
  }
  P(`Where the labels-only alert pairs come from (rule: urgent + heads-up): ${[...byRule].sort((a, b) => b[1].u + b[1].h - a[1].u - a[1].h).map(([k, v]) => `${k} ${v.u}+${v.h}`).join('; ')}.`);
}
P(`Engine B reproduced from reference/r10-engine: ${bMismatch === 0 ? 'identical to the b column of engine-compare.jsonl on every pair' : `${bMismatch} pairs differ from engine-compare.jsonl`}.`);
P();

// ---- 6. 4 by 4 against engine B ----------------------------------------------------------------------------------------------------
P('## 2. This engine (rows, FINAL) against engine B (columns), all pairs');
P();
const grid: Record<Level, Record<Level, number>> = Object.fromEntries(LEVELS.map((a) => [a, Object.fromEntries(LEVELS.map((b) => [b, 0]))])) as never;
for (let i = 0; i < rows.length; i++) for (const tr of TRADES) grid[lv(after[i], tr)][bLevels[i][tr]]++;
P(`| this \\ B | ${LEVELS.join(' | ')} | total |`);
P('|---|---:|---:|---:|---:|---:|');
for (const a of LEVELS) P(`| ${a} | ${LEVELS.map((b) => fmt(grid[a][b])).join(' | ')} | ${fmt(LEVELS.reduce((s, b) => s + grid[a][b], 0))} |`);
let agree = 0;
for (const a of LEVELS) agree += grid[a][a];
const aOnly = LEVELS.filter(isAlert).reduce((s, a) => s + grid[a].background + grid[a].none, 0);
const bOnly = LEVELS.filter(isAlert).reduce((s, b) => s + grid.background[b] + grid.none[b], 0);
P();
P(`Same level: ${fmt(agree)} of ${fmt(rows.length * TRADES.length)}. This engine alerts and B does not: ${fmt(aOnly)}. B alerts and this engine does not: ${fmt(bOnly)}.`);
P();

// ---- 7. invariants -----------------------------------------------------------------------------------------------------------------
P('## 3. Invariants (live rows, FINAL output)');
P();
const kindByLabel = new Map(engineB.PERMIT_KIND_LABELS.map((k) => [k.label.toLowerCase(), k.id]));
const failures: string[] = [];
const inv = (name: string, n: number, what: string, examples: string[]) => {
  P(`- ${name}: ${n === 0 ? 'PASS, 0 violations' : `FAIL, ${n} violations`}. ${what}${examples.length ? ` Examples: ${examples.slice(0, 4).join('; ')}` : ''}`);
  if (n !== 0) failures.push(name);
};
{
  // I1 (engine B's): a permit row never alerts a trade that does the permitted work: B's doing trades of each title kind, plus every tag
  // (real estate and movers on a new home are not doing it).
  const ex: string[] = [];
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (subtypeOf(r) !== 'permit' && r.kind !== 'permit') continue;
    const m = /^(.*?)\s+permit\s+in\s/i.exec(r.title ?? '');
    const doing = new Set<string>();
    if (m) for (const part of m[1].split(/,\s+|\s+and\s+/)) for (const c of engineB.PERMIT_DOING[kindByLabel.get(part.trim().toLowerCase()) ?? ''] ?? []) doing.add(c);
    const newHome = /\bnew home\b/i.test(r.title ?? '');
    for (const c of r.categories ?? []) if (!(newHome && (c === 'real-estate' || c === 'moving'))) doing.add(c);
    for (const tr of doing) if (isAlert(lv(after[i], tr as CategoryId))) {
      n++;
      ex.push(`${r.id} "${r.title}" -> ${tr} ${lv(after[i], tr as CategoryId)}`);
    }
  }
  inv('I1', n, 'No permit row is urgent or heads-up for a trade that does the permitted work (engine B\'s PERMIT_DOING per title kind, plus every tag; real estate and movers on a new home excluded).', ex);
}
{
  const ex: string[] = [];
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (subtypeOf(r) !== '311' || !/graffiti/i.test(r.title ?? '') || /\bprivate\b|\bpriv\b|\bprv\b/i.test(r.title ?? '')) continue;
    for (const tr of ['painting', 'cleaning'] as CategoryId[]) if (isAlert(lv(after[i], tr))) { n++; ex.push(`${r.id} ${tr}`); }
  }
  inv('I2', n, 'No 311 graffiti row without a private marker is urgent or heads-up for painting or cleaning.', ex);
}
{
  const re = /tree trim request|tree planting|sewer cleaning|catch basin|missed trash|fly dumping|rodent baiting/i;
  const ex: string[] = [];
  let n = 0;
  let seen = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (subtypeOf(r) !== '311' || !re.test(r.title ?? '')) continue;
    seen++;
    const bad = TRADES.filter((tr) => lv(after[i], tr) !== 'none');
    if (bad.length) { n++; ex.push(`${r.id} "${r.title}" -> ${bad.join(',')}`); }
  }
  inv('I3', n, `Every Tree Trim, Tree Planting, Sewer Cleaning, catch basin, Missed Trash, Fly Dumping, Rodent Baiting 311 row (${seen} rows) is none for every trade.`, ex);
}
{
  // I4, rewritten for the per-building heat rule (owner call 1). Whole building: HVAC urgent on the marked row and none on every other;
  // apartment only: HVAC background; plumbing background on both unless the body names hot water alone.
  const ex: string[] = [];
  let n = 0;
  let rowsSeen = 0;
  let urgent = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = marked[i];
    if (r.source !== 'socrata-nyc-311' || !/HEAT\/HOT WATER/i.test(r.title ?? '')) continue;
    rowsSeen++;
    const whole = /ENTIRE BUILDING/i.test(r.title ?? '');
    const wantHvac: Level = whole ? (hasHeatMark(r.summary) ? 'urgent' : 'none') : 'background';
    const wantPlumbing: Level = /no hot water|hot water only|water only/i.test(r.title ?? '') ? 'urgent' : 'background';
    if (lv(after[i], 'hvac') === 'urgent') urgent++;
    if (lv(after[i], 'hvac') !== wantHvac) { n++; ex.push(`${r.id} hvac ${lv(after[i], 'hvac')} (wants ${wantHvac})`); }
    if (lv(after[i], 'plumbing') !== wantPlumbing) { n++; ex.push(`${r.id} plumbing ${lv(after[i], 'plumbing')} (wants ${wantPlumbing})`); }
  }
  inv('I4 (rewritten)', n, `NYC HEAT/HOT WATER rows (${rowsSeen}): whole building is urgent for HVAC only on the building's marked row (${urgent} rows) and none otherwise; apartment only is background for HVAC; plumbing is background unless hot water alone is named.`, ex);
}
{
  const live = [...new Set(rows.map((r) => r.source))];
  const missing = live.filter((s) => !(s in SOURCE_DEFAULTS));
  inv('I5', missing.length, `Every live source (${live.length}) has an explicit SOURCE_DEFAULTS entry; none falls to FALLBACK_LABEL.`, missing);
  const byDefault = new Map<string, number>();
  let alertPairs = 0;
  for (const o of after) for (const [tr, l] of Object.entries(o.lvl)) {
    if (!isAlert(l as Level)) continue;
    alertPairs++;
    const k = o.rule[tr as CategoryId] ?? '';
    if (k.startsWith('default:')) byDefault.set(k, (byDefault.get(k) ?? 0) + 1);
  }
  const d = [...byDefault.values()].reduce((a, b) => a + b, 0);
  P(`  Alert pairs decided by a bare source default rather than a named rule: ${fmt(d)} of ${fmt(alertPairs)} (before: 6,583 of 26,919). ${[...byDefault].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
{
  // Review P3 item 13: inspections, licences and event permits default to heads-up for a tagged trade no rule lists; no live pair may be
  // decided that way (any label).
  const ex: string[] = [];
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    if (!['inspection', 'business', 'event-permit'].includes(subtypeOf(rows[i]) ?? '')) continue;
    for (const [tr, id] of Object.entries(after[i].rule)) if ((id as string).startsWith('default:')) { n++; ex.push(`${rows[i].id} ${tr} ${id}`); }
  }
  inv('I6 (review P3 item 13)', n, 'No inspection, licence or event-permit pair is decided by the bare source default.', ex);
}
{
  // Review P1-A, P1-B: a merged NWS pair is the same event for the same place.
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const miles = (a: Row, b: Row) => {
    const k = Math.PI / 180;
    const h = Math.sin(((b.lat! - a.lat!) * k) / 2) ** 2 + Math.cos(a.lat! * k) * Math.cos(b.lat! * k) * Math.sin(((b.lon! - a.lon!) * k) / 2) ** 2;
    return 2 * 3958.8 * Math.asin(Math.sqrt(h));
  };
  const ex: string[] = [];
  let n = 0;
  let withPoints = 0;
  let maxMi = 0;
  let noPoint = 0;
  for (const [a, b] of nwsRep) {
    const [ra, rb] = [byId.get(a)!, byId.get(b)!];
    if (ra.lat === null || rb.lat === null) { noPoint++; continue; }
    withPoints++;
    const d = miles(ra, rb);
    maxMi = Math.max(maxMi, d);
    if (d > 10) { n++; ex.push(`${a} follows ${b}, ${d.toFixed(0)} mi`); }
  }
  inv('I7 (review P1)', n, `No NWS repeat is more than 10 miles from the row it follows (${nwsRep.size} repeats: ${withPoints} with a point on both rows, largest gap ${maxMi.toFixed(1)} mi; ${noPoint} state-level rows without a point, which no member can receive).`, ex);
}
{
  // Review P2-2 and P3 item 4: a visit card's first order alone earns the card's label for every trade, and every order folded into it
  // keeps every trade and label it had alone.
  const alone = runEngine(rows);
  const idx = new Map(rows.map((r, i) => [String(r.id), i]));
  const rank: Record<Level, number> = { urgent: 3, 'heads-up': 2, background: 1, none: 0 };
  const ex: string[] = [];
  let n = 0;
  for (const [f, lead] of visits.followerOf) {
    const [fi, li] = [idx.get(f)!, idx.get(lead)!];
    for (const tr of Object.keys(alone[fi].rule) as CategoryId[]) {
      if (rank[lv(after[li], tr)] < rank[lv(alone[fi], tr)]) { n++; ex.push(`${f} ${tr} ${lv(alone[fi], tr)} alone, card ${lead} gives ${lv(after[li], tr)}`); }
    }
  }
  for (const lead of new Set(visits.followerOf.values())) {
    const li = idx.get(lead)!;
    for (const tr of TRADES) if (lv(after[li], tr) !== lv(alone[li], tr)) { n++; ex.push(`card ${lead} ${tr} ${lv(after[li], tr)}, its own order ${lv(alone[li], tr)}`); }
  }
  const leads = [...new Set(visits.followerOf.values())];
  const sameMeaning = leads.every((lead) => {
    const r = rows[idx.get(lead)!];
    const m = orderMeaning(r);
    return [...visits.followerOf].filter(([, l]) => l === lead).every(([f]) => orderMeaning(rows[idx.get(f)!]) === m);
  });
  if (!sameMeaning) { n++; ex.push('a card holds orders of different meaning'); }
  inv('I8 (review P2-2, P3 item 4)', n, `Visit grouping: each of the ${leads.length} cards' own first order earns the card's label for every trade, and none of the ${visits.followerOf.size} folded orders loses a trade or a level.`, ex);
}
{
  // Review P2-5: the heat count in other arrival orders gives the same buildings, never two cards for one building.
  const heatRows = rows.filter((r) => isWholeBuildingHeat(r) && buildingKeyOf(r));
  const scan = (batches: Row[][]) => {
    const stored: TimelineRow[] = [];
    const cards = new Map<string, number>();
    for (const b of batches) {
      const arriving = b.map((r) => ({ key: buildingKeyOf(r) as string, t: t(r.occurred_at), id: String(r.id), stored: false }));
      const hit = heatTriggers([...stored, ...arriving]);
      for (const a of arriving) {
        const m = hit.has(a.id);
        stored.push({ ...a, stored: true, marked: m });
        if (m) cards.set(a.key, (cards.get(a.key) ?? 0) + 1);
      }
    }
    return cards;
  };
  const byDay = new Map<string, Row[]>();
  for (const r of heatRows) byDay.set(r.occurred_at.slice(0, 10), [...(byDay.get(r.occurred_at.slice(0, 10)) ?? []), r]);
  const days = [...byDay.keys()].sort();
  let seed = 19;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const shuffled = (xs: Row[]) => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const orders: Array<[string, Row[][]]> = [
    ['one day at a time, in time order', days.map((d) => byDay.get(d)!)],
    ['one day at a time, newest day first', [...days].reverse().map((d) => byDay.get(d)!)],
    ['one row per scan, in id order', [...heatRows].sort((a, b) => a.id - b.id).map((r) => [r])],
    ['one row per scan, random order (seed 19)', shuffled(heatRows).map((r) => [r])],
    ['one row per scan, random order (seed 20)', ((seed = 20), shuffled(heatRows).map((r) => [r]))],
    ['one row per scan, newest first', [...heatRows].sort((a, b) => t(b.occurred_at) - t(a.occurred_at) || b.id - a.id).map((r) => [r])],
  ];
  const ref = new Set([...heatHit].map((id) => buildingKeyOf(rows.find((r) => String(r.id) === id)!) as string));
  const ex: string[] = [];
  let n = 0;
  for (const [name, batches] of orders) {
    const cards = scan(batches);
    const keys = new Set(cards.keys());
    const twice = [...cards.values()].filter((c) => c > 1).length;
    const missing = [...ref].filter((k) => !keys.has(k)).length;
    const extra = [...keys].filter((k) => !ref.has(k)).length;
    P(`  Heat cards, ${name}: ${keys.size} buildings (missing against the all-at-once count: ${missing}, extra: ${extra}, buildings with two cards: ${twice}).`);
    if (missing || extra || twice) { n++; ex.push(name); }
  }
  inv('I9 (review P2-5)', n, `The per-building heat count gives the same ${ref.size} buildings in every arrival order above, never two cards for one building.`, ex);
}
P();

// ---- 8. this engine's own replay checks (scripts/replay-labels.ts) -------------------------------------------------------------------
P('## 4. This engine\'s own replay checks (scripts/replay-labels.ts), on the live rows');
P();
const PUBLIC_WORK: Array<{ re: RegExp; not?: RegExp }> = [
  { re: /graffiti/i, not: /private/i },
  { re: /\btrees?\b|\bstump/i, not: /\bpriv|\bprv/i },
  { re: /\bsewers?\b|manhole|catch.?basin|storm drain|stormwater/i, not: /back-?\s?up|pipe boundary/i },
  { re: /right.of.way|\brow\b|street|sidewalk|alley|bike lane|pothole|curb|paving/i },
  { re: /dump|debris|bulk|litter|missed trash|trash recycling|spillage|vacant lot/i, not: /\bpriv|\bprv|property violation/i },
  { re: /rodent baiting|rat complaint/i },
  { re: /bldgmaint|city bldg|\bpark\b/i },
];
{
  let n = 0;
  const ex: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (subtypeOf(r) !== '311') continue;
    const body = (r.title ?? '').slice((r.title ?? '').indexOf(': ') + 2);
    for (const tr of ['painting', 'tree-service', 'plumbing'] as CategoryId[]) {
      if (!isAlert(lv(after[i], tr))) continue;
      if (PUBLIC_WORK.some((p) => p.re.test(body) && !(p.not && p.not.test(body)))) { n++; ex.push(`${r.id} ${tr} "${body}"`); }
    }
  }
  inv('Public-work 311 alerts for painting, tree-service, plumbing', n, 'The 7 independent public-work patterns of replay-labels.ts.', ex);
}
{
  let n = 0;
  let typed = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (subtypeOf(r) !== 'permit') continue;
    if (/\broof/i.test(r.title ?? '') && isAlert(lv(after[i], 'roofing'))) n++;
    if (routeKindsOf(r.title, { summary: r.summary, source: r.source }).includes('re-roof') && !/\bsolar\b/i.test(r.title ?? '') && isAlert(lv(after[i], 'roofing'))) typed++;
  }
  inv('Roof permits that alert roofers', n, 'Titles containing "roof".', []);
  inv('Roofing alerts from roof-typed permits without solar', typed, '(printed "must be 0" by replay-labels.ts).', []);
}
{
  interface Smyrna { profile: MatchProfile; signals: Array<MatchSignal & { source: string; kind: string; title: string }> }
  const fx = JSON.parse(readFileSync(join(REPO, 'scripts', 'fixtures', 'replay-14d', 'smyrna-roofer.json'), 'utf8')) as Smyrna;
  const feed = fx.signals.filter((s) => matchOne(s, fx.profile, false, Date.parse('2026-11-22T00:00:00Z')));
  inv('Smyrna roofer keeps its feed rows (fixture)', feed.length >= 1 ? 0 : 1, `${feed.length} of ${fx.signals.length} fixture rows stay in the feed (before this unit: 1).`, []);
}
P();

// ---- 9. volume in four metros ------------------------------------------------------------------------------------------------------
P('## 5. Cards a day for one member per trade, 25 miles, Starter plan, no caps (each source over its own span of days)');
P();
const METROS: Array<[string, string, number, number]> = [
  ['New York', 'NY', 40.7128, -74.006],
  ['Chicago', 'IL', 41.8781, -87.6298],
  ['Los Angeles', 'CA', 34.0522, -118.2437],
  ['Atlanta', 'GA', 33.749, -84.388],
];
const span = new Map<string, number>();
{
  const mm = new Map<string, [number, number]>();
  for (const r of rows) {
    const x = t(r.occurred_at);
    if (!Number.isFinite(x)) continue;
    const cur = mm.get(r.source);
    mm.set(r.source, cur ? [Math.min(cur[0], x), Math.max(cur[1], x)] : [x, x]);
  }
  for (const [s, [a, b]] of mm) span.set(s, Math.max(1, (b - a) / 86_400_000));
}
const NOW = Date.parse('2026-12-07T00:00:00Z');
const sigOf = (r: Row): MatchSignal => ({ id: r.id, categories: r.categories ?? [], lat: r.lat, lon: r.lon, state: r.state, severity: r.severity, occurred_at: r.occurred_at, subtype: subtypeOf(r), data: r.data as MatchSignal['data'], source: r.source, title: r.title, summary: r.summary, kind: r.kind });
interface Vol { urgent: number; heads: number; urgentPerDay: number; headsPerDay: number; bySource: Map<string, number> }
function volume(metro: (typeof METROS)[number], trade: CategoryId, src: Row[]): Vol {
  const [, state, lat, lon] = metro;
  const profile: MatchProfile = { user_id: 'replay', categories: [trade], lat, lon, state, radius_mi: 25, plan: 'starter' };
  const v: Vol = { urgent: 0, heads: 0, urgentPerDay: 0, headsPerDay: 0, bySource: new Map() };
  for (const r of src) {
    if (r.lat !== null && r.lon !== null && (Math.abs(r.lat - lat) > 0.5 || Math.abs(r.lon - lon) > 0.7)) continue;
    const m = matchOne(sigOf(r), profile, false, NOW);
    if (!m || !isAlertLabel(m.label)) continue;
    const d = span.get(r.source) ?? 14;
    if (m.label === 'act_now') {
      v.urgent++;
      v.urgentPerDay += 1 / d;
    } else {
      v.heads++;
      v.headsPerDay += 1 / d;
    }
    v.bySource.set(r.source, (v.bySource.get(r.source) ?? 0) + 1);
  }
  return v;
}
const SIX: CategoryId[] = ['plumbing', 'hvac', 'roofing', 'cleaning', 'landscaping', 'junk-removal'];
const f1 = (n: number) => n.toFixed(1);
P('Cells: urgent + heads-up cards (urgent a day / heads-up a day). Days per source = that source\'s own span in the export (NYC 311 about 5 days, LA permits about 4).');
P();
P(`| Metro | ${SIX.join(' | ')} |`);
P(`|---|${SIX.map(() => '---:').join('|')}|`);
let worst = { metro: '', trade: '', perDay: 0, urgent: 0 };
let worstHeads = { metro: '', trade: '', perDay: 0, heads: 0 };
const nyHeads: string[] = [];
let nyHvacUrgent = 0;
const zero: string[] = [];
for (const m of METROS) {
  const cells: string[] = [];
  for (const tr of TRADES) {
    const v = volume(m, tr, marked);
    if (v.urgentPerDay > worst.perDay) worst = { metro: m[0], trade: tr, perDay: v.urgentPerDay, urgent: v.urgent };
    if (v.headsPerDay > worstHeads.perDay) worstHeads = { metro: m[0], trade: tr, perDay: v.headsPerDay, heads: v.heads };
    if (m[0] === 'New York' && ['janitorial-commercial', 'signs-printing', 'security'].includes(tr)) nyHeads.push(`${tr} ${v.heads} heads-up (${f1(v.headsPerDay)} a day; ${[...v.bySource].map(([k, c]) => `${k} ${c}`).join(', ')})`);
    if (m[0] === 'New York' && tr === 'hvac') nyHvacUrgent = v.urgent;
    if (SIX.includes(tr)) {
      cells[SIX.indexOf(tr)] = `${v.urgent}+${v.heads} (${f1(v.urgentPerDay)}/${f1(v.headsPerDay)})`;
      if (v.urgent + v.heads === 0) zero.push(`${m[0]} ${tr}`);
    }
  }
  P(`| ${m[0]} | ${cells.join(' | ')} |`);
}
P();
P(`Worst urgent rate across all ${TRADES.length} trades in the four metros: ${worst.metro} ${worst.trade}, ${worst.urgent} urgent cards, ${f1(worst.perDay)} a day (ceiling 10).`);
P(`Worst heads-up rate across all ${TRADES.length} trades in the four metros: ${worstHeads.metro} ${worstHeads.trade}, ${worstHeads.heads} heads-up cards, ${f1(worstHeads.perDay)} a day (ceiling 25, review P2-7).`);
P(`New York commercial cleaning, signs and security (cards by source; review P2-7): ${nyHeads.join('; ')}.`);
ingestFailures.forEach((f) => failures.push(f));
if (worst.perDay > 10) failures.push('volume ceiling');
if (worstHeads.perDay > 25) failures.push('heads-up ceiling');
P(`New York HVAC urgent cards after the heat rule: ${nyHvacUrgent} (audit: about 38 in 5.1 days of NYC 311).`);
P(`Zero alerts in the window (owner call 10: allowed, not padded): ${zero.join(', ') || 'none'}.`);
P();

// ---- 10. per audit line ----------------------------------------------------------------------------------------------------------
P('## 6. Pairs per rule: alert pairs before (engine A, engine-compare.jsonl) and after (FINAL), over the pairs each rule decides now');
P();
const perRule = new Map<string, { pairs: number; before: number; afterAlerts: number; afterUrgent: number }>();
for (let i = 0; i < rows.length; i++) {
  for (const [tr, id] of Object.entries(after[i].rule)) {
    const e = perRule.get(id as string) ?? { pairs: 0, before: 0, afterAlerts: 0, afterUrgent: 0 };
    e.pairs++;
    if (isAlert(before[i].a[tr])) e.before++;
    const l = lv(after[i], tr as CategoryId);
    if (isAlert(l)) e.afterAlerts++;
    if (l === 'urgent') e.afterUrgent++;
    perRule.set(id as string, e);
  }
}
// Pairs no longer carried at all (never the case in this unit, checked):
let dropped = 0;
for (let i = 0; i < rows.length; i++) for (const tr of TRADES) if (isAlert(before[i].a[tr]) && !(tr in after[i].rule)) dropped++;
const lineOf = new Map(RULES.map((r) => [r.id, r.line === undefined ? '' : Array.isArray(r.line) ? (r.line as number[]).join(', ') : String(r.line)]));
P('| Rule | Audit line(s) | Pairs | Alert pairs before | Alert pairs after | of which urgent |');
P('|---|---|---:|---:|---:|---:|');
for (const [id, e] of [...perRule].sort((a, b) => b[1].pairs - a[1].pairs)) P(`| ${id} | ${lineOf.get(id) ?? ''} | ${fmt(e.pairs)} | ${fmt(e.before)} | ${fmt(e.afterAlerts)} | ${fmt(e.afterUrgent)} |`);
P();
P(`Alert pairs before that are no longer carried to the trade at all: ${dropped}.`);
P();
P('## 7. Owner calls in force (lib/signals/rule-choices.ts)');
P();
for (const q of RULE_CHOICE_QUESTIONS) P(`- ${q.n}. ${q.question}: ${RULE_CHOICES[q.key] ? 'YES' : 'NO'} (${q.key})`);
P();
P(failures.length ? `RESULT: FAIL (${failures.join(', ')})` : 'RESULT: PASS (every invariant at 0, no trade above 10 urgent or 25 heads-up cards a day in the four metros)');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join('\n') + '\n');
mkdirSync(dirname(PER_ROW), { recursive: true });
writeFileSync(
  PER_ROW,
  rows
    .map((r, i) =>
      JSON.stringify({
        id: r.id,
        source: r.source,
        title: r.title,
        heatMark: heatHit.has(String(r.id)),
        nwsRepeatOf: nwsRep.get(String(r.id)) ?? null,
        spcRepeatOf: spcRep.get(String(r.id)) ?? null,
        visitCardOf: visits.followerOf.get(String(r.id)) ?? null,
        undeliverable: cannotBeDelivered(r),
        after: after[i].lvl,
        rule: after[i].rule,
        b: Object.fromEntries(Object.entries(bLevels[i]).filter(([, l]) => l !== 'none')),
      }),
    )
    .join('\n') + '\n',
);
console.log(lines.slice(0, 16).join('\n'));
console.log(`... wrote ${OUT} and ${PER_ROW}`);
if (failures.length) process.exit(1);
