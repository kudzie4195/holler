// Builds store/.gen/map.json for the store screenshots (shot 1) and the round 11 direction studies: the web site's radius map (lib/seo/home-map.ts
// pickMapRecords + homeMapFrom, the same rules the home page runs) applied to the real rows in fixtures/real-signals.json around a
// member's ZIP, plus each picked record's true compass bearing from that ZIP (lib/geo lookupZip). Nothing is typed by hand.
// Run from mobile/: node store/map-data.mjs (build-captures.sh does)
import { build } from 'vite';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const store = here;
const repo = path.resolve(store, '../..');
const out = path.join(store, '.gen');
mkdirSync(out, { recursive: true });

await build({
  configFile: false,
  logLevel: 'warn',
  root: repo,
  resolve: {
    alias: [
      { find: 'next/cache', replacement: path.join(here, 'shims/next-cache.ts') },
      { find: /^\.\/client$/, replacement: path.join(here, 'shims/seo-client.ts') },
      { find: '@', replacement: repo },
    ],
  },
  build: { ssr: path.join(here, 'map-entry.ts'), outDir: path.join(out, 'map-bundle'), emptyOutDir: true, minify: false, rollupOptions: { output: { entryFileNames: 'map-entry.mjs', format: 'es' } } },
  ssr: { noExternal: true },
});
const h = await import(pathToFileURL(path.join(out, 'map-bundle', 'map-entry.mjs')).href);
const fx = JSON.parse(readFileSync(path.join(store, 'fixtures/real-signals.json'), 'utf8'));
const iso = (s) => (s == null ? null : new Date(s.replace(' ', 'T').replace(/\+00$/, '+00:00')).toISOString());
const rows = fx.rows.map((r) => ({ ...r, occurred_at: iso(r.occurred_at), expires_at: iso(r.expires_at) }));
// The rows were read from production on 2026-11-19 (fixture _note). The map's "last 7 days" window is taken from that day, the day
// the site would have drawn them; the map's own date rule is unchanged.
const READ_AT = Date.parse(process.env.MAP_NOW || '2026-11-19T12:00:00Z');

function bearing(a, b) {
  const r = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360; // degrees clockwise from north
}

const result = { readAt: new Date(READ_AT).toISOString(), rings: [...h.RING_MILES], ringFraction: h.RING_FRACTION, maxMi: h.MAP_RADIUS_MI, maps: {} };
for (const zip of ['60614']) {
  const c = h.lookupZip(zip);
  const picked = h.pickMapRecords(rows, c, READ_AT, zip);
  const map = h.homeMapFrom(picked, c.city, zip);
  if (!map) throw new Error(`${zip}: too few records for the map`);
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  result.maps[zip] = {
    zip, city: c.city, state: c.state, centre: { lat: c.lat, lon: c.lon },
    records: map.records.map((r, i) => {
      const row = byId.get(r.id);
      // appText: the label with the distance written the app's way (components/format.ts formatDistance: one decimal, '.0' dropped)
      const appText = `${r.label} ${h.formatDistance(r.mi).replace(/ away$/, '').toUpperCase()}`;
      return { ...r, text: h.dotText(r), appText, placed: map.placed[i], bearing: bearing(c, row), haversine: h.haversineMi(c.lat, c.lon, row.lat, row.lon) };
    }),
  };
}
// Every real row with a point, its distance and bearing from each scenario ZIP, and whether the server's matchOne sends it to that
// scenario's member (for maps drawn around a member, e.g. the storm crop around 33301).
result.points = {};
for (const [name, sc] of Object.entries(fx.scenarios)) {
  const c = h.lookupZip(sc.zip);
  const member = { user_id: `capture-${name}`, categories: sc.trades, lat: c.lat, lon: c.lon, state: c.state, radius_mi: sc.radiusMi, plan: 'starter', subscription_status: 'active', extra_areas: [], keywords: [] };
  result.points[name] = { zip: sc.zip, centre: { lat: c.lat, lon: c.lon }, radiusMi: sc.radiusMi, rows: rows.filter((r) => typeof r.lat === 'number').map((r) => {
    const hit = h.matchOne({ ...r, data: { subtype: r.subtype } }, member);
    return { id: r.id, kind: r.kind, family: h.familyOf(r.kind), title: r.title, label: h.mapLabel(r.title), mi: Math.round(h.haversineMi(c.lat, c.lon, r.lat, r.lon) * 10) / 10,
      bearing: bearing(c, r), matched: !!hit, matchMi: hit ? hit.distance_mi : null };
  }).filter((p) => p.mi <= 20) };
}
writeFileSync(path.join(out, 'map.json'), JSON.stringify(result, null, 1));
for (const [z, m] of Object.entries(result.maps)) for (const r of m.records) console.log(z, r.id, r.family, r.text, 'bearing', Math.round(r.bearing), 'deg', r.placed.deg, r.placed.side);
for (const [n, p] of Object.entries(result.points)) console.log(n, p.zip, p.rows.map((r) => `${r.id}:${r.label}:${r.mi}${r.matched ? '*' + r.matchMi : ''}`).join(' | '));
