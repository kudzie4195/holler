import { PLAN_LIMITS, TIER_NAMES, type Tier } from './limits';

const P = PLAN_LIMITS;

/**
 * What each plan includes, in plain words. Numbers come from PLAN_LIMITS. Shared by the pricing cards and settings.
 * Round 23: the address lists and the printable door hanger are on both cards. They have been in /app since round 18 and are the
 * strongest part of Holler for an owner-operator who sells to homeowners, and neither card mentioned them.
 */
export const PLAN_FEATURES: Record<Tier, string[]> = {
  starter: [
    `${P.starter.areas} service area: your ZIP code and how far you travel`,
    `Up to ${P.starter.trades} trades`,
    'Alerts by email, at most one an hour',
    'All your matches on one page',
    'Address lists: where to hang and flyer this week',
    'A printable door hanger with your name and number',
    'Reply to resident requests through Holler',
  ],
  pro: [
    `Up to ${P.pro.areas} service areas: your ZIP code plus ${P.pro.extraAreas} more`,
    `Up to ${P.pro.trades} trades`,
    `Up to ${P.pro.keywords} keyword watches, such as "tree removal"`,
    'Alerts by email, at most one an hour',
    'All your matches on one page',
    'Address lists: where to hang and flyer this week',
    'A printable door hanger with your name and number',
    'Reply to resident requests through Holler',
  ],
};

/** One short line per plan, for buttons and settings. */
export function planLimitsLine(tier: Tier): string {
  const l = P[tier];
  const areas = l.areas === 1 ? '1 ZIP code' : `${l.areas} ZIP codes`;
  return l.keywords ? `${areas}, up to ${l.trades} trades, ${l.keywords} keyword watches` : `${areas}, up to ${l.trades} trades`;
}

/** Plain statement of what a downgrade to Solo does. Settings shows it next to the switch. */
export const DOWNGRADE_NOTE = `On ${TIER_NAMES.starter}, your extra areas, trades beyond ${P.starter.trades} and keyword watches stop being used. They stay saved, so they work again if you move back to ${TIER_NAMES.pro}.`;
