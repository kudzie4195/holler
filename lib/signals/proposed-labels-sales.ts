import type { CategoryId } from './categories';
import type { MetroId, ProposedSource, ProposedTradeLabel } from './proposed-labels';
import { SALE_TRADES } from './adapters/sales';
import type { SaleClass } from './adapters/sales-datasets';

/**
 * Round 20 SALES: the proposed labels of the property sale sources (lib/signals/adapters/sales-datasets.ts), for the scorecard's PROJECTED
 * grid only. Nothing here reaches a member: lead-rules.ts never reads it, and every one of these sources is on probation. At promotion the
 * label goes into SOURCE_DEFAULTS by review (LAUNCH.md, "Round 20 sales") and the entry here is removed.
 *
 * Label: a sale is a HEADS-UP (coming_soon) for the trades a home changing hands brings work to (movers, cleaners, landscapers and lawn
 * care, painters, flooring, fence, security, locksmiths, pest control, handymen, HVAC servicing, pool service), and for commercial
 * cleaning, security and signs when the property is commercial. Which trades each class reaches is SALE_TRADES in the adapter, so the
 * projection and the records can never disagree.
 *
 * Share of a trade = (share of the source's kept rows in the classes that reach it) x (share of rows within 25 miles of the metro centre)
 * x (pool service only: share of homes with a pool). Every number below is ASSUMED [A] (SALES-research.md); none was read from a portal.
 */

type Mix = Partial<Record<SaleClass, number>>;

interface SaleProjection {
  metro: MetroId;
  rowsPerWeek: number;
  note: string;
  mix: Mix;
  /** Share of the rows within 25 miles of the metro centre. */
  radius: number;
  /** Share of single-family homes with a pool (pool service). */
  pool: number;
}

const PROJECTIONS: Record<string, SaleProjection> = {
  'socrata-nyc-acris-sales': {
    metro: 'new-york', rowsPerWeek: 1000, radius: 0.95, pool: 0.05,
    mix: { residential_single: 0.2, condo: 0.25, multi_family: 0.25, commercial: 0.1 },
    note: 'NYC ACRIS deeds of $10,000+ (DEED, DEEDO): about 50,000+ market sales a year citywide, so about 1,000 a week [A]. Freshness is uncertain (a capture said the Master extract was last updated 2026-09-08 [3P]): the projection holds only if the probe says fresh.',
  },
  'socrata-cook-sales': {
    metro: 'chicago', rowsPerWeek: 1300, radius: 0.75, pool: 0.05,
    mix: { residential_single: 0.55, condo: 0.25, multi_family: 0.1, commercial: 0.05 },
    note: 'Cook County Assessor sales of $10,000+: about 65,000 a year county-wide, so about 1,300 a week [A], arriving semi-monthly about 5 to 6 weeks after the sale [3P]; about 75% of the county is within 25 miles of the Loop [A].',
  },
  'carto-phl-sales': {
    metro: 'philadelphia', rowsPerWeek: 270, radius: 1, pool: 0.05,
    mix: { residential_single: 0.8, multi_family: 0.08, commercial: 0.07 },
    note: 'Philadelphia deeds of $10,000+: about 23,000 a year, so about 450 a week [A]; only ~60% join the OPA class table on parcel_number [3P], so about 270 kept a week [A].',
  },
  'arcgis-miamidade-sales': {
    metro: 'miami', rowsPerWeek: 900, radius: 0.8, pool: 0.4,
    mix: { residential_single: 0.4, condo: 0.4, multi_family: 0.07, commercial: 0.05 },
    note: 'Miami-Dade recorded sales of $10,000+: about 45,000 a year county-wide, so about 900 a week [A] (the layer holds the latest sale per folio, published weekly [3P]).',
  },
};

const round = (n: number) => Math.round(n * 100) / 100;

function labelsFor(p: SaleProjection): Partial<Record<CategoryId, ProposedTradeLabel>> {
  const share = new Map<CategoryId, number>();
  for (const [cls, part] of Object.entries(p.mix) as [SaleClass, number][]) {
    for (const trade of SALE_TRADES[cls]) {
      const s = part * p.radius * (trade === 'pool-spa' ? p.pool : 1);
      share.set(trade, (share.get(trade) ?? 0) + s);
    }
  }
  const out: Partial<Record<CategoryId, ProposedTradeLabel>> = {};
  for (const [trade, s] of share) {
    out[trade] = { label: 'coming_soon', share: round(Math.min(1, s)), why: trade === 'janitorial-commercial' || trade === 'signs-printing' ? 'commercial sales only' : 'heads-up: the property changed hands' };
  }
  return out;
}

export const SALES_PROPOSED_LABELS: Readonly<Record<string, ProposedSource>> = Object.fromEntries(
  Object.entries(PROJECTIONS).map(([id, p]) => [
    id,
    {
      metros: [p.metro],
      recordKind: 'property-sale',
      expectedRowsPerWeekPerMetro: p.rowsPerWeek,
      volumeEvidence: { tag: 'A', note: p.note },
      labels: labelsFor(p),
      callPath: true,
    } satisfies ProposedSource,
  ]),
);
