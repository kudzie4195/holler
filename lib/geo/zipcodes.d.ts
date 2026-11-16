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
  const zipcodes: { lookup: typeof lookup };
  export default zipcodes;
}
