/**
 * Local storm dates use ONE IANA time zone per state: the zone that covers most of the state's people. A storm that runs
 * 11 PM to 1 AM local is therefore split across two local dates (and two pages), the same way a calendar does it. States that
 * span two zones (TX, TN, KY, FL, IN, MI, KS, NE, SD, ND, OR, ID) use the main zone for the whole state, which can put a
 * report from the minority zone on the neighbouring date near midnight. Daylight saving is handled by Intl, not by a fixed offset.
 */
export const STATE_ZONES: Record<string, string> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago', CA: 'America/Los_Angeles',
  CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York', DC: 'America/New_York', FL: 'America/New_York',
  GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Denver', IL: 'America/Chicago', IN: 'America/New_York',
  IA: 'America/Chicago', KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/New_York', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago', NV: 'America/Los_Angeles', NH: 'America/New_York',
  NJ: 'America/New_York', NM: 'America/Denver', NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago',
  OH: 'America/New_York', OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago', UT: 'America/Denver',
  VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York', WI: 'America/Chicago',
  WY: 'America/Denver',
};

export function zoneFor(state: string): string | null {
  return STATE_ZONES[state.toUpperCase()] ?? null;
}

const dateFmt = new Map<string, Intl.DateTimeFormat>();
const timeFmt = new Map<string, Intl.DateTimeFormat>();

/** YYYY-MM-DD of an instant in the given zone. */
export function localDate(iso: string | Date, zone: string): string | null {
  const t = typeof iso === 'string' ? Date.parse(iso) : iso.getTime();
  if (!Number.isFinite(t)) return null;
  let f = dateFmt.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dateFmt.set(zone, f);
  }
  const parts = f.formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const out = `${get('year')}-${get('month')}-${get('day')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
}

/** "3:12 PM EST" in the given zone. */
export function localTime(iso: string, zone: string): string {
  let f = timeFmt.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    timeFmt.set(zone, f);
  }
  return f.format(new Date(iso));
}

/** "November 14, 2026" from YYYY-MM-DD (no zone maths: the date is already a calendar date). */
export function longDate(ymd: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${ymd}T12:00:00Z`));
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
