/**
 * Spanish price, plan and trial phrases (round 18, unit ES). Pure and client-safe. Every number comes from the same constants as the
 * English copy: the trial length from lib/plan/price-copy.ts (TRIAL_DAYS), prices from lib/stripe/plans.ts, names and limits from
 * lib/plan/limits.ts. Nothing here types a number, so a change to the trial length or a price reaches the Spanish pages too.
 *
 * Plan names: "Solo" is also a Spanish word ("only"), so "El plan Solo cuesta" can read as "the plan only costs". Spanish copy always
 * writes the name as "Plan Solo" / "Plan Pro" (planNameEs), and a price follows a colon ("Plan Solo: $7.99 al mes"), never "Solo cuesta".
 */
import { TRIAL_DAYS } from './price-copy';
import { PLAN_LIMITS, TIER_NAMES, type Tier } from './limits';
import { annualSavingsPercent, priceLabel, type Plan } from '../stripe/plans';

/** "Plan Solo", "Plan Pro". The one way Spanish copy names a plan. */
export function planNameEs(tier: Tier): string {
  return `Plan ${TIER_NAMES[tier]}`;
}

/** "prueba gratis de N días", N = TRIAL_DAYS. */
export function trialPhraseEs(days: number = TRIAL_DAYS): string {
  return `prueba gratis de ${days} días`;
}

/** "N días gratis", N = TRIAL_DAYS. */
export function trialDaysFreeEs(days: number = TRIAL_DAYS): string {
  return `${days} días gratis`;
}

/** "$7.99 al mes o $79.99 al año". */
export function planPricesEs(tier: Tier): string {
  return `${priceLabel(tier, 'monthly')} al mes o ${priceLabel(tier, 'annual')} al año`;
}

/** "Plan Solo: $7.99 al mes o $79.99 al año". */
export function namedPlanPricesEs(tier: Tier): string {
  return `${planNameEs(tier)}: ${planPricesEs(tier)}`;
}

/** "ahorra 16%" as a fact about the yearly price ("$79.99 al año, un ahorro del 16%"). Empty when there is no saving to state. */
export function annualSavingLabelEs(tier: Tier): string {
  const pct = annualSavingsPercent(tier);
  return pct >= 1 ? `un ahorro del ${pct}%` : '';
}

/** "Si paga por año, ahorra 16%." Empty when there is no saving to state. */
export function annualSavingSentenceEs(tier: Tier): string {
  const pct = annualSavingsPercent(tier);
  return pct >= 1 ? `Si paga por año, ahorra ${pct}%.` : '';
}

/** The auto-renewal disclosure next to a subscribe button, the Spanish twin of renewalNote (lib/stripe/plans.ts). */
export function renewalNoteEs(tier: Tier, plan: Plan, opts: { inTrial: boolean }): string {
  const per = plan === 'annual' ? 'al año' : 'al mes';
  const when = opts.inTrial ? 'cuando termine su prueba gratis' : 'desde hoy';
  return `${priceLabel(tier, plan)} ${per} ${when}. Se renueva automáticamente hasta que usted cancele en Configuración.`;
}

/** The same disclosure next to a plan switch button (planChangeNote in English). */
export function planChangeNoteEs(tier: Tier): string {
  return `${namedPlanPricesEs(tier)}, en su periodo de cobro actual. Se renueva automáticamente hasta que usted cancele en Configuración.`;
}

/** "1 código postal, hasta 5 oficios" / "3 códigos postales, hasta 15 oficios, 5 palabras clave" (planLimitsLine in English). */
export function planLimitsLineEs(tier: Tier): string {
  const l = PLAN_LIMITS[tier];
  const areas = l.areas === 1 ? '1 código postal' : `${l.areas} códigos postales`;
  return l.keywords ? `${areas}, hasta ${l.trades} oficios, ${l.keywords} palabras clave` : `${areas}, hasta ${l.trades} oficios`;
}

/** What each plan includes (PLAN_FEATURES in lib/plan/copy.ts), in Spanish. Numbers from PLAN_LIMITS. */
export function planFeaturesEs(tier: Tier): string[] {
  const P = PLAN_LIMITS;
  return tier === 'starter'
    ? [
        `${P.starter.areas} zona de servicio: su código postal y la distancia a la que trabaja`,
        `Hasta ${P.starter.trades} oficios`,
        'Alertas por correo, como máximo una por hora',
        'Su lista de coincidencias',
        'Listas de direcciones: dónde colgar y repartir volantes esta semana',
        'Un colgante de puerta para imprimir con su nombre y su teléfono',
        'Respuestas a solicitudes de vecinos a través de Holler',
      ]
    : [
        `Hasta ${P.pro.areas} zonas de servicio: su código postal y ${P.pro.extraAreas} más`,
        `Hasta ${P.pro.trades} oficios`,
        `Hasta ${P.pro.keywords} palabras clave vigiladas, como "retiro de árboles"`,
        'Alertas por correo, como máximo una por hora',
        'Su lista de coincidencias',
        'Listas de direcciones: dónde colgar y repartir volantes esta semana',
        'Un colgante de puerta para imprimir con su nombre y su teléfono',
        'Respuestas a solicitudes de vecinos a través de Holler',
      ];
}

/** What a move down to Plan Solo does (DOWNGRADE_NOTE in English). */
export function downgradeNoteEs(): string {
  return `Con el ${planNameEs('starter')}, sus zonas extra, los oficios que pasan de ${PLAN_LIMITS.starter.trades} y sus palabras clave dejan de usarse. Quedan guardados y vuelven a funcionar si regresa al ${planNameEs('pro')}.`;
}
