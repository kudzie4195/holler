import type { WindDamageFacts } from '../carry';

/**
 * Round 33: the fixed summary parts the LSR adapter (adapters/lsr.ts) writes in place of the report's remark, which is never stored.
 * Kept in their own client-safe module so lib/signals/summary-i18n.ts can translate them without importing the adapter.
 *
 * Review P1-3: each part carries exactly one of the facts lib/signals/carry.ts windDamageFactsOf reads, and nothing else, so the wind damage
 * rule (line 39) reads the same facts back from this summary as from the remark itself: an LSR row and an SPC row with the same remark get
 * the same label for every trade (tests/signals/weather-hazard.test.ts checks every combination).
 */
export const LSR_TREE_PART = 'The report names trees or limbs down';
export const LSR_ROAD_PART = 'It names a road';
export const LSR_ROOF_PART = 'It names a roof, siding or gutters';
export const LSR_HOME_PART = 'It names a home';
export const LSR_YARD_PART = 'It names a yard';
export const LSR_BUILDING_PART = 'It names a building';
export const LSR_DAMAGE_PART = 'The report names wind damage, not confirmed';

export const LSR_PARTS: readonly string[] = [LSR_TREE_PART, LSR_ROAD_PART, LSR_ROOF_PART, LSR_HOME_PART, LSR_YARD_PART, LSR_BUILDING_PART, LSR_DAMAGE_PART];

/** The summary for a non-thunderstorm wind damage report, from the facts its remark named (read in memory, never stored). */
export function lsrSummaryOf(f: WindDamageFacts): string {
  const parts: string[] = [];
  if (f.trees) parts.push(LSR_TREE_PART);
  if (f.road) parts.push(LSR_ROAD_PART);
  if (f.roof) parts.push(LSR_ROOF_PART);
  if (f.homeOrYard && f.structure) parts.push(LSR_HOME_PART);
  else if (f.homeOrYard) parts.push(LSR_YARD_PART);
  else if (f.structure && !f.roof) parts.push(LSR_BUILDING_PART);
  return parts.length ? parts.join(' | ') : LSR_DAMAGE_PART;
}
