import { describe, expect, it } from 'vitest';
import { CATEGORIES, CATEGORY_IDS, classifyText } from '@/lib/signals/categories';

describe('categories', () => {
  it('defines 32 unique categories with keywords', () => {
    expect(CATEGORIES.length).toBe(32);
    expect(new Set(CATEGORY_IDS).size).toBe(32);
    for (const c of CATEGORIES) {
      expect(c.keywords.length, c.id).toBeGreaterThanOrEqual(5);
      expect(c.label.length).toBeGreaterThan(2);
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

  it('respects word boundaries and returns nothing for unrelated text', () => {
    expect(classifyText('')).toEqual([]);
    expect(classifyText('Lovely weather today, going for a walk')).toEqual([]);
    expect(classifyText('the proofreading was great')).not.toContain('roofing');
  });
});
