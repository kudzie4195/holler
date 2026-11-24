import table from './county-centroids.json';

/**
 * County centroids for placing county-level weather alerts. The table (county-centroids.json) is computed from the US Census Bureau
 * cartographic county boundaries; see its `_source` field. Pure data lookup: no network, no clock.
 */
const CENTROIDS = (table as unknown as { c: Record<string, [number, number]> }).c;

/** 2-digit state FIPS to USPS code (the 50 states, DC and Puerto Rico: the land areas NWS issues county alerts for). */
export const STATE_BY_FIPS: Readonly<Record<string, string>> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI',
  '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY', '72': 'PR',
};

export interface County {
  /** 5-digit county FIPS (state + county). */
  fips: string;
  state: string;
  lat: number;
  lon: number;
}

/**
 * The county a NWS SAME code names. SAME is six digits: one subdivision digit then the 5-digit county FIPS ("013121" is Fulton, GA).
 * A code that is not a land county in the table (a marine zone, a code the table lacks) gives null.
 */
export function countyFromSame(same: unknown): County | null {
  if (typeof same !== 'string' || !/^\d{6}$/.test(same)) return null;
  const fips = same.slice(1);
  const c = CENTROIDS[fips];
  const state = STATE_BY_FIPS[fips.slice(0, 2)];
  if (!c || !state) return null;
  return { fips, state, lat: c[0], lon: c[1] };
}

/** Distinct counties for a list of SAME codes, in the order given. */
export function countiesFromSame(codes: unknown): County[] {
  if (!Array.isArray(codes)) return [];
  const out: County[] = [];
  for (const code of codes) {
    const c = countyFromSame(code);
    if (c && !out.some((x) => x.fips === c.fips)) out.push(c);
  }
  return out;
}

/** USPS code to 2-digit state FIPS (the inverse of STATE_BY_FIPS). */
const FIPS_BY_STATE: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(STATE_BY_FIPS).map(([f, st]) => [st, f]));

/**
 * Round 25: the county a NWS UGC COUNTY code names. A UGC code is two state letters, a format letter and three digits: "C" codes are
 * counties, and the three digits are the county's FIPS number inside the state ("SDC003" is Aurora County, SD = 46003). "Z" codes are
 * forecast or fire weather zones, which are not counties and give null here (placing a zone needs the NWS zone-county table).
 */
export function countyFromUgc(ugc: unknown): County | null {
  const m = typeof ugc === 'string' ? /^([A-Z]{2})C(\d{3})$/.exec(ugc) : null;
  const stateFips = m ? FIPS_BY_STATE[m[1]] : undefined;
  if (!m || !stateFips) return null;
  return countyFromSame(`0${stateFips}${m[2]}`);
}

/** Distinct counties for a list of UGC codes (county codes only), in the order given. */
export function countiesFromUgc(codes: unknown): County[] {
  if (!Array.isArray(codes)) return [];
  const out: County[] = [];
  for (const code of codes) {
    const c = countyFromUgc(code);
    if (c && !out.some((x) => x.fips === c.fips)) out.push(c);
  }
  return out;
}
