/**
 * Read-only 14-day replay of the opportunity labels (PLAN-2.0 item 0.1 to 0.3, round 13 unit A).
 *
 * Input: three grouped PSV fixtures built from READ-ONLY `select` results on holler_signals (Nov 7 to 21 2026, 20,059 rows):
 *   scripts/fixtures/replay-14d/permits.psv   title_norm|cats|n                    (10,195 rows, permit titles with the city removed)
 *   scripts/fixtures/replay-14d/c311.psv      source|title_rest|cats|n             (6,819 rows, 311 requests)
 *   scripts/fixtures/replay-14d/other.psv     source|subtype|kind|title|cats|n     (3,045 rows, everything else)
 * Output: /home/claude/gates/r13/logs/A-replay.md (or the path given as the first argument).
 *
 * Nothing here touches a database, the network or the clock. Run with:
 *   node node_modules/jiti/lib/jiti-cli.mjs scripts/replay-labels.ts
 *
 * A "pair" is one signal and one trade it is tagged with (holler_signals.categories). Before this unit every pair was an alert.
 * The title of a grouped row is compressed (the city and the street are removed, violations are one title), so the top-10 lists are
 * of normalised titles. The group counts are exact.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { OPPORTUNITY_LABELS, isAlertLabel, labelFor, ruleFor, type LabelInput, type OpportunityLabel } from '../lib/signals/lead-rules';
import type { CategoryId } from '../lib/signals/categories';

const ROOT = join(__dirname, 'fixtures', 'replay-14d');
const OUT = process.argv[2] ?? '/home/claude/gates/r13/logs/A-replay.md';

interface Group {
  source: string;
  subtype: string;
  kind: string;
  title: string;
  cats: string[];
  n: number;
}

function lines(file: string): string[][] {
  return readFileSync(join(ROOT, file), 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => l.split('|'));
}

const groups: Group[] = [];
for (const [title, cats, n] of lines('permits.psv')) {
  groups.push({ source: 'socrata-chicago-permits', subtype: 'permit', kind: 'permit', title, cats: cats.split(','), n: Number(n) });
}
for (const [source, rest, cats, n] of lines('c311.psv')) {
  groups.push({ source, subtype: '311', kind: 'civic', title: `311 request in X: ${rest}`, cats: cats.split(','), n: Number(n) });
}
for (const [source, subtype, kind, title, cats, n] of lines('other.psv')) {
  groups.push({ source, subtype, kind, title, cats: cats ? cats.split(',') : [], n: Number(n) });
}

const EXPECTED_ROWS = 20059;
const rowTotal = groups.reduce((a, g) => a + g.n, 0);
if (rowTotal !== EXPECTED_ROWS) throw new Error(`fixture rows ${rowTotal}, expected ${EXPECTED_ROWS}`);

type Counter = Map<string, number>;
interface TradeStats {
  pairs: number;
  byLabel: Record<OpportunityLabel, number>;
  titles: Record<OpportunityLabel, Counter>;
}
const blank = (): TradeStats => ({
  pairs: 0,
  byLabel: { act_now: 0, coming_soon: 0, market_insight: 0, context: 0 },
  titles: { act_now: new Map(), coming_soon: new Map(), market_insight: new Map(), context: new Map() },
});

const trades = new Map<string, TradeStats>();
const untagged = { rows: 0 };
const ruleHits = new Map<string, number>();

/** Alert rows kept for the independent checks: [trade, title, source, subtype, n]. */
const alertRows: Array<{ trade: string; g: Group; label: OpportunityLabel }> = [];
const allPairRows: Array<{ trade: string; g: Group; label: OpportunityLabel }> = [];

for (const g of groups) {
  if (g.cats.length === 0) {
    untagged.rows += g.n;
    continue;
  }
  const sig: LabelInput = { source: g.source, kind: g.kind, subtype: g.subtype, title: g.title };
  for (const trade of g.cats) {
    const label = labelFor(sig, trade as CategoryId);
    const rule = ruleFor(sig, trade as CategoryId);
    const key = rule ? rule.id : `source-default:${g.source}`;
    ruleHits.set(key, (ruleHits.get(key) ?? 0) + g.n);
    const t = trades.get(trade) ?? blank();
    t.pairs += g.n;
    t.byLabel[label] += g.n;
    t.titles[label].set(g.title, (t.titles[label].get(g.title) ?? 0) + g.n);
    trades.set(trade, t);
    allPairRows.push({ trade, g, label });
    if (isAlertLabel(label)) alertRows.push({ trade, g, label });
  }
}

const pct = (a: number, b: number) => (b === 0 ? 'n/a' : `${((100 * a) / b).toFixed(1)}%`);
const top = (c: Counter, k = 10) => [...c].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, k);

// ---- independent public-work check -----------------------------------------------------------------------------------------------
// These patterns are NOT the ones in lead-rules.ts. They describe work the city does itself (public property, right of way, city
// utilities, city buildings), written from the 311 title list. A sewer BACK-UP is excluded from "public work": it is a blocked line
// that a plumber is asked to clear, and the rule table labels it act_now on purpose.
const PUBLIC_WORK: Array<{ name: string; re: RegExp; not?: RegExp }> = [
  { name: 'graffiti other than private', re: /graffiti/i, not: /private/i },
  { name: 'city tree (any tree/stump 311 request not on private property)', re: /\btrees?\b|\bstump/i, not: /\bpriv|\bprv/i },
  { name: 'sewer, manhole, catch basin, storm drain (not a back-up)', re: /\bsewers?\b|manhole|catch.?basin|storm drain|stormwater/i, not: /back-?\s?up/i },
  { name: 'right of way, street, alley, sidewalk, bike lane', re: /right.of.way|\brow\b|street|sidewalk|alley|bike lane|pothole|curb|paving/i },
  { name: 'dumping, debris, bulk, litter, missed trash (not on private property)', re: /dump|debris|bulk|litter|missed trash|trash recycling|spillage|vacant lot/i, not: /\bpriv|\bprv|property violation/i },
  { name: 'rodent baiting', re: /rodent baiting|rat complaint/i },
  { name: 'city building or park', re: /bldgmaint|city bldg|\bpark\b/i },
];

function publicWorkHits(trade: string): Array<{ pattern: string; rows: number; examples: string[] }> {
  const out: Array<{ pattern: string; rows: number; examples: string[] }> = [];
  for (const p of PUBLIC_WORK) {
    let rows = 0;
    const ex = new Set<string>();
    for (const r of alertRows) {
      if (r.trade !== trade || r.g.subtype !== '311') continue;
      if (p.re.test(r.g.title) && !(p.not && p.not.test(r.g.title))) {
        rows += r.g.n;
        if (ex.size < 3) ex.add(r.g.title);
      }
    }
    out.push({ pattern: p.name, rows, examples: [...ex] });
  }
  return out;
}

/** Public-work rows that exist for a trade at all (so a zero is not a zero because nothing was there). */
function publicWorkPresent(trade: string): number {
  let rows = 0;
  for (const r of allPairRows) {
    if (r.trade !== trade || r.g.subtype !== '311') continue;
    if (PUBLIC_WORK.some((p) => p.re.test(r.g.title) && !(p.not && p.not.test(r.g.title)))) rows += r.g.n;
  }
  return rows;
}

// ---- report -------------------------------------------------------------------------------------------------------------------
const out: string[] = [];
const P = (s = '') => out.push(s);

P('# A-replay: 14-day label replay (read-only)');
P();
P('Generated by `scripts/replay-labels.ts` from grouped fixtures of READ-ONLY SELECTs on `holler_signals` (14 days to Nov 21 2026).');
P('No database, network or clock is used at replay time. Same fixtures in, same report out.');
P();
P('## Input check');
P();
P(`- Fixture rows: ${rowTotal} (permits ${lines('permits.psv').reduce((a, l) => a + Number(l[2]), 0)}, 311 ${lines('c311.psv').reduce((a, l) => a + Number(l[3]), 0)}, other ${lines('other.psv').reduce((a, l) => a + Number(l[5]), 0)}). Live count query on the same window returned 20059 (permits 10195, 311 6819, other 3045).`);
P(`- Rows with no trade tag (small earthquakes: no pair, never matched to a trade): ${untagged.rows}.`);
P(`- A pair is one signal and one trade it is tagged with. Total pairs: ${[...trades.values()].reduce((a, t) => a + t.pairs, 0)} across ${trades.size} trades.`);
P('- Titles are normalised for grouping (city and street removed; violations, inspections, business licenses and contracts are one title each; wind-gust speeds kept). Counts are exact.');
P('- Permits are all labelled as `socrata-chicago-permits` (the permit rules do not depend on the city). 311 titles are rebuilt as `311 request in X: <category>`.');
P();

P('## Share of alerts that are act_now + coming_soon, per trade (PLAN-2.0 section 5 target: at least 60%)');
P();
P('Before = the old stream: every pair was an alert, so the share is the part of that stream the new labels call act_now or coming_soon.');
P('After = the stream that is now delivered (alert labels only). It is 100% by construction, so the real change is the volume that stops: the last column.');
P();
P('| Trade | Pairs (old alerts) | act_now | coming_soon | market_insight | context | Before share | After share | Alerts removed |');
P('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
const order = [...trades.entries()].sort((a, b) => b[1].pairs - a[1].pairs);
let totPairs = 0;
const tot: Record<OpportunityLabel, number> = { act_now: 0, coming_soon: 0, market_insight: 0, context: 0 };
for (const [trade, t] of order) {
  const good = t.byLabel.act_now + t.byLabel.coming_soon;
  const kept = good;
  P(`| ${trade} | ${t.pairs} | ${t.byLabel.act_now} | ${t.byLabel.coming_soon} | ${t.byLabel.market_insight} | ${t.byLabel.context} | ${pct(good, t.pairs)} | ${kept === 0 ? 'n/a (none sent)' : '100.0%'} | ${t.pairs - kept} (${pct(t.pairs - kept, t.pairs)}) |`);
  totPairs += t.pairs;
  for (const l of OPPORTUNITY_LABELS) tot[l] += t.byLabel[l];
}
{
  const good = tot.act_now + tot.coming_soon;
  P(`| ALL TRADES | ${totPairs} | ${tot.act_now} | ${tot.coming_soon} | ${tot.market_insight} | ${tot.context} | ${pct(good, totPairs)} | 100.0% | ${totPairs - good} (${pct(totPairs - good, totPairs)}) |`);
}
P();
P('Trades whose BEFORE share was under 60%: ' + (order.filter(([, t]) => (t.byLabel.act_now + t.byLabel.coming_soon) / t.pairs < 0.6).map(([k]) => k).join(', ') || 'none') + '.');
P('Caveat: this counts pairs in the 14-day stream, not per member. A member only sees pairs inside their radius and plan trades.');
P();

P('## Rules and defaults that decided each pair');
P();
P('| Decided by | Pairs |');
P('|---|---:|');
for (const [k, v] of [...ruleHits].sort((a, b) => b[1] - a[1])) P(`| ${k} | ${v} |`);
P();

P('## Zero public-work rows in the alert sets (painting, tree-service, plumbing)');
P();
P('Independent patterns (written in `scripts/replay-labels.ts`, not copied from `lead-rules.ts`). A row is "public work" when its 311 title matches one pattern and does not match that pattern\'s exclusion (private property; a sewer back-up).');
P();
P('| # | Pattern |');
P('|---|---|');
PUBLIC_WORK.forEach((p, i) => P(`| ${i + 1} | ${p.name}: \`${p.re.source}\`${p.not ? ` excluding \`${p.not.source}\`` : ''} |`));
P();
let publicWorkAlerts = 0;
P('| Trade | Public-work 311 pairs in the 14 days (all labels) | Public-work pairs that are alerts |');
P('|---|---:|---:|');
for (const trade of ['painting', 'tree-service', 'plumbing']) {
  const hits = publicWorkHits(trade);
  const alerts = hits.reduce((a, h) => a + h.rows, 0);
  publicWorkAlerts += alerts;
  P(`| ${trade} | ${publicWorkPresent(trade)} | ${alerts} |`);
}
P();
for (const trade of ['painting', 'tree-service', 'plumbing']) {
  P(`Per pattern for ${trade}: ${publicWorkHits(trade).map((h, i) => `#${i + 1}=${h.rows}`).join(', ')}`);
}
P();
P(`RESULT: public-work alert pairs for painting + tree-service + plumbing = ${publicWorkAlerts} (${publicWorkAlerts === 0 ? 'PASS' : 'FAIL'}).`);
P();

// roofers
const roofAlerts = alertRows.filter((r) => r.trade === 'roofing' && r.g.subtype === 'permit' && /\broof/i.test(r.g.title));
const roofPermitPairs = allPairRows.filter((r) => r.trade === 'roofing' && r.g.subtype === 'permit' && /\broof/i.test(r.g.title));
const roofAlertN = roofAlerts.reduce((a, r) => a + r.g.n, 0);
const roofPairN = roofPermitPairs.reduce((a, r) => a + r.g.n, 0);
const roofLabels = new Map<OpportunityLabel, number>();
for (const r of roofPermitPairs) roofLabels.set(r.label, (roofLabels.get(r.label) ?? 0) + r.g.n);
P('## Roofers and roof permits');
P();
P(`Roof permits tagged to roofing in the 14 days: ${roofPairN} pairs. Labels: ${[...roofLabels].map(([l, n]) => `${l}=${n}`).join(', ') || 'none'}.`);
P(`RESULT: roof permits that are alerts for roofers = ${roofAlertN} (${roofAlertN === 0 ? 'PASS' : 'FAIL'}).`);
P();

// per trade top 10
P('## Per trade: counts and top 10 titles per label');
P();
for (const [trade, t] of order) {
  P(`### ${trade} (${t.pairs} pairs)`);
  P();
  P(OPPORTUNITY_LABELS.map((l) => `${l}=${t.byLabel[l]}`).join(', '));
  P();
  for (const l of OPPORTUNITY_LABELS) {
    P(`**${l}** (${t.byLabel[l]})`);
    const rows = top(t.titles[l]);
    if (rows.length === 0) P('- none');
    for (const [title, n] of rows) P(`- ${n} x ${title}`);
    P();
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out.join('\n') + '\n');
console.log(`wrote ${OUT} (${out.length} lines); public-work alerts ${publicWorkAlerts}; roof permit alerts ${roofAlertN}`);
if (publicWorkAlerts !== 0 || roofAlertN !== 0) process.exit(1);
