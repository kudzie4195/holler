/**
 * Read-only per-trade replay of the label rules (round 18 ROUTES, item 4): `npm run replay:trades`.
 *
 * Runs the same label replay as scripts/replay-labels.ts (lib/signals/lead-rules.ts labelFor, plus the trades downstream of a permit's
 * type, lib/signals/permit-routing.ts) on the same real-row fixtures, scripts/fixtures/replay-14d (20,059 rows of holler_signals, Nov 7
 * to 21 2026, grouped by title), and prints, for each of the 10 largest trades (by cards), how many cards each RULE FAMILY produces
 * (lib/signals/alert-gate.ts ruleFamilyOf: the deciding rule's id, with the route kind for a downstream permit, or "default:<subtype>"),
 * split into alerts (act_now, coming_soon) and feed-only market insights, with the three most common titles of each family so a grader
 * can sample them. Families in the precision-hold table (alert-gate.ts PRECISION_HOLDS) are marked.
 *
 * What this replay cannot show: the fixtures are grouped titles with no summary, no job value and no contacts, so the work-profile
 * filters and the contact gate are not replayed here (they are unit-tested in tests/signals/routes-*.test.ts).
 *
 * Nothing here touches a database, the network or the clock. Same fixtures in, same output out.
 *   npm run replay:trades                 prints the report
 *   npm run replay:trades -- /tmp/out.md  also writes it to that path
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isAlertLabel, isFeedLabel, labelFor, type LabelInput } from '../lib/signals/lead-rules';
import { downstreamTradesOf } from '../lib/signals/permit-routing';
import { PRECISION_HOLDS, isHeldPair, ruleFamilyOf } from '../lib/signals/alert-gate';
import type { CategoryId } from '../lib/signals/categories';

const ROOT = join(__dirname, 'fixtures', 'replay-14d');
const OUT = process.argv[2];
const TOP_TRADES = 10;
const SAMPLE_TITLES = 3;

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

// Same grouping as scripts/replay-labels.ts (permits are labelled as one permit source: the permit rules do not depend on the city).
const groups: Group[] = [];
for (const [title, cats, n] of lines('permits.psv')) groups.push({ source: 'socrata-chicago-permits', subtype: 'permit', kind: 'permit', title, cats: cats.split(','), n: Number(n) });
for (const [source, rest, cats, n] of lines('c311.psv')) groups.push({ source, subtype: '311', kind: 'civic', title: `311 request in X: ${rest}`, cats: cats.split(','), n: Number(n) });
for (const [source, subtype, kind, title, cats, n] of lines('other.psv')) groups.push({ source, subtype, kind, title, cats: cats ? cats.split(',') : [], n: Number(n) });

const EXPECTED_ROWS = 20059;
const rowTotal = groups.reduce((a, g) => a + g.n, 0);
if (rowTotal !== EXPECTED_ROWS) throw new Error(`fixture rows ${rowTotal}, expected ${EXPECTED_ROWS}`);

interface Family {
  cards: number;
  alerts: number;
  insight: number;
  held: number;
  titles: Map<string, number>;
}
interface Trade {
  cards: number;
  alerts: number;
  families: Map<string, Family>;
}
const trades = new Map<string, Trade>();

for (const g of groups) {
  if (g.cats.length === 0) continue;
  const sig: LabelInput = { source: g.source, kind: g.kind, subtype: g.subtype, title: g.title };
  const downstream = g.subtype === 'permit' ? downstreamTradesOf(g.title).filter((t) => !g.cats.includes(t)) : [];
  for (const trade of [...g.cats, ...downstream]) {
    const label = labelFor(sig, trade as CategoryId);
    if (!isFeedLabel(label)) continue; // context is never a card
    const family = ruleFamilyOf(sig, trade);
    const t = trades.get(trade) ?? { cards: 0, alerts: 0, families: new Map<string, Family>() };
    const f = t.families.get(family) ?? { cards: 0, alerts: 0, insight: 0, held: 0, titles: new Map<string, number>() };
    f.cards += g.n;
    t.cards += g.n;
    if (isAlertLabel(label)) {
      f.alerts += g.n;
      t.alerts += g.n;
      if (isHeldPair(trade, family)) f.held += g.n;
    } else f.insight += g.n;
    f.titles.set(g.title, (f.titles.get(g.title) ?? 0) + g.n);
    t.families.set(family, f);
    trades.set(trade, t);
  }
}

const out: string[] = [];
const P = (s = '') => out.push(s);
P('# Trade replay: cards per rule family (read-only)');
P();
P(`Fixtures: scripts/fixtures/replay-14d, ${rowTotal} rows (14 days to Nov 21 2026). A card is one record and one trade it reaches (its own tags plus the trades downstream of a permit type) whose label is not context. Alerts = act_now + coming_soon (emailed and pushed); market insight = feed only.`);
P();
P(`Precision holds in force (lib/signals/alert-gate.ts PRECISION_HOLDS): ${PRECISION_HOLDS.length === 0 ? 'none' : PRECISION_HOLDS.map((h) => `${h.trade} + ${h.family}`).join(', ')}.`);
P();
const top = [...trades].sort((a, b) => b[1].cards - a[1].cards || (a[0] < b[0] ? -1 : 1)).slice(0, TOP_TRADES);
for (const [trade, t] of top) {
  P(`## ${trade}: ${t.cards} cards, ${t.alerts} alerts`);
  P();
  P('| Rule family | Cards | Alerts | Market insight (feed only) | Held | Most common titles (rows) |');
  P('|---|---:|---:|---:|---:|---|');
  for (const [family, f] of [...t.families].sort((a, b) => b[1].cards - a[1].cards || (a[0] < b[0] ? -1 : 1))) {
    const sample = [...f.titles].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, SAMPLE_TITLES).map(([x, n]) => `${x.replace(/\|/g, '/')} (${n})`).join('; ');
    P(`| ${family} | ${f.cards} | ${f.alerts} | ${f.insight} | ${f.held} | ${sample} |`);
  }
  P();
}

const text = out.join('\n') + '\n';
process.stdout.write(text);
if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
}
