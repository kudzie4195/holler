import { describe, expect, it } from 'vitest';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { SOURCE_META } from '@/lib/signals/source-meta';

describe('SOURCE_META', () => {
  it('has an entry for every ALL_ADAPTERS id, with matching label and sourceUrl', () => {
    expect(ALL_ADAPTERS.length).toBeGreaterThan(0);
    for (const a of ALL_ADAPTERS) {
      const m = SOURCE_META[a.id];
      expect(m, `missing source-meta entry for ${a.id}`).toBeDefined();
      expect(m.label).toBe(a.label);
      expect(m.sourceUrl).toBe(a.sourceUrl);
    }
  });

  it('has no stale entries', () => {
    const ids = new Set(ALL_ADAPTERS.map((a) => a.id));
    for (const id of Object.keys(SOURCE_META)) expect(ids.has(id), `stale entry ${id}`).toBe(true);
  });
});
