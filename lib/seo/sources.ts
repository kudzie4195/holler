/**
 * Citation info per adapter id. This is a LOCAL map. lib/signals/registry.ts now exists but imports W3 adapter files that were
 * still missing, so importing it would break tsc and the build. Labels and URLs for nws, spc, fema, usgs
 * and faa are copied from those adapters' `label` and `sourceUrl` (sourced). The W3 ids
 * (socrata, usaspending, sam, ticketmaster, bluesky, websearch) are assumed. Unknown ids fall back to a prettified id with no home link (the item URL is still linked).
 * Ids with a suffix (for example "socrata:atlanta-311" or "socrata-nyc") resolve by prefix.
 */
export interface SourceInfo {
  label: string;
  homeUrl?: string;
}

const SOURCES: Record<string, SourceInfo> = {
  nws: { label: 'National Weather Service alerts', homeUrl: 'https://www.weather.gov/alerts' },
  spc: { label: 'NOAA Storm Prediction Center storm reports', homeUrl: 'https://www.spc.noaa.gov/climo/reports/' },
  fema: { label: 'FEMA disaster declarations', homeUrl: 'https://www.fema.gov/disaster/declarations' },
  usgs: { label: 'USGS earthquakes', homeUrl: 'https://earthquake.usgs.gov/earthquakes/map/' },
  faa: { label: 'FAA airport status', homeUrl: 'https://nasstatus.faa.gov/' },
  socrata: { label: 'City open data portal' },
  usaspending: { label: 'USAspending.gov', homeUrl: 'https://www.usaspending.gov/' },
  sam: { label: 'SAM.gov', homeUrl: 'https://sam.gov/' },
  ticketmaster: { label: 'Ticketmaster Discovery API', homeUrl: 'https://developer.ticketmaster.com/' },
  bluesky: { label: 'Bluesky public posts', homeUrl: 'https://bsky.app/' },
  websearch: { label: 'Public web search' },
};

function prettify(id: string): string {
  return id
    .replace(/[_:-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function sourceInfo(sourceId: string): SourceInfo {
  const id = (sourceId ?? '').toLowerCase();
  if (SOURCES[id]) return SOURCES[id];
  const prefix = id.split(/[:_-]/)[0];
  if (prefix && SOURCES[prefix]) return SOURCES[prefix];
  return { label: prettify(sourceId || 'public record') };
}

export const KNOWN_SOURCES: SourceInfo[] = Object.values(SOURCES);
