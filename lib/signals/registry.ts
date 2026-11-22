import type { Adapter } from './types';
import { adapters as nws } from './adapters/nws';
import { adapters as spc } from './adapters/spc';
import { adapters as fema } from './adapters/fema';
import { adapters as usgs } from './adapters/usgs';
import { adapters as faa } from './adapters/faa';
import { adapters as socrata } from './adapters/socrata';
import { adapters as carto } from './adapters/carto';
import { adapters as nycHpdAgents } from './adapters/nyc-hpd-agents';
import { adapters as arcgis } from './adapters/arcgis';
import { adapters as arcgisJohnsCreek } from './adapters/arcgis-johnscreek';
import { adapters as arcgisCobb, COBB_SOURCE_IDS } from './adapters/arcgis-cobb';
import { adapters as usaspending } from './adapters/usaspending';
import { adapters as sam } from './adapters/sam';
import { adapters as ticketmaster } from './adapters/ticketmaster';
import { adapters as bluesky } from './adapters/bluesky';
import { adapters as websearch } from './adapters/websearch';

export const ALL_ADAPTERS: Adapter[] = [
  ...nws,
  ...spc,
  ...fema,
  ...usgs,
  ...faa,
  ...socrata,
  // Philadelphia (Carto SQL API): every adapter here is on probation (samples only, never members).
  ...carto,
  // PROBATION: NYC heat complaints + HPD managing-agent company; rows go to holler_source_samples only (see the file).
  ...nycHpdAgents,
  // The Cobb permit layers are built by arcgis-cobb.ts (approximate location marker), so the shared list skips them.
  ...arcgis.filter((a) => !COBB_SOURCE_IDS.includes(a.id)),
  ...arcgisCobb,
  ...arcgisJohnsCreek,
  ...usaspending,
  ...sam,
  ...ticketmaster,
  ...bluesky,
  ...websearch,
];

export function getAdapter(id: string): Adapter | undefined {
  return ALL_ADAPTERS.find((a) => a.id === id);
}
