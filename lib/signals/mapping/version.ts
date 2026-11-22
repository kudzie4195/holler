/**
 * Version of the rule-based category mapping (permits, 311, violations, business, inspections, event permits).
 * Every row a rule-based adapter writes carries `data.cat_v = CAT_V`. When this number goes up, the scan re-maps stored rows of the
 * subtypes in REMAP_SUBTYPES from the last 14 days in small batches (lib/signals/mapping/remap.ts) and rematches the rows that changed.
 * Rows whose categories were set by the AI step carry `data.cat_src = 'ai'` and are never re-mapped here.
 *
 * History
 *  1 (implicit, no cat_v): round 6 and earlier. Permit categories were the union of PERMIT_RULES and the keyword classifier, so a water
 *    heater permit carried hvac ("heater") and a new construction permit fanned out to landscaping and cleaning.
 *  2: round 7. Permit categories and the title label come from one classification (lib/signals/mapping/permit.ts). Code violations no
 *    longer add plumbing for a roof leak.
 *  3: round 15 quality gate. A permit whose structured work type is a sidewalk shed, scaffold, construction fence, site-safety plan, fire
 *    sprinkler, standpipe or curb cut carries no trade (permit.ts NO_TRADE_WORK_TYPE_RE). Code violations are tagged by VIOLATION_RULES alone
 *    (no keyword list: a gutter order is not roofing). A commercial alteration or addition is a tenant fit-out; an addition, alteration or
 *    accessory structure is never "New home"; masonry, dumpster and repair are their own generic kinds.
 *
 *    Stored rows: a row at version 2 got a full mapping at ingest from description fields the database does not keep, so it is NEVER
 *    re-derived from its summary (round 15 review P0). It gets only the version 3 delta (remap.ts remapFromV2: no-trade work types, and
 *    the violation rules) and the row it replaces is saved in data.cat_prev. Rows without a version get the full summary re-map as before.
 *    Downstream routing reads the record's own summary at match time (permit-routing.ts), so stored commercial rows are routed correctly
 *    without any rewrite.
 */
export const CAT_V = 3;

/** Subtypes whose mapping changed since version 1 and are therefore re-mapped from stored text. */
export const REMAP_SUBTYPES = ['permit', 'violation'] as const;

/** Older versions, for the PostgREST filter `data->>cat_v in (...)` (missing cat_v is matched separately). */
export const OLDER_VERSIONS: number[] = Array.from({ length: Math.max(0, CAT_V - 1) }, (_, i) => i + 1);
