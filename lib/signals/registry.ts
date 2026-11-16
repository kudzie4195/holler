import type { Adapter } from './types';
import { adapters as nws } from './adapters/nws';
import { adapters as spc } from './adapters/spc';
import { adapters as fema } from './adapters/fema';
import { adapters as usgs } from './adapters/usgs';
import { adapters as faa } from './adapters/faa';
import { adapters as socrata } from './adapters/socrata';
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
  ...usaspending,
  ...sam,
  ...ticketmaster,
  ...bluesky,
  ...websearch,
];

export function getAdapter(id: string): Adapter | undefined {
  return ALL_ADAPTERS.find((a) => a.id === id);
}
