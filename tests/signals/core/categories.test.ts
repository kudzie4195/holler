import { describe, expect, it } from 'vitest';
import { CATEGORIES, CATEGORY_IDS, classifyText } from '@/lib/signals/categories';

describe('categories', () => {
  it('defines 41 unique categories with keywords and a group', () => {
    expect(CATEGORIES.length).toBe(41);
    expect(new Set(CATEGORY_IDS).size).toBe(41);
    for (const c of CATEGORIES) {
      expect(c.keywords.length, c.id).toBeGreaterThanOrEqual(5);
      expect(c.label.length).toBeGreaterThan(2);
      expect(['home', 'storm', 'auto', 'business', 'food-events', 'other'], c.id).toContain(c.group);
    }
  });

  it('classifies asks into trades', () => {
    expect(classifyText('Anyone recommend a good roofer near Marietta? Had hail damage')).toEqual(expect.arrayContaining(['roofing']));
    expect(classifyText('Need a plumber, burst pipe in the basement')).toContain('plumbing');
    expect(classifyText('Looking for an electrician for a panel upgrade')).toContain('electrical');
    expect(classifyText('who plows snow in Ottawa? need snow removal')).toContain('snow-removal');
    expect(classifyText('Any good food trucks for a wedding?')).toEqual(expect.arrayContaining(['food-truck', 'event-services']));
    expect(classifyText('my windshield cracked from a rock chip')).toContain('auto-glass');
  });

  it('classifies the round 2 trades', () => {
    const cases: [string, string][] = [
      ['Need a fence company for a privacy fence', 'fencing'],
      ['Who does stamped concrete and driveway paving?', 'concrete-paving'],
      ['Looking for window replacement quotes', 'windows-doors'],
      ['Gutter cleaning and new downspouts', 'siding-gutters'],
      ['Hardwood floors refinishing near me', 'flooring'],
      ['Any good handyman for small repairs?', 'handyman'],
      ['Need vinyl banners and yard signs printed', 'signs-printing'],
      ['Looking for a bookkeeper and payroll help', 'business-services'],
      ['Claim denied, need a public adjuster', 'public-adjuster'],
    ];
    for (const [text, id] of cases) expect(classifyText(text), text).toContain(id);
  });

  it('respects word boundaries and returns nothing for unrelated text', () => {
    expect(classifyText('')).toEqual([]);
    expect(classifyText('Lovely weather today, going for a walk')).toEqual([]);
    expect(classifyText('the proofreading was great')).not.toContain('roofing');
  });
});
