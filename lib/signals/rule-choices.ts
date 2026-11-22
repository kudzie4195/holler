/**
 * The owner's twelve yes-or-no calls on the audited alert rules (round 19 RULES, review of ENGINE-compare.md section 7). The owner has not
 * answered them yet; these are the defaults the round was told to use (calls 11 and 12 were added by the review of the round, and
 * call 6 was turned to NO by the coordinator after the review measured 44.6 heads-up cards a day for one New York commercial cleaner). Each one is read by exactly one place in the label code
 * (lib/signals/lead-rules.ts, lib/signals/permit-routing.ts, lib/signals/repeat-marks.ts), so flipping a call is a one-line change here,
 * and tests/signals/rule-choices.test.ts shows what each flip does on a real row title.
 *
 * Pure and client-safe. Never read from the database or the environment: a change is reviewed in a pull request like any rule.
 */
export interface RuleChoices {
  /** 1. NYC whole-building heat: urgent for HVAC only at the third complaint at one building within 48 hours, one card per building. */
  heatPerBuilding: boolean;
  /** 2. Remodel permits stay feed only (market insight) for the follow-on trades, with no job-value exception. */
  remodelFeedOnly: boolean;
  /**
   * 3. Addition permits alert HVAC, painters and flooring (heads-up). NO: feed only for painters and flooring; HVAC is not carried on an
   * addition at all, so it sees nothing (as before round 19).
   */
  additionAlertsFollowOnTrades: boolean;
  /** 4a. A new licence for a shop-type storefront (electronics store, pawn shop, beauty parlour) alerts sign, security and commercial cleaning. */
  shopLicenceAlerts: boolean;
  /** 4b. The same for a parking garage or parking lot licence. */
  parkingLicenceAlerts: boolean;
  /** 5. A NYC 311 rat sighting with no building named alerts pest control. NO: feed only. */
  ratSightingAlerts: boolean;
  /** 6. A failed restaurant inspection also alerts commercial cleaners (heads-up). NO: feed only. */
  failedInspectionAlertsCommercialCleaners: boolean;
  /** 7. A new-home permit alerts fence companies. NO: feed only. */
  newHomeAlertsFencing: boolean;
  /** 8. A closed or complied case disappears completely, including from the feed (context). NO: it stays in the feed as market insight. */
  closedCaseHidden: boolean;
  /** 9. Towing companies get a heads-up on a Flash Flood Warning. */
  towingOnFlashFloodWarning: boolean;
  /**
   * 10. A member may get zero alerts in a quiet fortnight. YES: no rule pads volume. Read by the replay's volume check only (a zero is
   * reported, never a failure); no label code reads it, which is the point.
   */
  quietFortnightAllowed: boolean;
  /** 11. The first and second NYC whole-building heat complaints at a building (no card yet) appear in the HVAC feed. NO: hidden. */
  heatFirstComplaintsInFeed: boolean;
  /**
   * 12. A code-violation order that names the handyman AND a specialist (general contractor, windows and doors, flooring) is a heads-up
   * for the handyman, not urgent: the specialist is the first call. NO: urgent for the handyman too.
   */
  handymanSecondToSpecialist: boolean;
}

export const RULE_CHOICES: Readonly<RuleChoices> = Object.freeze({
  heatPerBuilding: true, // 1. YES
  remodelFeedOnly: true, // 2. YES
  additionAlertsFollowOnTrades: false, // 3. NO
  shopLicenceAlerts: true, // 4. YES for shop-type licences
  parkingLicenceAlerts: false, // 4. NO for parking garages
  ratSightingAlerts: false, // 5. NO
  failedInspectionAlertsCommercialCleaners: false, // 6. NO (was YES; changed by the coordinator after the review, P2-7)
  newHomeAlertsFencing: false, // 7. NO
  closedCaseHidden: true, // 8. YES
  towingOnFlashFloodWarning: false, // 9. NO
  quietFortnightAllowed: true, // 10. YES
  heatFirstComplaintsInFeed: false, // 11. NO
  handymanSecondToSpecialist: true, // 12. YES, a heads-up
});

/** The twelve questions in the owner's words, numbered as in the review, for the replay report and the RULES report. */
export const RULE_CHOICE_QUESTIONS: ReadonlyArray<{ n: number; key: keyof RuleChoices; question: string }> = [
  { n: 1, key: 'heatPerBuilding', question: 'NYC whole-building heat complaint: urgent only at the third complaint at the same building within 48 hours, one card per building' },
  { n: 2, key: 'remodelFeedOnly', question: 'Remodel permits stay out of alerts for follow-on trades (feed only), with no value exception' },
  { n: 3, key: 'additionAlertsFollowOnTrades', question: 'Addition permits alert HVAC, painters and flooring' },
  { n: 4, key: 'shopLicenceAlerts', question: 'New licences for shop-type storefronts alert sign, security and commercial cleaning companies' },
  { n: 4, key: 'parkingLicenceAlerts', question: 'New licences for parking garages alert sign, security and commercial cleaning companies' },
  { n: 5, key: 'ratSightingAlerts', question: 'A 311 rat sighting with no building named alerts pest control' },
  { n: 6, key: 'failedInspectionAlertsCommercialCleaners', question: 'A failed restaurant inspection also alerts commercial cleaners' },
  { n: 7, key: 'newHomeAlertsFencing', question: 'A new-home permit alerts fence companies' },
  { n: 8, key: 'closedCaseHidden', question: 'A closed or complied case disappears completely, including from the feed' },
  { n: 9, key: 'towingOnFlashFloodWarning', question: 'Towing companies get a heads-up on a Flash Flood Warning' },
  { n: 10, key: 'quietFortnightAllowed', question: 'A member may get zero alerts in a quiet fortnight' },
  { n: 11, key: 'heatFirstComplaintsInFeed', question: 'First and second heat complaints at a building appear in the feed' },
  { n: 12, key: 'handymanSecondToSpecialist', question: 'A code-violation order that names a handyman and a specialist is only a heads-up for the handyman' },
];

let active: Readonly<RuleChoices> = RULE_CHOICES;

/** The current value of one call. Label code reads the calls only through this, so a test can try the other answer (withRuleChoices). */
export function ruleChoice<K extends keyof RuleChoices>(key: K): RuleChoices[K] {
  return active[key];
}

/**
 * Runs `fn` with some calls answered the other way, then restores them (also when `fn` throws). For tests and the replay's "what if"
 * lines only; product code never calls it. Synchronous on purpose: nothing else can run while the override is in place.
 */
export function withRuleChoices<T>(override: Partial<RuleChoices>, fn: () => T): T {
  const prev = active;
  active = Object.freeze({ ...prev, ...override });
  try {
    return fn();
  } finally {
    active = prev;
  }
}
