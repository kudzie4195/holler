import type { CategoryId } from './categories';
import type { MetroId, ProposedSource, ProposedTradeLabel } from './proposed-labels';
import { saleTradesFor } from './adapters/sales';
import { RESIDENTIAL_CLASSES } from './adapters/sales-datasets';
import type { SaleClass } from './adapters/sales-datasets';

/**
 * Round 20 SALES: the proposed labels of the property sale sources (lib/signals/adapters/sales-datasets.ts), for the scorecard's PROJECTED
 * grid only. Nothing here reaches a member: lead-rules.ts never reads it, and every one of these sources is on probation. At promotion the
 * label goes into SOURCE_DEFAULTS by review (LAUNCH.md, "Round 20 sales") and the entry here is removed.
 *
 * Label: a sale is a HEADS-UP (coming_soon) for the trades a property changing hands still brings work to weeks after closing (the
 * adapter's saleTradesFor, so the projection and the records never disagree; moving, locksmith, signs and pool service outside Miami were
 * removed after review, see SALES-report.md "Review fixes").
 *
 * Two entries per source (review P1-1): `<id>` for the residential rows and `<id>:commercial` for the commercial ones. A residential sale
 * is stored and shown at BLOCK level only (no house number), so it has NO call path (callPath false). A commercial sale keeps its street
 * address, so it has one (callPath true). expectedRowsPerWeekPerMetro of each entry is the source's rows a week times that part's share.
 *
 * Share of a trade inside an entry = (share of that entry's rows in the classes that reach the trade) x (share of rows within 25 miles of
 * the metro centre). Every number below is ASSUMED [A] (SALES-research.md); none was read from a portal.
 */

type Mix = Partial<Record<SaleClass, number>>;

interface SaleProjection {
  metro: MetroId;
  rowsPerWeek: number;
  note: string;
  mix: Mix;
  /** Share of the rows within 25 miles of the metro centre. */
  radius: number;
}

const PROJECTIONS: Record<string, SaleProjection> = {
  'socrata-nyc-acris-sales': {
    metro: 'new-york', rowsPerWeek: 1000, radius: 0.95,
    mix: { residential_single: 0.2, condo: 0.25, multi_family: 0.25, commercial: 0.1 },
    note: 'NYC ACRIS deeds of $10,000+ (DEED, DEEDO): about 50,000+ market sales a year citywide, so about 1,000 a week [A]. Freshness is uncertain (a capture said the Master extract was last updated 2026-09-08 [3P]): the projection holds only if the probe says fresh.',
  },
  'socrata-cook-sales': {
    metro: 'chicago', rowsPerWeek: 1300, radius: 0.75,
    mix: { residential_single: 0.55, condo: 0.25, multi_family: 0.1, commercial: 0.05 },
    note: 'Cook County Assessor sales of $10,000+: about 65,000 a year county-wide, so about 1,300 a week [A], arriving semi-monthly about 5 to 6 weeks after the sale [3P]; about 75% of the county is within 25 miles of the Loop [A].',
  },
  'carto-phl-sales': {
    metro: 'philadelphia', rowsPerWeek: 270, radius: 1,
    mix: { residential_single: 0.8, multi_family: 0.08, commercial: 0.07 },
    note: 'Philadelphia deeds of $10,000+: about 23,000 a year, so about 450 a week [A]; only ~60% join the OPA class table on parcel_number [3P], so about 270 kept a week [A].',
  },
  'arcgis-miamidade-sales': {
    metro: 'miami', rowsPerWeek: 900, radius: 0.8,
    mix: { residential_single: 0.4, condo: 0.4, multi_family: 0.07, commercial: 0.05 },
    note: 'Miami-Dade recorded sales of $10,000+: about 45,000 a year county-wide, so about 900 a week [A] (the layer holds the latest sale per folio, published weekly [3P]).',
  },
};

const round = (n: number) => Math.round(n * 100) / 100;

function labelsFor(id: string, p: SaleProjection, part: 'residential' | 'commercial'): Partial<Record<CategoryId, ProposedTradeLabel>> {
  const classes = (Object.entries(p.mix) as [SaleClass, number][]).filter(([cls]) => (part === 'residential') === RESIDENTIAL_CLASSES.has(cls));
  const total = classes.reduce((n, [, x]) => n + x, 0);
  const share = new Map<CategoryId, number>();
  for (const [cls, x] of classes) {
    for (const trade of saleTradesFor({ metro: p.metro }, cls)) share.set(trade, (share.get(trade) ?? 0) + (total ? x / total : 0) * p.radius);
  }
  const out: Partial<Record<CategoryId, ProposedTradeLabel>> = {};
  for (const [trade, x] of share) {
    out[trade] = { label: 'coming_soon', share: round(Math.min(1, x)), why: part === 'commercial' ? `commercial sale (${id}): the street address is shown` : 'heads-up: a home on this block changed hands (block only, no call path)' };
  }
  return out;
}

function entry(id: string, p: SaleProjection, part: 'residential' | 'commercial'): ProposedSource {
  const frac = (Object.entries(p.mix) as [SaleClass, number][]).filter(([cls]) => (part === 'residential') === RESIDENTIAL_CLASSES.has(cls)).reduce((n, [, x]) => n + x, 0);
  return {
    metros: [p.metro],
    recordKind: 'property-sale',
    expectedRowsPerWeekPerMetro: Math.round(p.rowsPerWeek * frac),
    volumeEvidence: { tag: 'A', note: `${p.note} ${part === 'residential' ? 'Residential part' : 'Commercial part'}: ${Math.round(frac * 100)}% of rows [A].` },
    labels: labelsFor(id, p, part),
    callPath: part === 'commercial',
  };
}

export const SALES_PROPOSED_LABELS: Readonly<Record<string, ProposedSource>> = Object.fromEntries(
  Object.entries(PROJECTIONS).flatMap(([id, p]) => [
    [id, entry(id, p, 'residential')],
    [`${id}:commercial`, entry(id, p, 'commercial')],
  ]),
);
