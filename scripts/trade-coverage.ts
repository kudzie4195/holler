/**
 * Round 20 SCORE: does each of the 41 trades "would pay" in the 10 metros? Measured on real rows with the live engine. Read-only: no
 * database, no network, no clock.
 *
 *   npm run score:trades                                       measured grid on the default rows file
 *   npm run score:trades -- <rows.json>                        another rows file
 *   npm run score:trades -- [rows.json] --with-proposed        also the PROJECTED grid with lib/signals/proposed-labels.ts
 *
 * Call path tiers (round 20 integration, owner decision): business, exact address, block address. The official headline counts all three
 * ("with block"); strict (business or exact) and the per-tier counts are printed beside it.
 *   npm run score:trades -- [rows.json] --json <out.json>      also write the numbers as JSON (measured and projected kept apart)
 *
 * The engine path is the one `npm run replay:rules` uses (scripts/rules-replay.ts section 5): ingest marks first (lib/signals/repeat-marks.ts),
 * then lib/signals/match.ts matchOne per row for a one-trade member at the centre, 25 miles, plan 'starter' (Solo limits), city bids off, the replay's clock.
 * The arithmetic is lib/signals/trade-coverage.ts; the record types each trade acts on are lib/signals/trade-needs.ts.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CATEGORY_IDS, type CategoryId } from '../lib/signals/categories';
import { METROS } from '../lib/geo/metros';
import { SOCRATA_DATASETS } from '../lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS } from '../lib/signals/adapters/arcgis-datasets';
import { CARTO_DATASETS } from '../lib/signals/adapters/carto-datasets';
import { JOHNS_CREEK_PERMITS } from '../lib/signals/adapters/arcgis-johnscreek';
import { PROPOSED_LABELS, proposedTierOf } from '../lib/signals/proposed-labels';
import { isWholeBuildingHeat } from '../lib/signals/repeat-marks';
import { RECORD_TYPES, TRADE_NEEDS } from '../lib/signals/trade-needs';
import {
  buildList,
  metroBuildList,
  callPathOfRow,
  callPathRate,
  cardsAt,
  cellOf,
  covers,
  gapsOf,
  headlineOf,
  markRows,
  measure,
  projectedHeadline,
  projectedRate,
  projectGrid,
  sourceSpans,
  specCanGiveCallPath,
  PAY_MIN_METROS,
  RADIUS_MI,
  type Centre,
  type CoverageRow,
  type CallPath,
  type CoverMode,
  type Headline,
  type Measured,
} from '../lib/signals/trade-coverage';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const valueOf = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--json'));
const ROWS = positional[0] ?? '/home/claude/gates/r19/data/signals-14d.json';
const WITH_PROPOSED = flag('--with-proposed');
const JSON_OUT = valueOf('--json');
/** The reviewed replay's fixed clock (scripts/rules-replay.ts NOW). */
const NOW = Date.parse('2026-12-07T00:00:00Z');
const TRADES = CATEGORY_IDS as readonly CategoryId[];

// ---- inputs -----------------------------------------------------------------------------------------------------------------------
const raw = JSON.parse(readFileSync(ROWS, 'utf8')) as CoverageRow[];
const { rows, counts } = markRows(raw);
const spans = sourceSpans(raw);
const calendarSpans = sourceSpans(raw, 'calendar');

type SpecHolder = { id: string; contacts?: Parameters<typeof specCanGiveCallPath>[0] };
const specHolders: SpecHolder[] = [...(SOCRATA_DATASETS as SpecHolder[]), ...(ARCGIS_DATASETS as SpecHolder[]), ...(CARTO_DATASETS as SpecHolder[]), JOHNS_CREEK_PERMITS as SpecHolder];
const SPEC_OK = new Set(specHolders.filter((d) => specCanGiveCallPath(d.contacts)).map((d) => d.id));
const specCapable = (source: string) => SPEC_OK.has(source);

const CENTRES: Centre[] = METROS.map((m) => ({ id: m.id, label: m.label, lat: m.center.lat, lon: m.center.lon, state: m.states[0] }));
const SHORT: Record<string, string> = { 'new-york': 'NYC', 'los-angeles': 'LA', chicago: 'CHI', 'dallas-fort-worth': 'DFW', houston: 'HOU', atlanta: 'ATL', 'washington-dc': 'DC', philadelphia: 'PHL', miami: 'MIA', phoenix: 'PHX' };

const lines: string[] = [];
const P = (s = '') => lines.push(s);
const f1 = (n: number) => n.toFixed(1);
const fmt = (n: number) => n.toLocaleString('en-US');
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');

P('SCORE: trade-by-metro "would pay" scorecard (round 20)');
P(`Rows: ${fmt(raw.length)} from ${ROWS}. Trades: ${TRADES.length}. Metros: ${CENTRES.length} (lib/geo/metros.ts centres, ${RADIUS_MI} miles).`);
P(`Engine: lib/signals/match.ts matchOne (labels lib/signals/lead-rules.ts), one-trade member, plan 'starter' (Solo limits), city bids off, clock ${new Date(NOW).toISOString()}; ingest marks first: ${counts.heat} heat rows marked, ${counts.nws} NWS repeats, ${counts.spc} storm-report repeats, ${counts.visitFollowers} violation orders folded into visit cards.`);
P(`Rule: a trade COVERS a metro with >= 1 actionable (urgent + heads-up) card a week that has a call path; it WOULD PAY with >= ${PAY_MIN_METROS} of 10 metros covered.`);
P('Call path, three tiers (owner decision at round 20 integration: a BLOCK-level address counts as a place to go): business (a stored business contact with a name; the rows file holds no contacts, so 0 here), exact (a street address with a house number, by the live gate\'s test lib/signals/alert-gate.ts contactPathOf on the card\'s public summary), block (a hundred-block, "3600 block of W GRENSHAW ST").');
P('Modes: STRICT = business or exact. WITH BLOCK = business, exact or block (THE OWNER\'S RULE, the official headline). UPPER = with block, or the source has a contact spec that could store a business or a site address (an upper bound, never the headline).');
P();

const measured: Measured = measure(rows, CENTRES, spans, specCapable, { nowMs: NOW });

// ---- 1. sanity anchor -------------------------------------------------------------------------------------------------------------
P('## 1. Sanity anchor against /home/claude/gates/r19/logs/RULES2-replay.txt');
P();
const REPLAY_CENTRES: Record<string, Centre> = {
  'new-york': { id: 'new-york', label: 'New York', lat: 40.7128, lon: -74.006, state: 'NY' },
  chicago: { id: 'chicago', label: 'Chicago', lat: 41.8781, lon: -87.6298, state: 'IL' },
  'los-angeles': { id: 'los-angeles', label: 'Los Angeles', lat: 34.0522, lon: -118.2437, state: 'CA' },
};
/** What the replay printed for each cell (null: not printed there). Section 5 of the replay: the New York row of the table (urgent+heads-up and a
 * day each), and the two "worst rate" lines, which give one label only (Chicago: urgent; Los Angeles: heads-up). */
const ANCHORS: Array<{ metro: string; trade: CategoryId; urgent: number | null; urgentPerDay: number | null; heads: number | null; headsPerDay: number | null; what: string }> = [
  { metro: 'new-york', trade: 'hvac', urgent: 44, urgentPerDay: 8.5, heads: 0, headsPerDay: 0.0, what: 'New York HVAC: 44+0 (8.5/0.0 a day)' },
  { metro: 'chicago', trade: 'general-contractor', urgent: 72, urgentPerDay: 9.0, heads: null, headsPerDay: null, what: 'Chicago general-contractor: 72 urgent, 9.0 a day' },
  { metro: 'los-angeles', trade: 'siding-gutters', urgent: null, urgentPerDay: null, heads: 64, headsPerDay: 21.1, what: 'Los Angeles siding-gutters: 64 heads-up, 21.1 a day' },
];
let anchorFail = 0;
P('| Cell (as the replay printed it) | This script, replay centres and quick box: urgent+heads-up (urgent a day / heads-up a day) | Same, metros.ts centres | Match |');
P('|---|---|---|---|');
const show = (c: ReturnType<typeof cellOf>) => `${c.urgent}+${c.headsUp} (${f1(c.urgentPerWeek / 7)}/${f1(c.headsUpPerWeek / 7)})`;
for (const a of ANCHORS) {
  const rep = cellOf(cardsAt(rows, REPLAY_CENTRES[a.metro], a.trade, specCapable, { nowMs: NOW, box: { lat: 0.5, lon: 0.7 } }), spans);
  const mine = cellOf(cardsAt(rows, CENTRES.find((c) => c.id === a.metro)!, a.trade, specCapable, { nowMs: NOW }), spans);
  const ok =
    (a.urgent === null || rep.urgent === a.urgent) &&
    (a.heads === null || rep.headsUp === a.heads) &&
    (a.urgentPerDay === null || f1(rep.urgentPerWeek / 7) === f1(a.urgentPerDay)) &&
    (a.headsPerDay === null || f1(rep.headsUpPerWeek / 7) === f1(a.headsPerDay));
  if (!ok) anchorFail++;
  P(`| ${a.what} | ${show(rep)} | ${show(mine)} | ${ok ? 'YES' : 'NO'} |`);
}
P();
{
  // The replay's whole section-5 table (6 trades x 4 metros), copied from RULES2-replay.txt: urgent+heads-up (urgent a day / heads-up a day).
  const TABLE: Record<string, string[]> = {
    'new-york': ['6+6 (1.2/0.9)', '44+0 (8.5/0.0)', '0+0 (0.0/0.0)', '0+6 (0.0/0.9)', '0+18 (0.0/2.6)', '0+0 (0.0/0.0)'],
    chicago: ['9+16 (1.1/2.3)', '28+0 (3.5/0.0)', '6+0 (0.8/0.0)', '0+0 (0.0/0.0)', '4+44 (0.5/4.9)', '3+0 (0.4/0.0)'],
    'los-angeles': ['0+0 (0.0/0.0)', '0+0 (0.0/0.0)', '0+8 (0.0/1.4)', '0+5 (0.0/1.7)', '0+5 (0.0/1.7)', '0+0 (0.0/0.0)'],
    atlanta: ['0+1 (0.0/0.1)', '0+1 (0.0/0.1)', '0+0 (0.0/0.0)', '0+20 (0.0/8.5)', '0+33 (0.0/10.1)', '0+31 (0.0/3.8)'],
  };
  const SIX: CategoryId[] = ['plumbing', 'hvac', 'roofing', 'cleaning', 'landscaping', 'junk-removal'];
  const ATL: Centre = { id: 'atlanta', label: 'Atlanta', lat: 33.749, lon: -84.388, state: 'GA' };
  let same = 0;
  let sameMetros = 0;
  const diffs: string[] = [];
  for (const [metro, want] of Object.entries(TABLE)) {
    const c = metro === 'atlanta' ? ATL : REPLAY_CENTRES[metro];
    SIX.forEach((tr, i) => {
      const got = show(cellOf(cardsAt(rows, c, tr, specCapable, { nowMs: NOW, box: { lat: 0.5, lon: 0.7 } }), spans));
      const gotM = show(measured.grid[tr][metro]);
      if (got === want[i]) same++;
      else {
        anchorFail++;
        diffs.push(`${metro} ${tr}: replay ${want[i]}, here ${got}`);
      }
      if (gotM === want[i]) sameMetros++;
      else diffs.push(`${metro} ${tr} with metros.ts centre: ${gotM} (replay ${want[i]})`);
    });
  }
  P(`The replay's whole cards-a-day table (6 trades x 4 metros): ${same} of 24 cells reproduced exactly with the replay's centres and box; ${sameMetros} of 24 with the metros.ts centres and the wider box this grid uses.${diffs.length ? ` Differences: ${diffs.join('; ')}.` : ''}`);
  const gap = (id: string) => {
    const m = CENTRES.find((x) => x.id === id)!;
    const r = id === 'atlanta' ? ATL : REPLAY_CENTRES[id];
    const k = Math.PI / 180;
    const h = Math.sin(((m.lat - r.lat) * k) / 2) ** 2 + Math.cos(m.lat * k) * Math.cos(r.lat * k) * Math.sin(((m.lon - r.lon) * k) / 2) ** 2;
    return 2 * 3958.76 * Math.asin(Math.sqrt(h));
  };
  P(`Centres: the replay's and lib/geo/metros.ts differ by ${['new-york', 'chicago', 'los-angeles', 'atlanta'].map((id) => `${SHORT[id]} ${gap(id).toFixed(2)} mi`).join(', ')}.`);
}
P();
P(anchorFail === 0 ? 'Anchor: PASS. The three named cells and the whole replay table are reproduced exactly; the engine path here is the reviewed one.' : `Anchor: FAIL on ${anchorFail} cell(s). Do not trust the grid below until this is explained.`);
P();

// ---- 2. measured grid ---------------------------------------------------------------------------------------------------------
const strict = headlineOf(measured.grid, CENTRES, 'strict');
const block = headlineOf(measured.grid, CENTRES, 'block');
const upper = headlineOf(measured.grid, CENTRES, 'upper');
const MARK = (x: Parameters<typeof covers>[0]) => (covers(x, 'strict') ? '#' : covers(x, 'block') ? 'b' : covers(x, 'upper') ? '+' : '.');

P('## 2. MEASURED grid (41 x 10): actionable cards a week with a call path, per trade and metro');
P();
P('Cell: call-path cards a week WITH BLOCK (business + exact + block) / all actionable cards a week, then a marker: "#" covers strict (business or exact), "b" covers only with block level (the owner\'s rule), "+" covers only in upper mode, "." none.');
P();
P(`| Trade | ${CENTRES.map((c) => SHORT[c.id]).join(' | ')} | Covered strict | Covered with block (official) | Covered upper |`);
P(`|---|${CENTRES.map(() => '---:').join('|')}|---:|---:|---:|`);
for (const tr of TRADES) {
  const cells = CENTRES.map((c) => {
    const x = measured.grid[tr][c.id];
    return `${f1(callPathRate(x, 'block'))}/${f1(x.perWeek)} ${MARK(x)}`;
  });
  const n = (h: Headline) => {
    const t = h.trades.find((y) => y.trade === tr)!;
    return `${t.covered.length}${t.pays ? ' PAYS' : ''}`;
  };
  P(`| ${tr} | ${cells.join(' | ')} | ${n(strict)} | ${n(block)} | ${n(upper)} |`);
}
P();
P('Metros covered per trade (with block, official): ' + block.trades.map((t) => `${t.trade} ${t.covered.length} (${t.covered.map((m) => SHORT[m]).join(', ') || 'none'})`).join('; ') + '.');
P();
for (const [name, h] of [['strict', strict], ['with block', block], ['upper', upper]] as const) {
  P(`Trades covered per metro (${name}, of 41): ` + CENTRES.map((c) => `${SHORT[c.id]} ${h.trades.filter((t) => t.covered.includes(c.id)).length}`).join(', ') + '.');
}
P();
{
  // Per-tier counts (measured): call-path cards a week summed over the 410 cells, and the cells each tier covers on its own.
  const sum = { business: 0, exact: 0, block: 0, spec: 0 };
  const alone = { business: 0, exact: 0, block: 0 };
  let needBlock = 0;
  const cellsCovered = { strict: 0, block: 0, upper: 0 };
  for (const tr of TRADES) for (const c of CENTRES) {
    const x = measured.grid[tr][c.id];
    sum.business += x.businessPerWeek;
    sum.exact += x.exactPerWeek;
    sum.block += x.blockPerWeek;
    sum.spec += x.upperPerWeek - x.businessPerWeek - x.exactPerWeek - x.blockPerWeek;
    if (x.businessPerWeek + 1e-9 >= 1) alone.business++;
    if (x.exactPerWeek + 1e-9 >= 1) alone.exact++;
    if (x.blockPerWeek + 1e-9 >= 1) alone.block++;
    for (const m of ['strict', 'block', 'upper'] as const) if (covers(x, m)) cellsCovered[m]++;
    if (covers(x, 'block') && !covers(x, 'strict')) needBlock++;
  }
  P('### Per-tier counts (MEASURED)');
  P();
  P('| Tier | Call-path cards a week, all 410 cells | Cells this tier covers on its own (>= 1 a week) |');
  P('|---|---:|---:|');
  P(`| business (named business contact) | ${f1(sum.business)} | ${alone.business} |`);
  P(`| exact address | ${f1(sum.exact)} | ${alone.exact} |`);
  P(`| block address | ${f1(sum.block)} | ${alone.block} |`);
  P(`| source contact spec only (upper bound) | ${f1(sum.spec)} | - |`);
  P();
  P(`Covered cells of 410: strict ${cellsCovered.strict}, with block ${cellsCovered.block} (${needBlock} of them covered only because a block counts), upper ${cellsCovered.upper}.`);
  P();
}
P(`HEADLINE (MEASURED, with block level, the owner's rule, OFFICIAL): ${block.paying} of ${block.total} trades would pay (${f1(block.pct)}%). Goal: 60% (25 of 41).`);
P(`HEADLINE (MEASURED, strict: business or exact address): ${strict.paying} of ${strict.total} trades would pay (${f1(strict.pct)}%).`);
P(`Upper bound (MEASURED rows, call path also from source contact specs): ${upper.paying} of ${upper.total} trades would pay (${f1(upper.pct)}%).`);
P(`Paying trades: strict ${strict.trades.filter((t) => t.pays).map((t) => t.trade).join(', ') || 'none'}; with block ${block.trades.filter((t) => t.pays).map((t) => t.trade).join(', ') || 'none'}; upper ${upper.trades.filter((t) => t.pays).map((t) => t.trade).join(', ') || 'none'}.`);
P(`Trades one metro short of 7 (with block): ${block.trades.filter((t) => t.covered.length === PAY_MIN_METROS - 1).map((t) => t.trade).join(', ') || 'none'}.`);
P();

// ---- 3. what is in each metro -------------------------------------------------------------------------------------------------
P('## 3. Deliverable rows within 25 miles of each centre, by record type (followers and probation sources left out)');
P();
const TYPES_SEEN = [...new Set(Object.values(measured.presence).flatMap((p) => Object.keys(p)))].sort();
P(`| Record type | ${CENTRES.map((c) => SHORT[c.id]).join(' | ')} |`);
P(`|---|${CENTRES.map(() => '---:').join('|')}|`);
for (const ty of TYPES_SEEN) P(`| ${ty} | ${CENTRES.map((c) => fmt((measured.presence[c.id] as Record<string, number>)[ty] ?? 0)).join(' | ')} |`);
P();
{
  const bySrc = new Map<string, Map<string, number>>();
  for (const c of CENTRES) bySrc.set(c.id, new Map());
  // which live sources feed each metro (for the report)
  for (const tr of TRADES) for (const c of CENTRES) for (const s of Object.keys(measured.grid[tr][c.id].bySource)) bySrc.get(c.id)!.set(s, 1);
  P('Sources giving any trade an actionable card, per metro: ' + CENTRES.map((c) => `${SHORT[c.id]}: ${[...bySrc.get(c.id)!.keys()].sort().join(', ') || 'none'}`).join('; ') + '.');
}
P();

// ---- 4. gap report -------------------------------------------------------------------------------------------------------------
const REASON_TEXT: Record<string, string> = {
  'no-source': 'no source of a record type this trade acts on',
  'not-for-trade': 'sources of its record types are present, but no record is about this trade\'s work',
  'feed-only': 'records for this trade are present but the label keeps them feed-only (background) or hidden (context)',
  'no-call-path': 'enough cards but no call path on them',
  'too-few': 'actionable cards come, but fewer than 1 a week',
};
function gapSection(mode: CoverMode, head: Headline) {
  const gaps = gapsOf(measured, CENTRES, mode);
  const reasonCount = new Map<string, number>();
  for (const g of gaps) reasonCount.set(g.reason, (reasonCount.get(g.reason) ?? 0) + 1);
  P(`Uncovered cells (${mode}): ${gaps.length} of ${TRADES.length * CENTRES.length}. By reason: ${[...reasonCount].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(', ')}.`);
  P();
  for (const t of head.trades) {
    if (t.pays) continue;
    const mine = gaps.filter((g) => g.trade === t.trade);
    const parts = mine.map((g) => {
      const x = g.cell;
      const s = g.seen;
      const detail =
        g.reason === 'no-call-path' ? `${f1(x.perWeek)}/wk actionable, ${f1(callPathRate(x, mode))}/wk with a call path`
        : g.reason === 'too-few' ? `${f1(x.perWeek)}/wk actionable (${x.cards} cards), ${f1(callPathRate(x, mode))}/wk with a call path`
        : g.reason === 'feed-only' || g.reason === 'not-for-trade' ? `${s.neededRows} rows of its types in the area: ${s.background} background, ${s.context} context, ${s.notCarried} not about this trade`
        : 'nothing it acts on in the area';
      return `${SHORT[g.metro]} ${g.reason} (${detail}${g.missingTypes.length ? `; missing: ${g.missingTypes.join(', ')}` : ''})`;
    });
    P(`- ${t.trade}: covers ${t.covered.length} of 10 (${t.covered.map((m) => SHORT[m]).join(', ') || 'none'}), needs ${PAY_MIN_METROS - t.covered.length} more. Acts on: ${TRADE_NEEDS[t.trade].acts.join(', ')}. Misses: ${parts.join('; ')}.`);
  }
  P();
}
P('## 4. Gap report (MEASURED, with block level, the official rule): for each trade below 7 metros, the metros it misses and why');
P();
P('Reasons: ' + Object.entries(REASON_TEXT).map(([k, v]) => `${k} = ${v}`).join('; ') + '. "missing" lists the record types the trade acts on (lib/signals/trade-needs.ts) with no row in that metro\'s area.');
P();
gapSection('block', block);
P(`Strict (business or exact address only): ${gapsOf(measured, CENTRES, 'strict').length} uncovered cells.`);
P();

// ---- 5. build list ---------------------------------------------------------------------------------------------------------------
P('## 5. Build list (MEASURED, with block level, the official rule): record types ranked by the uncovered (trade, metro) cells they could fill');
P();
P('cells = uncovered cells where the trade acts on the type and the metro has no row of it. proven = of those, cells whose trade already gets >= 1 call-path card a week from this type in some other metro. "to 7" = trades that would reach 7 of 10 metros if all those cells filled. Ranked by trades to 7 (proven), proven cells, trades to 7 (all), cells.');
P();
P('| Rank | Record type | Cells | Proven cells | Trades to 7 (proven) | Trades to 7 (all cells) | Live today | Privacy |');
P('|---:|---|---:|---:|---|---|---|---|');
const build = buildList(measured, CENTRES, 'block');
build.forEach((b, i) => {
  const info = RECORD_TYPES.find((r) => r.id === b.type);
  P(`| ${i + 1} | ${b.type} | ${b.cells} | ${b.provenCells} | ${b.tradesToPayProven.join(', ') || '-'} | ${b.tradesToPay.join(', ') || '-'} | ${info?.liveToday ? 'yes' : 'no'} | ${info?.privacy ?? ''} |`);
});
P();
{
  const mb = metroBuildList(measured, CENTRES, 'block').filter((x) => x.provenCells > 0);
  P('The same per (metro, record type): one new source of that type in that metro. Proven cells only (the type already gives those trades 1+ call-path card a week elsewhere); top 25.');
  P();
  P('| Rank | Metro | Record type | Proven cells | Trades it would cover there | All cells |');
  P('|---:|---|---|---:|---|---:|');
  mb.slice(0, 25).forEach((x, i) => P(`| ${i + 1} | ${SHORT[x.metro]} | ${x.type} | ${x.provenCells} | ${x.provenTrades.join(', ')} | ${x.cells} |`));
  P();
}
{
  // Per metro: how many uncovered cells each metro has and which type would fill most of them there.
  const gaps = gapsOf(measured, CENTRES, 'block');
  P('Per metro, the record type that would fill the most uncovered cells there: ' + CENTRES.map((c) => {
    const n = new Map<string, number>();
    for (const g of gaps.filter((x) => x.metro === c.id)) for (const t of g.missingTypes) n.set(t, (n.get(t) ?? 0) + 1);
    const top = [...n].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, k]) => `${t} ${k}`).join(', ');
    return `${SHORT[c.id]} (${gaps.filter((x) => x.metro === c.id).length} uncovered): ${top || '-'}`;
  }).join('; ') + '.');
  P();
}

{
  // Arithmetic ceiling (ASSUMED scenario, not measured): metros where no trade is covered today have no live city source a member can act on.
  // If every such metro were covered for every trade (the most new sources there could do), a trade reaches covered-today + that many.
  const empty = CENTRES.filter((c) => !block.trades.some((t) => t.covered.includes(c.id)));
  const reach = block.trades.filter((t) => t.covered.length + empty.length >= PAY_MIN_METROS);
  const reachUpper = upper.trades.filter((t) => t.covered.length + empty.length >= PAY_MIN_METROS);
  P(`Arithmetic ceiling (ASSUMED scenario, not a measurement): ${empty.length} metros have no covered cell for any trade today (${empty.map((c) => SHORT[c.id]).join(', ') || 'none'}). Even if new sources there covered EVERY trade, only trades already covering ${PAY_MIN_METROS - empty.length}+ of the other metros could reach ${PAY_MIN_METROS}: ${reach.length} of ${TRADES.length} (${f1((100 * reach.length) / TRADES.length)}%) with block, ${reachUpper.length} upper (${reach.map((t) => t.trade).join(', ')}). The other ${TRADES.length - reach.length} trades also need new record types or labels in the metros that already have sources.`);
  P();
}

// ---- 6. bias and robustness ------------------------------------------------------------------------------------------------------
P('## 6. Caveats: how the rows file biases each cell (measured, not assumed, where a number is given)');
P();
{
  const t = raw.map((r) => Date.parse(r.occurred_at)).filter(Number.isFinite);
  const min = new Date(Math.min(...t)).toISOString();
  const max = new Date(Math.max(...t)).toISOString();
  P(`- Window: occurred_at runs ${min} to ${max}; the file was exported 2026-11-22 (file time), so rows dated after that are future-dated by their source (event start dates, NWS end times). Each source is put on a weekly footing over its OWN span (newest minus oldest occurred_at, at least 1 day), as the reviewed replay does.`);
  P('- Span per source (rows, span in days by range / by calendar dates): ' + [...spans].sort((a, b) => a[1] - b[1]).map(([s, d]) => `${s} ${raw.filter((r) => r.source === s).length} rows ${f1(d)}/${calendarSpans.get(s)}`).join('; ') + '.');
  // Calendar-day sensitivity.
  const calMeasured = measure(rows, CENTRES, calendarSpans, specCapable, { nowMs: NOW });
  const flips: string[] = [];
  for (const tr of TRADES) for (const c of CENTRES) {
    const a = covers(measured.grid[tr][c.id], 'block');
    const b = covers(calMeasured.grid[tr][c.id], 'block');
    if (a !== b) flips.push(`${tr} ${SHORT[c.id]} ${a ? 'covered -> not' : 'not -> covered'} (${f1(callPathRate(measured.grid[tr][c.id], 'block'))} -> ${f1(callPathRate(calMeasured.grid[tr][c.id], 'block'))}/wk)`);
  }
  const calHead = headlineOf(calMeasured.grid, CENTRES, 'block');
  P(`- Span sensitivity (with block): counting a source's days as the calendar dates its rows fall on (usually more days than the range, so rates go down; fewer where a source skips days) flips ${flips.length} cell(s): ${flips.join('; ') || 'none'}. Headline with calendar spans: ${calHead.paying} of ${calHead.total}.`);
  // Fragile cells: covered only thanks to sources with span < 3 days.
  const fragile: string[] = [];
  for (const tr of TRADES) for (const c of CENTRES) {
    const x = measured.grid[tr][c.id];
    if (!covers(x, 'block')) continue;
    let sturdy = 0;
    for (const [s, r] of Object.entries(x.bySource)) if ((spans.get(s) ?? 14) >= 3) sturdy += callPathRate(r, 'block');
    if (sturdy + 1e-9 < 1) fragile.push(`${tr} ${SHORT[c.id]} (${f1(callPathRate(x, 'block'))}/wk, ${f1(sturdy)} from sources held 3+ days)`);
  }
  P(`- Short holds (sources whose rows span under 3 days are multiplied by 7/span with a 1-day floor, so a handful of rows becomes a weekly rate): cells covered only because of such sources: ${fragile.join('; ') || 'none'}.`);
  // NYC 311 night sample.
  const nyc = raw.filter((r) => r.source === 'socrata-nyc-311');
  const night = nyc.filter((r) => {
    const h = new Date(r.occurred_at).getUTCHours();
    return h >= 1 && h < 7;
  }).length;
  const chi = raw.filter((r) => r.source === 'socrata-chicago-311');
  const chiNight = chi.filter((r) => {
    const h = new Date(r.occurred_at).getUTCHours();
    return h >= 1 && h < 7;
  }).length;
  const k = chiNight ? chi.length / chiNight : 1;
  const nycCallPath = TRADES.reduce((s, tr) => s + (measured.grid[tr]['new-york'].bySource['socrata-nyc-311']?.addressPerWeek ?? 0), 0);
  // (addressPerWeek = exact + block: the stored NYC 311 rows carry no address of either kind.)
  const nycUpper = TRADES.reduce((s, tr) => s + (measured.grid[tr]['new-york'].bySource['socrata-nyc-311']?.upperPerWeek ?? 0), 0);
  const nycAll = TRADES.reduce((s, tr) => s + (measured.grid[tr]['new-york'].bySource['socrata-nyc-311']?.perWeek ?? 0), 0);
  const nearMiss: string[] = [];
  for (const tr of TRADES) {
    const x = measured.grid[tr]['new-york'];
    const s = x.bySource['socrata-nyc-311'];
    if (!s || covers(x, 'block')) continue;
    if (callPathRate(x, 'block') + callPathRate(s, 'block') * (k - 1) + 1e-9 >= 1) nearMiss.push(tr);
  }
  P(`- NYC 311 is a night sample: ${night} of ${nyc.length} stored rows (${pct(night, nyc.length)}) fall between 01:00 and 07:00 UTC. Chicago 311 puts ${pct(chiNight, chi.length)} of its rows in the same hours, so the full NYC day is plausibly about ${f1(k)} times the sample (assumed: Chicago's hour shape). Effect on the grid: NYC 311 gives NYC trades ${f1(nycAll)} actionable cards a week in all, ${f1(nycCallPath)} of them with an address (exact or block) and ${f1(nycUpper)} upper, because its stored rows carry a borough, never an address, and the source has no contact spec. The round 20 live change (a private block-level site contact for whole-building heat) cannot be seen in this file, which has no contacts: it is in the PROJECTED section only. So the sample understates NYC actionable volume (HVAC heat cards above all) but cannot change any NYC coverage cell; NYC cells it would flip if scaled by ${f1(k)}: ${nearMiss.join(', ') || 'none'}.`);
  P('- Per cell, then: cells fed by permits (most covered cells) are fair to slightly high (range spans run up to a day short); cells fed by a source held 1 to 3 days are the least stable (listed above); NYC cells fed by 311 are low on actionable volume but unaffected on call path; metros with no live city source (Houston, Miami, Philadelphia, Phoenix, mostly Dallas) are measured at what members get today, which is weather, storm reports and federal records only.');
  P('- Per-scan caps (25 cards, 5 business licences per member per scan) are not applied, as in the replay; they bind far above 1 card a week, so they cannot flip a coverage cell.');
  P('- Live permit cards with no call path are held as background by the scan (alert-gate.ts, contactPath null); the rows file has no contacts, so such cards are counted as actionable here but never as call-path cards, which is what decides coverage.');
}
P();

// ---- 7. projection -----------------------------------------------------------------------------------------------------------------
const proposedIds = Object.keys(PROPOSED_LABELS);
let projectedJson: unknown = null;
let projectedLine = '';
if (WITH_PROPOSED) {
  P('## 7. PROJECTED (unverified until probes run): the measured grid plus what proposed probation sources and one unmeasurable live change are expected to add');
  P();
  P(`Proposed sources read from lib/signals/proposed-labels.ts: ${proposedIds.length}${proposedIds.length ? ` (${proposedIds.join(', ')})` : ' (none yet: the projection equals the measured grid)'}.`);
  for (const id of proposedIds) {
    const s = PROPOSED_LABELS[id];
    const tier = proposedTierOf(s);
    P(`- ${id}: ${s.recordKind}, metros ${s.metros.join(', ')}, ${s.expectedRowsPerWeekPerMetro} rows a week per metro [${s.volumeEvidence.tag}: ${s.volumeEvidence.note}], call path ${tier ?? 'none'}, alert labels for ${Object.entries(s.labels).filter(([, l]) => l && (typeof l === 'string' ? l : l.label) !== 'context' && (typeof l === 'string' ? l : l.label) !== 'market_insight').map(([t]) => t).join(', ') || 'no trade'}.`);
  }
  P();
  // The round 20 LIVE change that the rows file cannot show: NYC 311 whole-building heat (HEAT/HOT WATER / ENTIRE BUILDING and
  // Non-Residential Heat) now keeps a PRIVATE block-level site contact (lib/signals/adapters/socrata.ts). The rows file holds no contacts, so
  // the projection counts each such card as a block-level call path. ASSUMED: the live column incident_address exists and its address passes
  // the New York block rule; neither was checked (VIOL-report.md section 8).
  const liveHeat = (r: CoverageRow): boolean => isWholeBuildingHeat(r) || (r.source === 'socrata-nyc-311' && /non-residential heat/i.test(r.title ?? ''));
  const projectedPath = (r: CoverageRow, sc: (source: string) => boolean): CallPath => {
    const pth = callPathOfRow(r, sc);
    return (pth === null || pth === 'spec') && liveHeat(r) ? 'block' : pth;
  };
  const withLive = measure(rows, CENTRES, spans, specCapable, { nowMs: NOW }, TRADES, projectedPath);
  const liveFlips: string[] = [];
  for (const tr of TRADES) for (const c of CENTRES) if (!covers(measured.grid[tr][c.id], 'block') && covers(withLive.grid[tr][c.id], 'block')) liveFlips.push(`${tr} ${SHORT[c.id]} (${f1(callPathRate(withLive.grid[tr][c.id], 'block'))}/wk)`);
  P(`Live change counted here only (ASSUMED: the live 311 column incident_address exists and passes the New York block rule): NYC 311 whole-building heat cards get a block-level call path. ${rows.filter(liveHeat).length} such rows in the file; cells this moves to covered with block: ${liveFlips.join('; ') || 'none'}.`);
  P();
  const pg = projectGrid(withLive.grid, CENTRES, PROPOSED_LABELS);
  const ph = { strict: projectedHeadline(pg, CENTRES, 'strict'), block: projectedHeadline(pg, CENTRES, 'block'), upper: projectedHeadline(pg, CENTRES, 'upper') };
  P('Cell: PROJECTED call-path cards a week with block (measured + live change + proposed). "#" covers strict, "b" covers only with block, "." neither; "*" marks a cell moved to covered (with block) by a proposed source or the live change.');
  P();
  P(`| Trade (PROJECTED) | ${CENTRES.map((c) => SHORT[c.id]).join(' | ')} | Covered strict | Covered with block | Covered upper |`);
  P(`|---|${CENTRES.map(() => '---:').join('|')}|---:|---:|---:|`);
  const flipped: string[] = [];
  for (const tr of TRADES) {
    const cells = CENTRES.map((c) => {
      const p = pg[tr][c.id];
      const was = covers(measured.grid[tr][c.id], 'block');
      const now = projectedRate(p, 'block') + 1e-9 >= 1;
      if (!was && now) flipped.push(`${tr} ${SHORT[c.id]} (${[...new Set(p.from)].join(', ') || 'live NYC heat block'})`);
      const mark = projectedRate(p, 'strict') + 1e-9 >= 1 ? '#' : now ? 'b' : '.';
      return `${f1(projectedRate(p, 'block'))} ${mark}${!was && now ? '*' : ''}`;
    });
    const n = (h: Headline) => {
      const t = h.trades.find((x) => x.trade === tr)!;
      return `${t.covered.length}${t.pays ? ' PAYS' : ''}`;
    };
    P(`| ${tr} | ${cells.join(' | ')} | ${n(ph.strict)} | ${n(ph.block)} | ${n(ph.upper)} |`);
  }
  P();
  P(`Cells moved to covered (with block) by proposed sources or the live change: ${flipped.length ? flipped.join('; ') : 'none'}.`);
  P();
  {
    const add = { strict: 0, block: 0 };
    const cellsCovered = { strict: 0, block: 0, upper: 0 };
    for (const tr of TRADES) for (const c of CENTRES) {
      const p = pg[tr][c.id];
      add.strict += p.addedCallPathPerWeek;
      add.block += p.addedBlockPerWeek;
      for (const m of ['strict', 'block', 'upper'] as const) if (projectedRate(p, m) + 1e-9 >= 1) cellsCovered[m]++;
    }
    P(`Per-tier (PROJECTED): proposed sources add ${f1(add.strict)} strict call-path cards a week (business or exact) and ${f1(add.block)} block-only cards a week over the grid. Covered cells of 410: strict ${cellsCovered.strict}, with block ${cellsCovered.block}, upper ${cellsCovered.upper}.`);
    P();
  }
  P(`HEADLINE (PROJECTED, unverified until probes run, with block level, OFFICIAL): ${ph.block.paying} of ${ph.block.total} trades would pay (${f1(ph.block.pct)}%).`);
  P(`HEADLINE (PROJECTED, strict): ${ph.strict.paying} of ${ph.strict.total} (${f1(ph.strict.pct)}%). Upper: ${ph.upper.paying} of ${ph.upper.total} (${f1(ph.upper.pct)}%).`);
  P(`Paying trades (PROJECTED, with block): ${ph.block.trades.filter((t) => t.pays).map((t) => t.trade).join(', ') || 'none'}. One metro short: ${ph.block.trades.filter((t) => t.covered.length === PAY_MIN_METROS - 1).map((t) => t.trade).join(', ') || 'none'}.`);
  P(`MEASURED for comparison: with block ${block.paying} of ${block.total} (${f1(block.pct)}%), strict ${strict.paying} of ${strict.total} (${f1(strict.pct)}%).`);
  P();
  projectedLine = ` PROJECTED (unverified): ${ph.block.paying} of ${ph.block.total} (${f1(ph.block.pct)}%) with block; ${ph.strict.paying} strict; ${ph.upper.paying} upper.`;
  projectedJson = {
    note: 'PROJECTED, unverified until probes run; includes the NYC 311 whole-building heat block contact as an assumed live change',
    proposed: proposedIds,
    headline: Object.fromEntries((['strict', 'block', 'upper'] as const).map((m) => [m, { paying: ph[m].paying, total: ph[m].total, pct: ph[m].pct }])),
    trades: ph.block.trades,
    cells: pg,
  };
}

P(`RESULT: MEASURED ${block.paying} of ${block.total} trades would pay (${f1(block.pct)}%) with block level (official); ${strict.paying} of ${strict.total} (${f1(strict.pct)}%) strict; ${upper.paying} of ${upper.total} (${f1(upper.pct)}%) upper.${projectedLine} Anchor ${anchorFail === 0 ? 'PASS' : 'FAIL'}.`);

process.stdout.write(lines.join('\n') + '\n');
if (JSON_OUT) {
  mkdirSync(dirname(JSON_OUT), { recursive: true });
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      {
        rows: ROWS,
        measured: {
          headline: Object.fromEntries(([['strict', strict], ['block', block], ['upper', upper]] as const).map(([m, h]) => [m, { paying: h.paying, total: h.total, pct: h.pct }])),
          trades: block.trades,
          grid: measured.grid,
          presence: measured.presence,
        },
        projected: projectedJson,
      },
      null,
      1,
    ),
  );
}
if (anchorFail) process.exitCode = 1;
