/**
 * Round 5 FIX-G: the USAspending internal id (externalId and url) must be a plain id.
 */
import { describe, expect, it } from 'vitest';
import { parseUsaSpending } from '@/lib/signals/adapters/usaspending';

const award = (id: string) => ({
  results: [{
    generated_internal_id: id, 'Award Amount': 84000, Description: 'ROOF REPAIR', NAICS: { code: '238160' },
    'Primary Place of Performance': { state_code: 'GA', city_name: 'ATLANTA', zip5: '30303' }, 'Last Modified Date': '2026-11-05',
  }],
});

describe('usaspending internal id', () => {
  it('an id that is not a plain id skips the row', () => {
    expect(parseUsaSpending(award('John Smith 312-555-0199'))).toEqual([]);
    expect(parseUsaSpending(award('x'.repeat(121)))).toEqual([]);
  });
  it('a normal generated id still yields one signal with the same externalId', () => {
    const out = parseUsaSpending(award('CONT_AWD_W912EF26P0042_9700_-NONE-_-NONE-'));
    expect(out).toHaveLength(1);
    expect(out[0].externalId).toBe('CONT_AWD_W912EF26P0042_9700_-NONE-_-NONE-');
  });
});
