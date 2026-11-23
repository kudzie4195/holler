import { CITY_FEEDS, type SignalTypeId } from '@/lib/signals/capabilities';
import { t, type Lang } from '@/lib/i18n';
import { CITY_TYPES, NATIONAL_TYPES, SIGNAL_PHRASES, activeTradeSignals, sourceActive } from '@/lib/seo/signal-types';
import { isAlertLabel, labelFor, ruleFor, type LabelInput } from '@/lib/signals/lead-rules';
import type { CategoryId } from '@/lib/signals/categories';
import { hasEnv, type EnvKey } from '@/lib/env';

type Has = (...k: EnvKey[]) => boolean;

/**
 * Round 24 INT2: the national record kinds whose label the matching rules (lib/signals/lead-rules.ts) decide by SOURCE alone, with the
 * sources that feed each one and whether that source is on here. Used to drop a kind that can never be an alert for the picked trade.
 */
const SOURCE_DECIDED: Partial<Record<SignalTypeId, { source: string; on: (has: Has) => boolean }[]>> = {
  contract: [
    { source: 'usaspending', on: () => true },
    { source: 'sam-gov', on: (has) => sourceActive('sam', has) },
  ],
  disaster: [{ source: 'fema', on: () => true }],
};

/**
 * True when the matching rules can never make this kind an alert for this trade: every source of it that is on here is labelled by a
 * fixed rule (or by its source default), and that label is not an alert. An awarded federal contract is "market insight" for every trade
 * (rule mi-awarded-contract: it cannot be bid on), so a lawn-care check no longer lists "federal contract awards" as something Holler
 * watches for lawn care. A kind decided by a rule that reads the record (a `pick`) is kept: it can be an alert.
 */
function neverAlert(type: SignalTypeId, trade: string, has: Has): boolean {
  const sources = SOURCE_DECIDED[type]?.filter((s) => s.on(has));
  if (!sources || sources.length === 0) return false;
  return sources.every(({ source }) => {
    const probe: LabelInput = { source, subtype: type, title: '', summary: '' };
    const rule = ruleFor(probe, trade as CategoryId);
    if (rule && typeof rule.pick === 'function') return false;
    return !isAlertLabel(labelFor(probe, trade as CategoryId));
  });
}

/**
 * What Holler really watches for a trade near a place, in plain words. Used only for the "nothing yet" state.
 * National types come from activeTradeSignals (what an adapter can tag for the trade, and only when its optional keys are set). City types (permits, 311, inspections,
 * business licenses, violations, event permits, airport status) are named only when the nearby city's feed has them
 * (CITY_FEEDS) and the trade receives them. Never a type that nothing sends.
 */
export function watchTypes(trade: string, citySlug: string | null, has?: Parameters<typeof activeTradeSignals>[1]): SignalTypeId[] {
  const forTrade = activeTradeSignals(trade, has);
  const cityHas = citySlug ? (CITY_FEEDS[citySlug] ?? []) : [];
  return forTrade.filter((t) => (NATIONAL_TYPES.includes(t) ? !neverAlert(t, trade, has ?? hasEnv) : CITY_TYPES.includes(t) && cityHas.includes(t)));
}

export function watchList(trade: string, citySlug: string | null, has?: Parameters<typeof activeTradeSignals>[1], lang: Lang = 'en'): string[] {
  return watchTypes(trade, citySlug, has).map((type) => (lang === 'en' ? SIGNAL_PHRASES[type] : t(lang, `chk.watch.${type}` as 'chk.watch.permit')));
}
