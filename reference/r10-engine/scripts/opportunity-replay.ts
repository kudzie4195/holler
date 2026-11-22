/**
 * Replays lib/signals/opportunity.ts over a fixture of stored signal rows and checks its invariants.
 *
 *   npx tsx scripts/opportunity-replay.ts <fixture.json> [--json out.json]
 *
 * Fixture: an array of rows { id, source, kind, title, summary, categories, severity, data: { subtype, ... } }.
 * Prints per-trade counts of act / soon / intel / context, the top 15 titles per (trade, label) for act and soon, rows that fell to
 * the unknown default per (source, subtype), and the invariants below. Exits 1 when an invariant fails.
 *   I1 no permit row gives act or soon to a trade that does the permitted work (checked against permit.ts PERMIT_KINDS cats).
 *   I2 no 311 graffiti row without an explicit private marker is act or soon for painting or cleaning.
 *   I3 every Tree Trim Request, Tree Planting, Sewer Cleaning, catch basin, Missed Trash, Fly Dumping, Rodent Baiting 311 row is
 *      context for every trade.
 *   I4 every NYC HEAT/HOT WATER 311 row is act for hvac (soon when it is one apartment only).
 *   I5 every source has an explicit rule; the unknown default count is 0 for permit, 311, violation, inspection, business, alert,
 *      report and contract rows.
 *   I6 (report only) context share, for painting, tree-service and plumbing, of the rows whose categories include that trade.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { CATEGORY_IDS } from '../lib/signals/categories';
import { PERMIT_KINDS } from '../lib/signals/mapping/permit';
import {
  OPPORTUNITIES,
  assessOpportunity,
  opportunityFor,
  permitKindsFromTitle,
  type Opportunity,
  type OpportunityInput,
} from '../lib/signals/opportunity';

interface Row {
  id: number | string;
  source: string;
  kind: string;
  title: string | null;
  summary: string | null;
  categories: string[] | null;
  severity: number | null;
  data: Record<string, unknown> | null;
}

const args = process.argv.slice(2);
const fixturePath = args.find((a) => !a.startsWith('--'));
const jsonIdx = args.indexOf('--json');
const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : undefined;
if (!fixturePath) {
  console.error('usage: npx tsx scripts/opportunity-replay.ts <fixture.json> [--json out.json]');
  process.exit(2);
}

const rows = JSON.parse(readFileSync(fixturePath, 'utf8')) as Row[];
const subtypeOf = (r: Row) => (r.data && typeof r.data.subtype === 'string' ? r.data.subtype : null);
const toInput = (r: Row): OpportunityInput => ({
  kind: r.kind,
  subtype: subtypeOf(r),
  source: r.source,
  title: r.title,
  summary: r.summary,
  categories: r.categories ?? [],
  severity: r.severity,
  data: r.data,
});
/** Title with the place taken out, so rows group by what they say ("Roof permit in *", "Wind damage reported near *"). */
const titleKey = (t: string | null) =>
  String(t ?? '')
    .replace(/\bnear .*$/i, 'near *')
    .replace(/\bin [^:]+?(?=:|$)/, 'in *');

const out: string[] = [];
const log = (s = '') => out.push(s);
const failures: string[] = [];

const counts: Record<string, Record<Opportunity, number>> = {};
for (const t of CATEGORY_IDS) counts[t] = { act: 0, soon: 0, intel: 0, context: 0 };
const titles: Record<string, Map<string, number>> = {};
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const unknownBy = new Map<string, number>();
const sourcesSeen = new Map<string, { rows: number; unknown: number }>();
const reasonCounts = new Map<string, number>();
const cityRequest = new Map<string, number>();
const permitUnparsed = new Map<string, number>();
const i6: Record<string, { tagged: number; context: number; byLabel: Record<Opportunity, number> }> = {};
for (const t of ['painting', 'tree-service', 'plumbing']) i6[t] = { tagged: 0, context: 0, byLabel: { act: 0, soon: 0, intel: 0, context: 0 } };

// I1 reference: trades that do the permitted work, read from permit.ts itself. Realtors and movers are on a new home's cats but do
// not build it; they are the only cats that are not doing the work.
const NOT_DOING: Record<string, string[]> = { 'new-home': ['real-estate', 'moving'] };
const kindByLabel = new Map(PERMIT_KINDS.map((k) => [k.label.toLowerCase(), k]));
const i1: string[] = [];
const i2: string[] = [];
const i3: string[] = [];
const i4: string[] = [];
let i3Rows = 0;
let i4Rows = 0;
const I3_RE = /tree trim request|tree planting|sewer cleaning|catch basin|missed trash|fly dumping|rodent baiting/i;

for (const r of rows) {
  const sig = toInput(r);
  const a = assessOpportunity(sig);
  const sub = subtypeOf(r);
  const key = `${r.source} | ${sub ?? r.kind}`;
  const s = sourcesSeen.get(r.source) ?? { rows: 0, unknown: 0 };
  s.rows++;
  if (!a.known) {
    s.unknown++;
    bump(unknownBy, key);
  }
  sourcesSeen.set(r.source, s);

  const labels: Record<string, Opportunity> = {};
  for (const t of CATEGORY_IDS) {
    const b = opportunityFor(sig, t);
    labels[t] = b.label;
    counts[t][b.label]++;
    bump(reasonCounts as Map<string, number>, `${b.label} ${b.reason}`);
    if (b.label === 'act' || b.label === 'soon') {
      const k = `${t}|${b.label}`;
      titles[k] ??= new Map();
      bump(titles[k], titleKey(r.title));
    }
  }
  for (const t of Object.keys(i6)) {
    if ((r.categories ?? []).includes(t)) {
      i6[t].tagged++;
      i6[t].byLabel[labels[t]]++;
      if (labels[t] === 'context') i6[t].context++;
    }
  }

  const isPermit = sub === 'permit' || r.kind === 'permit';
  if (isPermit) {
    const { unparsed } = permitKindsFromTitle(r.title);
    for (const u of unparsed) bump(permitUnparsed, u);
    const m = /^(.*?)\s+permit\s+in\s/i.exec(r.title ?? '');
    const doing = new Set<string>();
    const excluded = new Set<string>();
    if (m) {
      for (const part of m[1].split(/,\s+|\s+and\s+/)) {
        const k = kindByLabel.get(part.trim().toLowerCase());
        if (!k) continue;
        for (const c of k.cats) (NOT_DOING[k.id]?.includes(c) ? excluded : doing).add(c);
      }
    }
    for (const c of r.categories ?? []) if (!excluded.has(c)) doing.add(c);
    for (const t of doing) if (labels[t] === 'act' || labels[t] === 'soon') i1.push(`${r.id} ${r.title} -> ${t} ${labels[t]}`);
  }
  if (sub === '311') {
    const title = r.title ?? '';
    if (/graffiti/i.test(title) && !/\bprivate\b|\bpriv\b|\bprv\b/i.test(title)) {
      for (const t of ['painting', 'cleaning']) if (labels[t] === 'act' || labels[t] === 'soon') i2.push(`${r.id} ${title} -> ${t} ${labels[t]}`);
    }
    if (I3_RE.test(title)) {
      i3Rows++;
      const bad = CATEGORY_IDS.filter((t) => labels[t] !== 'context');
      if (bad.length) i3.push(`${r.id} ${title} -> ${bad.map((t) => `${t}:${labels[t]}`).join(', ')}`);
    }
    if (r.source === 'socrata-nyc-311' && /HEAT\/HOT WATER/i.test(title)) {
      i4Rows++;
      const want = /apartment only/i.test(title) ? 'intel' : 'act';
      if (labels.hvac !== want) i4.push(`${r.id} ${title} -> hvac ${labels.hvac} (want ${want})`);
    }
    if (a.fallback === 'city-request' && Object.keys(a.grants).length === 0) bump(cityRequest, titleKey(title));
  }
}

const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, n);
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');

log(`Opportunity replay: ${rows.length} rows from ${fixturePath}`);
log('');
log('== Per-trade counts (rows per label) ==');
log(`${'trade'.padEnd(24)}${OPPORTUNITIES.map((o) => o.padStart(9)).join('')}`);
for (const t of CATEGORY_IDS) log(`${t.padEnd(24)}${OPPORTUNITIES.map((o) => String(counts[t][o]).padStart(9)).join('')}`);
log('');
log('== Label and reason counts (row x trade pairs, non-context only) ==');
for (const [k, v] of top(reasonCounts, 200)) if (!k.startsWith('context')) log(`${String(v).padStart(7)}  ${k}`);
log('');
log('== Top 15 titles per (trade, label) for act and soon ==');
for (const t of CATEGORY_IDS) {
  for (const l of ['act', 'soon'] as const) {
    const m = titles[`${t}|${l}`];
    if (!m) continue;
    log(`-- ${t} / ${l} (${counts[t][l]})`);
    for (const [k, v] of top(m, 15)) log(`${String(v).padStart(7)}  ${k}`);
  }
}
log('');
log('== Unknown default per (source | subtype or kind) ==');
if (unknownBy.size === 0) log('  none');
for (const [k, v] of top(unknownBy, 100)) log(`${String(v).padStart(7)}  ${k}`);
log('');
log('== 311 rows on the plain city-request default (top 25 titles, context) ==');
for (const [k, v] of top(cityRequest, 25)) log(`${String(v).padStart(7)}  ${k}`);
log('');
log('== Permit title parts that are not a PERMIT_KINDS label ==');
if (permitUnparsed.size === 0) log('  none');
for (const [k, v] of top(permitUnparsed, 25)) log(`${String(v).padStart(7)}  ${k}`);
log('');

log('== Invariants ==');
const check = (id: string, ok: boolean, msg: string, samples: string[] = []) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${id} ${msg}`);
  for (const s of samples.slice(0, 10)) log(`       ${s}`);
  if (!ok) failures.push(id);
};
check('I1', i1.length === 0, `permit own-trade never act/soon (${i1.length} violations)`, i1);
check('I2', i2.length === 0, `311 graffiti without private marker never act/soon for painting/cleaning (${i2.length} violations)`, i2);
check('I3', i3.length === 0 && i3Rows > 0, `city-work 311 rows are context for every trade (${i3Rows} rows, ${i3.length} violations)`, i3);
check('I4', i4.length === 0 && i4Rows > 0, `NYC HEAT/HOT WATER 311 rows are act for hvac, insight for one apartment (${i4Rows} rows, ${i4.length} violations)`, i4);
const STRICT = new Set(['permit', '311', 'violation', 'inspection', 'business', 'alert', 'report', 'contract']);
const strictUnknown = [...unknownBy.entries()].filter(([k]) => STRICT.has(k.split(' | ')[1]));
const ruleless = [...sourcesSeen.entries()].filter(([, s]) => s.unknown === s.rows).map(([src]) => src);
check(
  'I5',
  strictUnknown.length === 0 && ruleless.length === 0,
  `every source has an explicit rule (${sourcesSeen.size} sources; unknown in strict families: ${strictUnknown.reduce((n, [, v]) => n + v, 0)}; sources with no rule: ${ruleless.length})`,
  [...strictUnknown.map(([k, v]) => `${k}: ${v}`), ...ruleless.map((s) => `no rule: ${s}`)],
);
log('INFO I6 context share of rows whose categories include the trade:');
for (const [t, v] of Object.entries(i6)) {
  log(
    `       ${t.padEnd(14)} tagged ${String(v.tagged).padStart(6)}  context ${String(v.context).padStart(6)} (${pct(v.context, v.tagged)})  act ${v.byLabel.act}  soon ${v.byLabel.soon}  intel ${v.byLabel.intel}`,
  );
}
log('');
log(failures.length ? `RESULT FAIL (${failures.join(', ')})` : 'RESULT PASS');

console.log(out.join('\n'));
if (jsonOut) {
  writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        rows: rows.length,
        counts,
        unknown: Object.fromEntries(unknownBy),
        i6,
        invariants: { I1: i1.length, I2: i2.length, I3: i3.length, I4: i4.length, I5: strictUnknown.length + ruleless.length },
        failures,
      },
      null,
      2,
    ),
  );
}
process.exit(failures.length ? 1 : 0);
