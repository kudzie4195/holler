import { CATEGORIES } from '@/lib/signals/categories';
import { tradeComingSoon } from '@/lib/seo/signal-types';
import { tradeNoLiveSource } from '@/lib/signals/lead-rules';
import { tradeLabel } from '@/lib/check/trades';
import type { Lang } from '@/lib/i18n';
import type { ChipCategory } from '@/components/profile-form-groups';

/**
 * The trade chips for the onboarding and Settings form: every category, its group, and whether it can be picked on this deployment.
 * `lang` 'es' (round 18 ES) gives the Spanish trade names (lib/check/trades.ts tradeLabel); English is CATEGORIES' own label, as before.
 */
export function profileCategories(lang: Lang = 'en'): ChipCategory[] {
  return CATEGORIES.map((c) => ({
    id: c.id,
    label: lang === 'en' ? c.label : tradeLabel(c.id, lang),
    group: (c as unknown as { group?: string }).group,
    comingSoon: tradeComingSoon(c.id) || tradeNoLiveSource(c.id),
    noLiveSource: tradeNoLiveSource(c.id),
  }));
}
