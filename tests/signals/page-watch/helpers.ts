import { pageWatchDataset, type PageWatchDataset } from '@/lib/signals/adapters/page-watch-datasets';

/**
 * A dataset as it would look once the owner has read its robots.txt and terms and recorded them (round 20 review P0): every shipped entry
 * has termsChecked false, so tests that exercise fetching use this copy. Bonfire copies also record the vendor's permission for the endpoint.
 */
export function cleared(id: string, over: Partial<PageWatchDataset> = {}): PageWatchDataset {
  const d = pageWatchDataset(id);
  if (!d) throw new Error(`unknown page-watch id ${id}`);
  return {
    ...d,
    termsChecked: true,
    verified: true,
    evidence: {
      ...d.evidence,
      robotsUrl: `https://${new URL(d.url).hostname}/robots.txt`,
      termsUrl: `https://${new URL(d.pageUrl).hostname}/terms-of-use`,
      checkedOn: '2026-11-23',
      ...(d.parser === 'bonfire' ? { endpointAllowed: true } : {}),
    },
    ...over,
  };
}

/** The master switch on. */
export const SWITCH_ON = { HOLLER_PAGE_WATCH_ENABLED: '1' } as const;
