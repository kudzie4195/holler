/**
 * Round 24 INT2 (COPY report section 6): the /check "what Holler watches" list names only record kinds the matching rules can make an
 * alert for the picked trade. An awarded federal contract is market insight for every trade (lead-rules mi-awarded-contract), so it is
 * not listed. FEMA declarations stay where the rules tag the trade and alert it (lawn care: drought declarations, source default
 * coming_soon); see INT2-report.md.
 */
import { describe, expect, it } from 'vitest';
import { watchList, watchTypes } from '@/lib/check/watch';
import { labelFor } from '@/lib/signals/lead-rules';
import { TRADE_SIGNALS } from '@/lib/signals/capabilities';

const NONE = () => false;
const SAM = (...k: string[]) => k.every((x) => x === 'SAM_API_KEY');

describe('the check watch list fits the trade', () => {
  it('lawn care in Atlanta: no federal contract awards (the rules never alert them); the city kinds stay', () => {
    expect(TRADE_SIGNALS['lawn-care']).toContain('contract');
    expect(labelFor({ source: 'usaspending', subtype: 'contract', title: '', summary: '' }, 'lawn-care')).toBe('market_insight');
    const types = watchTypes('lawn-care', 'atlanta-ga', NONE);
    expect(types).not.toContain('contract');
    expect(types).toEqual(expect.arrayContaining(['permit', 'violation']));
    expect(watchList('lawn-care', 'atlanta-ga', NONE)).not.toContain('federal contract awards');
    expect(watchList('lawn-care', 'atlanta-ga', NONE, 'es').join(' ')).not.toMatch(/contratos federales adjudicados/i);
  });
  it('no trade lists awards on a deployment without SAM.gov', () => {
    for (const trade of Object.keys(TRADE_SIGNALS)) expect(watchTypes(trade, null, NONE), trade).not.toContain('contract');
  });
  it('with SAM.gov on, open bids are alerts, so a trade NAICS reaches keeps the kind', () => {
    const tagged = Object.entries(TRADE_SIGNALS).filter(([, t]) => t.includes('contract')).map(([id]) => id);
    expect(tagged.length).toBeGreaterThan(0);
    expect(tagged.some((t) => watchTypes(t, null, SAM as never).includes('contract'))).toBe(true);
  });
  it('kinds decided by the record (a pick rule) or by a city feed are unchanged', () => {
    expect(watchTypes('roofing', 'atlanta-ga', NONE)).toEqual(expect.arrayContaining(['weather-alert', 'storm-report']));
  });
});
