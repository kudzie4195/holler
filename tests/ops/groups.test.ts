import { describe, expect, it } from 'vitest';
import { groupCategories, GROUP_ORDER } from '../../components/profile-form-groups';

const c = (id: string, group?: string) => ({ id, label: id, group });

describe('groupCategories', () => {
  it('falls back to one untitled group when no category has a group (the field is not there yet)', () => {
    const g = groupCategories([c('roofing'), c('hvac')]);
    expect(g).toHaveLength(1);
    expect(g[0].label).toBeNull();
    expect(g[0].items.map((x) => x.id)).toEqual(['roofing', 'hvac']);
  });
  it('groups in the fixed display order, keeping category order inside a group', () => {
    const g = groupCategories([c('towing', 'auto'), c('roofing', 'home'), c('hvac', 'home'), c('catering', 'food-events'), c('insurance', 'business'), c('storm-x', 'storm')]);
    expect(g.map((x) => x.key)).toEqual(['home', 'storm', 'auto', 'business', 'food-events']);
    expect(g[0].items.map((x) => x.id)).toEqual(['roofing', 'hvac']);
    expect(g.every((x) => x.label)).toBe(true);
  });
  it('puts a missing or unknown group into other', () => {
    const g = groupCategories([c('roofing', 'home'), c('weird', 'made-up'), c('nogroup')]);
    expect(g.map((x) => x.key)).toEqual(['home', 'other']);
    expect(g[1].items.map((x) => x.id)).toEqual(['weird', 'nogroup']);
  });
  it('never drops or duplicates a category', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => c(id, GROUP_ORDER[i % GROUP_ORDER.length].key));
    expect(groupCategories(input).flatMap((x) => x.items).map((x) => x.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
  it('shows no heading when everything lands in one group', () => {
    const g = groupCategories([c('a', 'home'), c('b', 'home')]);
    expect(g).toHaveLength(1);
    expect(g[0].label).toBeNull();
  });
  it('covers every group id the contract defines', () => {
    // Round 23: 'marketed' is first. It is not a CATEGORY_GROUPS value; it exists only to put the trades Holler is marketed for
    // (lib/plan/profile-categories.ts MARKETED_TRADES) at the top of the sign-up form, above a "More trades" disclosure.
    expect(GROUP_ORDER.map((x) => x.key)).toEqual(['marketed', 'home', 'storm', 'auto', 'business', 'food-events', 'other']);
  });
});
