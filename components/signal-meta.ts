import type { SignalKind } from '@/lib/signals/types';

/** Plain-language label for each signal kind (shown on badges and filters). */
export const KIND_LABEL: Record<SignalKind, string> = {
  ask: 'Someone asking',
  alert: 'Weather alert',
  report: 'Storm report',
  permit: 'Permit',
  civic: '311 or inspection',
  contract: 'Federal contract',
  event: 'Event',
  disaster: 'Disaster',
  quake: 'Earthquake',
  travel: 'Airport delay',
};

/**
 * Human labels for source ids. Source ids come from the adapters; anything not
 * listed falls back to a tidied version of the id (see sourceLabel).
 * ASSUMED ids: nws, spc, fema, usgs, faa, socrata, usaspending, sam, ticketmaster, bluesky, websearch.
 */
const SOURCE_LABEL: Record<string, string> = {
  nws: 'National Weather Service',
  spc: 'NOAA Storm Prediction Center',
  fema: 'FEMA',
  usgs: 'USGS',
  faa: 'FAA',
  socrata: 'City open data',
  usaspending: 'USAspending.gov',
  sam: 'SAM.gov',
  ticketmaster: 'Ticketmaster',
  bluesky: 'Bluesky',
  websearch: 'Web search',
};

export function sourceLabel(source: string): string {
  const key = source.toLowerCase();
  if (SOURCE_LABEL[key]) return SOURCE_LABEL[key];
  const prefix = key.split(/[:/_-]/)[0];
  if (SOURCE_LABEL[prefix]) return SOURCE_LABEL[prefix];
  return source.replace(/[_-]+/g, ' ');
}

export function isKnownKind(kind: string): kind is SignalKind {
  return kind in KIND_LABEL;
}

export function kindLabel(kind: string): string {
  return isKnownKind(kind) ? KIND_LABEL[kind] : 'Signal';
}
