// Round 19 RULES: the owner's twelve calls live in ONE table (lib/signals/rule-choices.ts). Each test shows, on a real live row, what the
// default answer does and what the other answer would do, so flipping a call is a one-line change whose effect is already tested.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { labelFor } from '@/lib/signals/lead-rules';
import { carriedTrades } from '@/lib/signals/permit-routing';
import { RULE_CHOICE_QUESTIONS, RULE_CHOICES, ruleChoice, withRuleChoices } from '@/lib/signals/rule-choices';
import { withHeatMark } from '@/lib/signals/carry';
import { inputOf, liveRow } from './rules-audit-cases';

const label = (id: number, trade: Parameters<typeof labelFor>[1], noLocation = false) => labelFor(inputOf(liveRow(id), { noLocation }), trade);

describe('the twelve owner calls: one table, the round 19 defaults', () => {
  it('holds the defaults the round was given', () => {
    expect(RULE_CHOICES).toEqual({
      heatPerBuilding: true,
      remodelFeedOnly: true,
      additionAlertsFollowOnTrades: false,
      shopLicenceAlerts: true,
      parkingLicenceAlerts: false,
      ratSightingAlerts: false,
      failedInspectionAlertsCommercialCleaners: false,
      newHomeAlertsFencing: false,
      closedCaseHidden: true,
      towingOnFlashFloodWarning: false,
      quietFortnightAllowed: true,
      heatFirstComplaintsInFeed: false,
      handymanSecondToSpecialist: true,
    });
    expect(Object.isFrozen(RULE_CHOICES)).toBe(true);
    expect(new Set(RULE_CHOICE_QUESTIONS.map((q) => q.n))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    expect(new Set(RULE_CHOICE_QUESTIONS.map((q) => q.key))).toEqual(new Set(Object.keys(RULE_CHOICES)));
  });

  it('each call is one line of the table (a flip is a one-line change)', () => {
    const src = readFileSync('lib/signals/rule-choices.ts', 'utf8');
    const table = src.slice(src.indexOf('export const RULE_CHOICES'), src.indexOf('});', src.indexOf('export const RULE_CHOICES')));
    for (const k of Object.keys(RULE_CHOICES)) expect(table.match(new RegExp(`^\\s+${k}: (?:true|false),`, 'gm'))?.length, k).toBe(1);
  });

  it('withRuleChoices restores the table afterwards, also when the callback throws', () => {
    expect(() => withRuleChoices({ heatPerBuilding: false }, () => {
      expect(ruleChoice('heatPerBuilding')).toBe(false);
      throw new Error('x');
    })).toThrow('x');
    expect(ruleChoice('heatPerBuilding')).toBe(true);
  });
});

describe('what each call does on a real row (default, then the other answer)', () => {
  it('1. heat per building: an unmarked whole-building complaint (row 1176) is no HVAC card; with NO, every one is urgent again', () => {
    expect(label(1176, 'hvac')).toBe('context');
    expect(withRuleChoices({ heatPerBuilding: false }, () => label(1176, 'hvac'))).toBe('act_now');
    // review P2-1: a keyword watch (no trade) gets the same rule
    expect(label(1176, null)).toBe('context');
    expect(withRuleChoices({ heatPerBuilding: false }, () => label(1176, null))).toBe('act_now');
  });

  it('2. remodel feed only: row 68 "Remodel permit in Chicago" for a painter is market insight; with NO, a heads-up', () => {
    expect(label(68, 'painting')).toBe('market_insight');
    expect(withRuleChoices({ remodelFeedOnly: false }, () => label(68, 'painting'))).toBe('coming_soon');
  });

  it('3. additions: row 55463 "Addition permit in Atlanta" reaches no HVAC member and painters as feed only; with YES, both a heads-up', () => {
    const r = liveRow(55463);
    expect(carriedTrades(inputOf(r), r.categories)).not.toContain('hvac');
    expect(label(55463, 'painting')).toBe('market_insight');
    withRuleChoices({ additionAlertsFollowOnTrades: true }, () => {
      expect(carriedTrades(inputOf(r), r.categories)).toContain('hvac');
      expect(label(55463, 'hvac')).toBe('coming_soon');
      expect(label(55463, 'painting')).toBe('coming_soon');
      expect(label(2011, 'flooring')).toBe('coming_soon');
      // a remodel never reaches HVAC, whatever the call
      expect(carriedTrades(inputOf(liveRow(68)), liveRow(68).categories)).not.toContain('hvac');
    });
  });

  it('4. storefront licences: NYC "Secondhand Dealer" (row 131554) is a heads-up for security, "Garage & Parking Lot" (row 131502) feed only; flipped, the other way round', () => {
    expect(label(131554, 'security')).toBe('coming_soon');
    expect(label(131502, 'security')).toBe('market_insight');
    withRuleChoices({ shopLicenceAlerts: false, parkingLicenceAlerts: true }, () => {
      expect(label(131554, 'security')).toBe('market_insight');
      expect(label(131502, 'security')).toBe('coming_soon');
    });
    // review P2-7: a NYC licence row cannot say it is new, and "Electronics" (row 131922) looks like a renewal cycle: feed only either way
    expect(label(131922, 'security')).toBe('market_insight');
    expect(withRuleChoices({ shopLicenceAlerts: true, parkingLicenceAlerts: true }, () => label(131922, 'security'))).toBe('market_insight');
  });

  it('5. NYC rat sighting (row 1170) is feed only for pest control; with YES, a heads-up', () => {
    expect(label(1170, 'pest-control')).toBe('market_insight');
    expect(withRuleChoices({ ratSightingAlerts: true }, () => label(1170, 'pest-control'))).toBe('coming_soon');
  });

  it('6. failed restaurant inspection (row 1477) is feed only for commercial cleaners (NO since the review, P2-7); with YES, a heads-up; pest control unchanged', () => {
    expect(label(1477, 'janitorial-commercial')).toBe('market_insight');
    expect(withRuleChoices({ failedInspectionAlertsCommercialCleaners: true }, () => label(1477, 'janitorial-commercial'))).toBe('coming_soon');
    expect(label(1477, 'pest-control')).toBe('coming_soon');
    expect(withRuleChoices({ failedInspectionAlertsCommercialCleaners: true }, () => label(1477, 'pest-control'))).toBe('coming_soon');
  });

  it('7. new-home permit (row 871) is feed only for fencing; with YES, a heads-up', () => {
    expect(label(871, 'fencing')).toBe('market_insight');
    expect(withRuleChoices({ newHomeAlertsFencing: true }, () => label(871, 'fencing'))).toBe('coming_soon');
  });

  it('8. a closed case (row 120691, Cincinnati CLOS-NO) disappears, feed included; with NO, it stays as market insight', () => {
    expect(label(120691, 'hvac')).toBe('context');
    expect(withRuleChoices({ closedCaseHidden: false }, () => label(120691, 'hvac'))).toBe('market_insight');
  });

  it('8, review P2-4: with NO, a closed case the later rules hide stays hidden (city work: row 597 cancelled public graffiti, rows 2268 to 2275 Austin right-of-way trees)', () => {
    withRuleChoices({ closedCaseHidden: false }, () => {
      expect(label(597, 'painting')).toBe('context');
      expect(label(597, 'cleaning')).toBe('context');
      for (const id of [2268, 2269, 2270, 2271, 2272, 2273, 2274, 2275]) expect(label(id, 'tree-service'), String(id)).toBe('context');
    });
  });

  it('9. towing on a Flash Flood Warning (row 6780) gets nothing; with YES, a heads-up', () => {
    expect(liveRow(6780).title).toMatch(/^Flash Flood Warning: /);
    expect(label(6780, 'towing')).toBe('context');
    expect(withRuleChoices({ towingOnFlashFloodWarning: true }, () => label(6780, 'towing'))).toBe('coming_soon');
  });

  it('11. first and second whole-building heat complaints (row 1176, unmarked) are hidden; with YES, feed only (HVAC and a keyword watch); the marked row stays urgent', () => {
    expect(label(1176, 'hvac')).toBe('context');
    withRuleChoices({ heatFirstComplaintsInFeed: true }, () => {
      expect(label(1176, 'hvac')).toBe('market_insight');
      expect(label(1176, null)).toBe('market_insight');
      expect(labelFor(inputOf(liveRow(1176), { summary: withHeatMark(liveRow(1176).summary) }), 'hvac')).toBe('act_now');
    });
  });

  it('12. an order naming the handyman and a specialist (row 4258 "REPAIR PORCH SYSTEM") is a heads-up for the handyman; with NO, urgent; the general contractor is urgent either way', () => {
    expect(label(4258, 'handyman')).toBe('coming_soon');
    expect(label(4258, 'general-contractor')).toBe('act_now');
    expect(withRuleChoices({ handymanSecondToSpecialist: false }, () => label(4258, 'handyman'))).toBe('act_now');
  });

  it('10. a quiet fortnight is allowed: no label rule reads this call, so nothing pads volume', () => {
    expect(RULE_CHOICES.quietFortnightAllowed).toBe(true);
    for (const f of ['lib/signals/lead-rules.ts', 'lib/signals/permit-routing.ts', 'lib/signals/carry.ts', 'lib/signals/match.ts']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/quietFortnightAllowed/);
    }
  });
});
