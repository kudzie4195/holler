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
  const zipcodes: { lookup: typeof lookup; lookupByName: typeof lookupByName };
  export default zipcodes;
}
