import type { Adapter } from './types';
import { adapters as nws } from './adapters/nws';
import { adapters as spc } from './adapters/spc';
import { adapters as fema } from './adapters/fema';
import { adapters as usgs } from './adapters/usgs';
import { adapters as faa } from './adapters/faa';
import { adapters as socrata } from './adapters/socrata';
import { adapters as carto } from './adapters/carto';
import { adapters as nycHeat } from './adapters/nyc-hpd';
import { adapters as arcgis } from './adapters/arcgis';
import { adapters as arcgisJohnsCreek } from './adapters/arcgis-johnscreek';
import { adapters as arcgisCobb, COBB_SOURCE_IDS } from './adapters/arcgis-cobb';
import { adapters as usaspending } from './adapters/usaspending';
import { adapters as sam } from './adapters/sam';
import { adapters as cityBids } from './adapters/city-bids';
import { adapters as localBids } from './adapters/bids-local';
import { adapters as ticketmaster } from './adapters/ticketmaster';
import { adapters as bluesky } from './adapters/bluesky';
import { adapters as websearch } from './adapters/websearch';
import { adapters as houstonPermits } from './adapters/houston-permits';

export const ALL_ADAPTERS: Adapter[] = [
  ...nws,
  ...spc,
  ...fema,
  ...usgs,
  ...faa,
  // NYC 311 is built by nyc-hpd.ts (same scan, plus the HPD managing-agent company on heat rows), so it replaces the shared one in place.
  ...socrata.map((a) => nycHeat.find((n) => n.id === a.id) ?? a),
  // Philadelphia (Carto SQL API): every adapter here is on probation (samples only in holler_source_samples, never members).
  ...carto,
  // The Cobb permit layers are built by arcgis-cobb.ts (approximate location marker), so the shared list skips them.
  ...arcgis.filter((a) => !COBB_SOURCE_IDS.includes(a.id)),
  ...arcgisCobb,
  ...arcgisJohnsCreek,
  // Round 20 NEXT: the Houston weekly permit activity report (HTML table), on probation.
  ...houstonPermits,
  ...usaspending,
  ...sam,
  // City open bids: registered, but off unless HOLLER_BIDS_ENABLED is on (lib/signals/bid-sources.ts).
  ...cityBids,
  // Atlanta-area county and city bid pages read with Firecrawl: on only with HOLLER_BIDS_ENABLED and FIRECRAWL_API_KEY both set.
  ...localBids,
  ...ticketmaster,
  ...bluesky,
  ...websearch,
];

export function getAdapter(id: string): Adapter | undefined {
  return ALL_ADAPTERS.find((a) => a.id === id);
}
