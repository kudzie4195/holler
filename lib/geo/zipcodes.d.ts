declare module 'zipcodes' {
  export interface ZipRecord {
    zip: string;
    latitude: number;
    longitude: number;
    city: string;
    state: string;
    country: string;
  }
  export function lookup(zip: string | number): ZipRecord | undefined;
  export function lookupByName(city: string, state: string): ZipRecord[];
  /** Every record, keyed by ZIP (round 33: the hand-added bids read the town names from it). */
  export const codes: Record<string, ZipRecord>;
  const zipcodes: { lookup: typeof lookup; lookupByName: typeof lookupByName; codes: typeof codes };
  export default zipcodes;
}
