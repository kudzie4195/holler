import { CATEGORIES } from '@/lib/signals/categories';
import { tradeComingSoon } from '@/lib/seo/signal-types';
import { tradeNoLiveSource } from '@/lib/signals/lead-rules';
import { tradeLabel } from '@/lib/check/trades';
import { t, type Lang } from '@/lib/i18n';
import type { ChipCategory } from '@/components/profile-form-groups';

/**
 * Round 23. Holler is marketed for four kinds of work: landscaping (with lawn care), gutters and pressure washing. Those chips come
 * first, in their own group at the top of the form, so an owner-operator arriving from a video finds his trade without reading 37
 * others. Everything else is unchanged and still pickable, under "More trades".
 * Order inside the group is the order here.
 */
export const MARKETED_TRADES: readonly string[] = ['landscaping', 'lawn-care', 'siding-gutters', 'cleaning'];

/**
 * The synthetic "Pressure washing" chip. Pressure washing is not a trade in lib/signals/categories.ts: "pressure washing" and "power
 * washing" are keywords inside House cleaning, and roof permits reach Siding and gutters, so a washer has to guess which of the two to
 * pick and today gets half his records either way. This chip picks BOTH for him. It is never saved: components/profile-form.tsx turns it
 * into its two real ids before the form is submitted, so nothing downstream (matching, limits, the database) knows it exists.
 * It costs two of the plan's trade slots, which is what picking the two chips by hand costs.
 */
export const PRESSURE_WASHING_ID = 'pressure-washing';
export const PRESSURE_WASHING_PARTS: readonly string[] = ['cleaning', 'siding-gutters'];

/**
 * The trade chips for the onboarding and Settings form: every category, its group, and whether it can be picked on this deployment.
 * `lang` 'es' (round 18 ES) gives the Spanish trade names (lib/check/trades.ts tradeLabel); English is CATEGORIES' own label, as before.
 * Round 23: the marketed trades are copied into a first group ('marketed'), the composite "Pressure washing" chip is added to it, and
 * the rest keep their own groups. A marketed trade that cannot be picked on this deployment is left where it was.
 */
export function profileCategories(lang: Lang = 'en'): ChipCategory[] {
  const all: ChipCategory[] = CATEGORIES.map((c) => ({
    id: c.id,
    label: lang === 'en' ? c.label : tradeLabel(c.id, lang),
    group: (c as unknown as { group?: string }).group,
    comingSoon: tradeComingSoon(c.id) || tradeNoLiveSource(c.id),
    noLiveSource: tradeNoLiveSource(c.id),
  }));
  const byId = new Map(all.map((c) => [c.id, c]));
  const lead: ChipCategory[] = [];
  for (const id of MARKETED_TRADES) {
    const c = byId.get(id);
    if (c && !c.comingSoon) lead.push({ ...c, group: 'marketed' });
  }
  // The composite only makes sense when both halves can be picked.
  if (PRESSURE_WASHING_PARTS.every((id) => byId.get(id) && !byId.get(id)!.comingSoon)) {
    // Not a CATEGORIES id, so its label comes from the dictionary, not tradeLabel (which would fall back to the id).
    lead.push({ id: PRESSURE_WASHING_ID, label: t(lang, 'pf.trade.pressure_washing'), group: 'marketed' });
  }
  const moved = new Set(lead.map((c) => c.id));
  return [...lead, ...all.filter((c) => !moved.has(c.id))];
}
