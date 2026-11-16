import { ALL_ADAPTERS } from '@/lib/signals/registry';

/**
 * Citation info per adapter id, taken from the real adapters in lib/signals/registry.ts ALL_ADAPTERS
 * (id, label, sourceUrl). Server-side only: the registry imports every adapter. Client components use
 * lib/signals/source-meta.ts (a static copy, kept in sync by tests/signals/core/source-meta.test.ts).
 * Unknown ids (for example rows written by a retired adapter) fall back to a prettified id with no home link;
 * the item's own URL is still linked.
 */
export interface SourceInfo {
  label: string;
  homeUrl?: string;
}

const SOURCES: Record<string, SourceInfo> = Object.fromEntries(
  ALL_ADAPTERS.map((a) => [a.id.toLowerCase(), { label: a.label, homeUrl: a.sourceUrl } satisfies SourceInfo]),
);

function prettify(id: string): string {
  return id
    .replace(/[_:-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function sourceInfo(sourceId: string): SourceInfo {
  const hit = SOURCES[(sourceId ?? '').toLowerCase()];
  if (hit) return hit;
  return { label: prettify(sourceId || 'public record') };
}

export const KNOWN_SOURCES: SourceInfo[] = Object.values(SOURCES);
