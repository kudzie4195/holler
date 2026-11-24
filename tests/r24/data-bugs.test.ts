// Round 24 (decision l): two small data bugs from the cells report, fixed only because the alert-rule replay stayed identical
// (npm run replay:rules: 4,985 / 3,949 / 9.0 / 21.1, RESULT PASS, per-row output byte-identical to the r19 baseline).
import { describe, expect, it } from 'vitest';
import { callPathOfRow } from '@/lib/signals/trade-coverage';
import { textShowsPlace } from '@/lib/signals/alert-gate';
import { windDamageLevel } from '@/lib/signals/carry';

describe('"Interstate 405" is not a house number (SPC row 71579)', () => {
  const spc = 'A large tree branch was blown down on Interstate 405 near Cherry Avenue. (LOX)';
  it('the address gate does not count it as a place', () => {
    expect(textShowsPlace(spc)).toBe(false);
    for (const t of ['Tree down on Highway 101 near Main Street', 'Debris on I 95 near Oak Avenue', 'Crash on Route 9 near Elm St', 'Wires down on US 1 near Pine Rd']) {
      expect(textShowsPlace(t), t).toBe(false);
    }
  });
  it('callPathOfRow gives it no exact call path', () => {
    expect(callPathOfRow({ source: 'spc', summary: spc }, () => false)).toBeNull();
  });
  it('real addresses still count', () => {
    for (const t of ['One Atlantic Center 1201 W Peachtree St', '1800 BATH AVENUE', 'Tree down at 405 Cherry Avenue', 'Peachtree Center, 225 Peachtree St']) {
      expect(textShowsPlace(t), t).toBe(true);
    }
    expect(callPathOfRow({ source: 'x', summary: 'Re-roof | 405 Cherry Avenue' }, () => false)).toBe('exact');
  });
});

describe('"roof" never matches inside "proof"', () => {
  it('a waterproofing or fireproof remark is not roof work', () => {
    expect(windDamageLevel('WATERPROOF tarp blown off a fence', 'roofing')).toBe('coming_soon');
    expect(windDamageLevel('Fireproof storage shed door torn', 'tree-service')).toBe('coming_soon');
  });
  it('a roof, a reroof and shingles still are', () => {
    expect(windDamageLevel('Roof blown off a barn', 'roofing')).toBe('act_now');
    expect(windDamageLevel('Reroof needed after shingles torn', 'roofing')).toBe('act_now');
    expect(windDamageLevel('roof damage reported', 'restoration')).toBe('act_now');
  });
});
