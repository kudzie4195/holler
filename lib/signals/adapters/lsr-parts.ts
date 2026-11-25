/**
 * Round 33: the fixed summary parts the LSR adapter (adapters/lsr.ts) writes in place of the report's remark, which is never stored.
 * Kept in their own client-safe module so lib/signals/summary-i18n.ts can translate them without importing the adapter.
 */
export const LSR_TREE_PART = 'The report names trees or limbs down';
export const LSR_DAMAGE_PART = 'The report names wind damage, not confirmed';
