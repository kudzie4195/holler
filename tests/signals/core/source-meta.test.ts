import { describe, expect, it } from 'vitest';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { NON_ADAPTER_SOURCES, SOURCE_META, getSourceMeta } from '@/lib/signals/source-meta';
import { REQUEST_SOURCE } from '@/lib/requests/constants';

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
    const ids = new Set<string>([...ALL_ADAPTERS.map((a) => a.id), ...NON_ADAPTER_SOURCES]);
    for (const id of Object.keys(SOURCE_META)) expect(ids.has(id), `stale entry ${id}`).toBe(true);
  });

  it('labels resident requests made on Holler and links to /request (no social site, no "asking online")', () => {
    const m = getSourceMeta(REQUEST_SOURCE);
    expect(m).toEqual({ id: 'holler-request', label: 'Requests made on Holler', sourceUrl: '/request' });
    expect(m!.label).not.toMatch(/online|bluesky|web search|post/i);
    expect(ALL_ADAPTERS.some((a) => a.id === REQUEST_SOURCE)).toBe(false);
  });
});
