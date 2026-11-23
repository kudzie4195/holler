// Round 15 integration (unit I, follow-up): the card prints a permit's job value once, so the summary shown on the card leaves out its
// "$N job value" part when the "Job value on the permit" line is shown. Display only; the stored summary is never rewritten.
import { describe, expect, it } from 'vitest';
import { summaryForCard } from '@/lib/signals/brief';
import { summaryWithoutValue } from '@/lib/signals/permit-value';

describe('summaryWithoutValue', () => {
  it.each([
    ['Residential Building | Alteration | $12,500 job value | 100 TEST ST', 'Residential Building | Alteration | 100 TEST ST'],
    ['$3,149 job value | 12 MAIN ST', '12 MAIN ST'],
    ['Repair | 12 MAIN ST | $1,000,000 job value', 'Repair | 12 MAIN ST'],
    ['Repair | $4,500.50 job value | 12 MAIN ST', 'Repair | 12 MAIN ST'],
  ])('%j -> %j', (raw, want) => expect(summaryWithoutValue(raw)).toBe(want));
  it('a summary that is only the value leaves nothing (null)', () => expect(summaryWithoutValue('$12,500 job value')).toBeNull());
  it('a summary without the part comes back identical', () => {
    for (const s of ['Residential Building | Alteration | 100 TEST ST', 'Roof replacement, job value to be set', '', 'About $12,500 job value in the text']) expect(summaryWithoutValue(s)).toBe(s);
  });
  it('null and undefined pass through', () => {
    expect(summaryWithoutValue(null)).toBeNull();
    expect(summaryWithoutValue(undefined)).toBeUndefined();
  });
});

describe('summaryForCard', () => {
  const permit = { source: 'arcgis-raleigh-permits', kind: 'permit', subtype: 'permit', title: 'Roof permit in Raleigh' };
  const withValue = 'Residential Building | Repair | $12,500 job value | 100 TEST ST';
  it('permit with a parsed value (from data.jobValue or from the summary): the part is left out', () => {
    expect(summaryForCard({ ...permit, summary: withValue, jobValue: 12500 })).toBe('Residential Building | Repair | 100 TEST ST');
    expect(summaryForCard({ ...permit, summary: withValue })).toBe('Residential Building | Repair | 100 TEST ST');
  });
  it('permit with no parsed value (placeholder $1, none): the summary is unchanged', () => {
    const placeholder = 'Residential Building | $1 job value | 100 TEST ST';
    expect(summaryForCard({ ...permit, summary: placeholder })).toBe(placeholder);
    expect(summaryForCard({ ...permit, summary: 'Residential Building | 100 TEST ST' })).toBe('Residential Building | 100 TEST ST');
  });
  it('a record that is not a permit keeps its summary, and a null summary stays null', () => {
    const t = { source: 'spc-hail', kind: 'storm', subtype: null, title: '1.50 inch hail reported near 2 ESE Longview, TX' };
    expect(summaryForCard({ ...t, summary: withValue })).toBe(withValue);
    expect(summaryForCard({ ...permit, summary: null })).toBeNull();
  });
});
