import { cityPath, nearestCity } from '@/lib/geo';

/** Public city page for a coordinate (W4's cityPath), or null when no city is within 40 miles. */
export function cityPageFor(lat: number | null, lon: number | null): { href: string; label: string } | null {
  if (lat == null || lon == null) return null;
  const city = nearestCity(lat, lon);
  if (!city) return null;
  return { href: cityPath(city), label: `${city.name}, ${city.state}` };
}
