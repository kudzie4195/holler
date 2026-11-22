// Round 18 ROUTES review probe (logs/REV-ROUTES-probe-tests), kept as a permanent regression test (redo 1). With REV_OUT set it also
// writes its table to that path; without it it writes nothing.
/** REV-ROUTES probe 07: who gets a card for an alteration whose description mentions demolition, before (title "Demolition permit") and after (title "Remodel permit"). */
import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '@/lib/signals/categories';
import { labelFor } from '@/lib/signals/lead-rules';
import { RULE_CHOICES } from '@/lib/signals/rule-choices';
import { carriedTrades } from '@/lib/signals/permit-routing';
import type { CategoryId } from '@/lib/signals/categories';

const who = (title: string, cats: string[], summary: string) => {
  const sig = { source: 'socrata-sf-permits', kind: 'permit', subtype: 'permit', title, summary };
  const seen = carriedTrades(sig, cats);
  const out: Record<string, string[]> = { act_now: [], coming_soon: [], market_insight: [] };
  for (const c of CATEGORIES) {
    if (!seen.includes(c.id)) continue;
    const l = labelFor({ ...sig, categories: cats } as never, c.id as CategoryId);
    if (out[l]) out[l].push(c.id);
  }
  return out;
};
describe('REV-ROUTES 07', () => {
  it('prints', () => {
    for (const summary of ['otc alterations permit | 1450 Lombard St', 'Building Combo Permit | Alter Commercial | 100 MAIN ST', 'Commercial Alteration | 100 MAIN ST NE, ATLANTA, GA 30303']) {
      console.log(`\n${summary}`);
      console.log('  BASE  "Demolition permit" [junk-removal]:', JSON.stringify(who('Demolition permit in X', ['junk-removal'], summary)));
      console.log('  HEAD  "Remodel permit" [general-contractor]:', JSON.stringify(who('Remodel permit in X', ['general-contractor'], summary)));
      console.log('  HEAD  "Tenant fit-out permit" [general-contractor]:', JSON.stringify(who('Tenant fit-out permit in X', ['general-contractor'], summary)));
    }
    console.log('\nMechanical | New | 200 Colley Ave');
    console.log('  BASE "New construction and HVAC permit" [general-contractor,hvac]:', JSON.stringify(who('New construction and HVAC permit in X', ['general-contractor', 'hvac'], 'Mechanical | New | 200 Colley Ave')));
    console.log('  HEAD "HVAC permit" [hvac]:', JSON.stringify(who('HVAC permit in X', ['hvac'], 'Mechanical | New | 200 Colley Ave')));
    console.log('Electrical | New');
    console.log('  BASE:', JSON.stringify(who('New construction and electrical permit in X', ['general-contractor', 'electrical'], 'Electrical | New | 9 Pine St')));
    console.log('  HEAD:', JSON.stringify(who('Electrical permit in X', ['electrical'], 'Electrical | New | 9 Pine St')));
    console.log('Driveway / Sidewalks | New');
    console.log('  BASE:', JSON.stringify(who('New construction and concrete permit in X', ['general-contractor', 'concrete-paving'], 'Driveway / Sidewalks | New | 9 Pine St')));
    console.log('  HEAD:', JSON.stringify(who('Concrete permit in X', ['concrete-paving'], 'Driveway / Sidewalks | New | 9 Pine St')));
    expect(1).toBe(1);
  });
  it('redo 1 (decision 5): an alteration that mentions demolition keeps junk-removal as Coming soon, residential and commercial', () => {
    for (const summary of ['otc alterations permit | 1450 Lombard St', 'Building Combo Permit | Alter Commercial | 100 MAIN ST', 'Commercial Alteration | 100 MAIN ST NE, ATLANTA, GA 30303']) {
      const title = /Commercial Alteration/.test(summary) ? 'Tenant fit-out permit in X' : 'Remodel permit in X';
      // Round 19 integration: a residential remodel is feed only for follow-on trades while owner call 2 is YES (supersedes decision 5 there);
      // a commercial alteration (fit-out) keeps the round 18 rule soon-interior-demolition-hauling.
      const feedOnly = RULE_CHOICES.remodelFeedOnly && title.startsWith('Remodel') && !/commercial/i.test(summary);
      expect(who(title, ['general-contractor', 'junk-removal'], summary)[feedOnly ? 'market_insight' : 'coming_soon'], summary).toContain('junk-removal');
    }
  });
});
