// A dataset on probation is never listed as live: not in enabledDatasets (capability and empty-feed coverage), not in feedCount (home),
// not in the guide data sources. The adapter built from a probation config carries Adapter.probation.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { buildSocrataAdapter } from '@/lib/signals/adapters/socrata';
import { enabledDatasets } from '@/lib/signals/capabilities';
import { feedCount } from '@/lib/seo/home-live';

vi.mock('server-only', () => ({}));

const base = SOCRATA_DATASETS.find((d) => d.verified && d.subtype === 'permit')!;
const probe = { ...base, id: 'socrata-probe-permits', probation: true };

afterEach(() => {
  const i = SOCRATA_DATASETS.indexOf(probe);
  if (i >= 0) SOCRATA_DATASETS.splice(i, 1);
  vi.resetModules();
});

describe('probation coverage', () => {
  it('buildSocrataAdapter carries the flag; a normal dataset does not', () => {
    expect(buildSocrataAdapter(probe).probation).toBe(true);
    expect('probation' in buildSocrataAdapter(base)).toBe(false);
  });

  it('enabledDatasets leaves a verified probation dataset out', () => {
    SOCRATA_DATASETS.push(probe);
    expect(enabledDatasets().some((d) => d.id === probe.id)).toBe(false);
    expect(enabledDatasets().some((d) => d.id === base.id)).toBe(true);
  });

  it('feedCount does not count a probation adapter', () => {
    const live = { id: 'socrata-x', kind: 'permit' as const, requiresEnv: [] };
    expect(feedCount([live, { ...live, id: 'socrata-y', probation: true }], {})).toBe(1);
  });

  it('guide data sources leave a probation dataset out', async () => {
    SOCRATA_DATASETS.push(probe);
    const { GUIDE_DATA_SPECS } = await import('@/lib/seo/guide-data');
    const all = Object.values(GUIDE_DATA_SPECS).flatMap((s) => s.sources);
    expect(all).not.toContain(probe.id);
    expect(all).toContain(base.id);
  });
});
