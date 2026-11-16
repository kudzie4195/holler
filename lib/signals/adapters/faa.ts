import { siteUrl } from '@/lib/env';
import type { Adapter, AdapterContext, Severity, SignalInput } from '../types';

/**
 * FAA National Airspace System status.
 * Endpoint: https://nasstatus.faa.gov/api/airport-status-information (XML).
 * Structure (sourced: sample fetched from the endpoint): <AIRPORT_STATUS_INFORMATION><Update_Time/>
 * <Delay_type><Name/> then one of Ground_Stop_List>Program{ARPT,Reason,End_Time},
 * Ground_Delay_List>Ground_Delay{ARPT,Reason,Avg,Max},
 * Arrival_Departure_Delay_List>Delay{ARPT,Reason,Arrival_Departure[Type]{Min,Max,Trend}},
 * Airport_Closure_List>Airport{ARPT,Reason,Start,Reopen}.
 */
export const FAA_URL = 'https://nasstatus.faa.gov/api/airport-status-information';

/** Top 40 US airports by traffic: code -> [lat, lon, city, state]. Coordinates are approximate (assumed, from public airport data). */
export const AIRPORTS: Record<string, { lat: number; lon: number; city: string; state: string; name: string }> = {
  ATL: { lat: 33.6407, lon: -84.4277, city: 'Atlanta', state: 'GA', name: 'Hartsfield-Jackson Atlanta' },
  LAX: { lat: 33.9416, lon: -118.4085, city: 'Los Angeles', state: 'CA', name: 'Los Angeles International' },
  ORD: { lat: 41.9742, lon: -87.9073, city: 'Chicago', state: 'IL', name: "Chicago O'Hare" },
  DFW: { lat: 32.8998, lon: -97.0403, city: 'Dallas', state: 'TX', name: 'Dallas/Fort Worth' },
  DEN: { lat: 39.8561, lon: -104.6737, city: 'Denver', state: 'CO', name: 'Denver International' },
  JFK: { lat: 40.6413, lon: -73.7781, city: 'New York', state: 'NY', name: 'New York JFK' },
  SFO: { lat: 37.6213, lon: -122.379, city: 'San Francisco', state: 'CA', name: 'San Francisco International' },
  SEA: { lat: 47.4502, lon: -122.3088, city: 'Seattle', state: 'WA', name: 'Seattle-Tacoma' },
  LAS: { lat: 36.084, lon: -115.1537, city: 'Las Vegas', state: 'NV', name: 'Harry Reid Las Vegas' },
  MCO: { lat: 28.4312, lon: -81.3081, city: 'Orlando', state: 'FL', name: 'Orlando International' },
  EWR: { lat: 40.6895, lon: -74.1745, city: 'Newark', state: 'NJ', name: 'Newark Liberty' },
  CLT: { lat: 35.214, lon: -80.9431, city: 'Charlotte', state: 'NC', name: 'Charlotte Douglas' },
  PHX: { lat: 33.4342, lon: -112.0116, city: 'Phoenix', state: 'AZ', name: 'Phoenix Sky Harbor' },
  IAH: { lat: 29.9902, lon: -95.3368, city: 'Houston', state: 'TX', name: 'Houston Bush Intercontinental' },
  MIA: { lat: 25.7959, lon: -80.287, city: 'Miami', state: 'FL', name: 'Miami International' },
  BOS: { lat: 42.3656, lon: -71.0096, city: 'Boston', state: 'MA', name: 'Boston Logan' },
  MSP: { lat: 44.8848, lon: -93.2223, city: 'Minneapolis', state: 'MN', name: 'Minneapolis-Saint Paul' },
  FLL: { lat: 26.0726, lon: -80.1527, city: 'Fort Lauderdale', state: 'FL', name: 'Fort Lauderdale-Hollywood' },
  DTW: { lat: 42.2162, lon: -83.3554, city: 'Detroit', state: 'MI', name: 'Detroit Metropolitan' },
  PHL: { lat: 39.8744, lon: -75.2424, city: 'Philadelphia', state: 'PA', name: 'Philadelphia International' },
  LGA: { lat: 40.7769, lon: -73.874, city: 'New York', state: 'NY', name: 'New York LaGuardia' },
  BWI: { lat: 39.1774, lon: -76.6684, city: 'Baltimore', state: 'MD', name: 'Baltimore/Washington' },
  SLC: { lat: 40.7899, lon: -111.9791, city: 'Salt Lake City', state: 'UT', name: 'Salt Lake City International' },
  SAN: { lat: 32.7338, lon: -117.1933, city: 'San Diego', state: 'CA', name: 'San Diego International' },
  IAD: { lat: 38.9531, lon: -77.4565, city: 'Washington', state: 'VA', name: 'Washington Dulles' },
  DCA: { lat: 38.8512, lon: -77.0402, city: 'Washington', state: 'VA', name: 'Reagan National' },
  MDW: { lat: 41.7868, lon: -87.7522, city: 'Chicago', state: 'IL', name: 'Chicago Midway' },
  TPA: { lat: 27.9755, lon: -82.5332, city: 'Tampa', state: 'FL', name: 'Tampa International' },
  HNL: { lat: 21.3187, lon: -157.9225, city: 'Honolulu', state: 'HI', name: 'Honolulu Daniel K. Inouye' },
  PDX: { lat: 45.5898, lon: -122.5951, city: 'Portland', state: 'OR', name: 'Portland International' },
  STL: { lat: 38.7487, lon: -90.37, city: 'St. Louis', state: 'MO', name: 'St. Louis Lambert' },
  BNA: { lat: 36.1245, lon: -86.6782, city: 'Nashville', state: 'TN', name: 'Nashville International' },
  AUS: { lat: 30.1975, lon: -97.6664, city: 'Austin', state: 'TX', name: 'Austin-Bergstrom' },
  DAL: { lat: 32.8471, lon: -96.8518, city: 'Dallas', state: 'TX', name: 'Dallas Love Field' },
  MSY: { lat: 29.9934, lon: -90.258, city: 'New Orleans', state: 'LA', name: 'New Orleans Armstrong' },
  OAK: { lat: 37.7213, lon: -122.2208, city: 'Oakland', state: 'CA', name: 'Oakland International' },
  SJC: { lat: 37.3639, lon: -121.9289, city: 'San Jose', state: 'CA', name: 'San Jose Mineta' },
  SMF: { lat: 38.6954, lon: -121.5908, city: 'Sacramento', state: 'CA', name: 'Sacramento International' },
  RDU: { lat: 35.8776, lon: -78.7875, city: 'Raleigh', state: 'NC', name: 'Raleigh-Durham' },
  HOU: { lat: 29.6454, lon: -95.2789, city: 'Houston', state: 'TX', name: 'Houston Hobby' },
};

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? decode(m[1].trim()) : null;
}

function decode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function blocks(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi'))].map((m) => m[1]);
}

/** "1 hour and 12 minutes" / "36 minutes" -> minutes */
export function durationMinutes(s: string | null): number | null {
  if (!s) return null;
  const h = /(\d+)\s*hour/i.exec(s);
  const m = /(\d+)\s*minute/i.exec(s);
  if (!h && !m) return null;
  return (h ? parseInt(h[1], 10) * 60 : 0) + (m ? parseInt(m[1], 10) : 0);
}

export function parseFaa(raw: unknown): SignalInput[] {
  const xml = typeof raw === 'string' ? raw : '';
  if (!xml.includes('AIRPORT_STATUS_INFORMATION')) return [];
  const updateRaw = tag(xml, 'Update_Time');
  const updated = updateRaw ? Date.parse(updateRaw) : NaN;
  const occurred = Number.isFinite(updated) ? new Date(updated) : new Date();
  const day = occurred.toISOString().slice(0, 10);
  const out: SignalInput[] = [];
  const seen = new Set<string>();

  function push(type: 'stop' | 'gdp' | 'delay' | 'closure', arpt: string | null, reason: string | null, severity: Severity, detail: string, extra: Record<string, unknown>) {
    const code = (arpt ?? '').trim().toUpperCase();
    const ap = AIRPORTS[code];
    if (!ap) return; // only major airports
    const why = (reason ?? 'unspecified').replace(/\s+/g, ' ').trim();
    const id = type === 'closure' ? `closure:${code}:${String(extra.start ?? day)}` : `${type}:${code}:${day}:${why.toLowerCase().slice(0, 40)}`;
    if (seen.has(id)) return;
    seen.add(id);
    const label = type === 'stop' ? 'Ground stop' : type === 'gdp' ? 'Ground delay program' : type === 'closure' ? 'Airport closure' : 'Flight delays';
    out.push({
      source: 'faa',
      externalId: id,
      kind: 'travel',
      title: `${label} at ${ap.name} (${code})`,
      summary: `${label} at ${code}, ${ap.city}: ${why}${detail ? `. ${detail}` : ''}.`,
      url: 'https://nasstatus.faa.gov/',
      lat: ap.lat,
      lon: ap.lon,
      city: ap.city,
      state: ap.state,
      categories: ['rideshare-delivery'],
      severity,
      occurredAt: occurred.toISOString(),
      expiresAt: new Date(occurred.getTime() + 3 * 3600_000).toISOString(),
      data: { airport: code, type, reason: why, ...extra },
    });
  }

  for (const b of blocks(xml, 'Program')) {
    const end = tag(b, 'End_Time');
    push('stop', tag(b, 'ARPT'), tag(b, 'Reason'), 3, end ? `Expected to end ${end}` : '', { endTime: end });
  }
  for (const b of blocks(xml, 'Ground_Delay')) {
    const avg = tag(b, 'Avg');
    const max = tag(b, 'Max');
    const avgMin = durationMinutes(avg);
    push('gdp', tag(b, 'ARPT'), tag(b, 'Reason'), avgMin !== null && avgMin >= 60 ? 3 : 2, avg ? `Average delay ${avg}${max ? `, up to ${max}` : ''}` : '', { avg, max });
  }
  for (const b of blocks(xml, 'Delay')) {
    const maxStr = tag(b, 'Max');
    const maxMin = durationMinutes(maxStr);
    if (maxMin === null || maxMin < 45) continue;
    push('delay', tag(b, 'ARPT'), tag(b, 'Reason'), maxMin >= 90 ? 2 : 1, `Delays up to ${maxStr}`, { max: maxStr, trend: tag(b, 'Trend') });
  }
  for (const b of blocks(xml, 'Airport')) {
    push('closure', tag(b, 'ARPT'), 'closure notice', 2, '', { start: tag(b, 'Start'), reopen: tag(b, 'Reopen') });
  }
  return out;
}

export const faaAdapter: Adapter = {
  id: 'faa',
  label: 'FAA airport status',
  kind: 'travel',
  cadenceMinutes: 15,
  sourceUrl: 'https://nasstatus.faa.gov/',
  async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
    try {
      const res = await ctx.fetch(FAA_URL, {
        headers: { 'User-Agent': `Holler/1.0 (+${siteUrl}/about; contact@holler)`, Accept: 'application/xml, text/xml' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseFaa(await res.text());
    } catch (e) {
      ctx.log(`error: faa fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  },
};

export const adapters: Adapter[] = [faaAdapter];
