// Builds .gen/data.json (feeds, config, me) from fixtures/real-signals.json, reusing the server's own mapping helpers
// (intent, source meta, formatDistance, categories, public prices). Run: node store/build-data.mjs
import { build } from 'vite';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const out = path.join(here, '.gen');
mkdirSync(out, { recursive: true });

await build({
  configFile: false,
  logLevel: 'warn',
  root: repo,
  resolve: { alias: { '@': repo } },
  build: { ssr: path.join(here, 'data-entry.ts'), outDir: path.join(out, 'bundle'), emptyOutDir: true, minify: false, rollupOptions: { output: { entryFileNames: 'data-entry.mjs', format: 'es' } } },
  ssr: { noExternal: true },
});
const h = await import(pathToFileURL(path.join(out, 'bundle', 'data-entry.mjs')).href);

const fx = JSON.parse(readFileSync(path.join(here, 'fixtures/real-signals.json'), 'utf8'));
const P = fx.point_60614;
const toIso = (s) => (s == null ? null : new Date(s.replace(' ', 'T').replace(/\+00$/, '+00:00')).toISOString());

function haversineMi(lat1, lon1, lat2, lon2) {
  const R = 3958.7613, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Same shape as lib/mobile/feed.ts buildAlerts() for a member with access, no contacts, no feedback, no draft.
function alertDto(r, matchId) {
  const meta = h.getSourceMeta(r.source);
  const intentIn = { kind: r.kind, subtype: r.subtype ?? null, source: r.source };
  // Distance only where the row has a point AND it is in the Chicago area; national NWS rows get none (a Chicago ZIP is not near them).
  const chicago = r.source.startsWith('socrata-chicago');
  const distanceMi = chicago && r.lat != null && r.lon != null ? Math.round(haversineMi(P.lat, P.lon, r.lat, r.lon) * 10) / 10 : null;
  const raw = chicago && r.lat != null ? haversineMi(P.lat, P.lon, r.lat, r.lon) : null;
  return {
    matchId, signalId: r.id, matchedAt: toIso(r.created_at), status: 'new', kind: r.kind, source: r.source,
    sourceLabel: meta?.label ?? null, sourceUrl: meta?.sourceUrl ?? null, title: r.title, summary: r.summary, url: r.url,
    city: r.city, state: r.state, county: r.county, zip: r.zip, place: [r.city, r.state].filter(Boolean).join(', ') || null,
    occurredAt: toIso(r.occurred_at), expiresAt: toIso(r.expires_at), severity: typeof r.severity === 'number' ? r.severity : 1,
    intent: { key: h.intentLineKey(intentIn), label: h.INTENT_LABEL[h.intentOf(intentIn)], line: h.intentLine(intentIn) },
    distanceMi, distanceLabel: h.formatDistance(raw), feedback: null, contacts: [], draft: null, ai: { note: null },
  };
}

const byId = new Map(fx.rows.map((r) => [r.id, r]));
const feeds = {}; const alerts = {}; const distances = {};
for (const [name, ids] of Object.entries(fx.sets)) {
  const rows = ids.map((id) => byId.get(id));
  const items = rows.map((r, i) => alertDto(r, 9000 + r.id));
  // newest first, like the server: created_at desc, id desc
  items.sort((a, b) => (a.matchedAt < b.matchedAt ? 1 : a.matchedAt > b.matchedAt ? -1 : b.signalId - a.signalId));
  feeds[name] = items;
  for (const it of items) { alerts[it.signalId] = it; distances[it.signalId] = it.distanceLabel; }
}

// Config: the server's configBody() mapping, from the same public price source.
const pp = h.PUBLIC_PRICES;
const price = (p) => ({ productId: p.storeProductId, cents: p.cents, display: p.display, displayLong: p.displayLong, period: p.period });
const limitsDto = (tier) => { const l = h.PLAN_LIMITS[tier]; return l; };
const plan = (p) => ({ entitlement: p.entitlement, tier: p.tier, name: p.name, monthly: price(p.monthly), yearly: price(p.annual), yearlySaving: p.annualSaving, limits: p.limits ?? null });
const config = {
  ok: true, apiVersion: 1, currency: 'USD', trialDays: pp.trialDays,
  plans: { solo: plan(pp.plans.solo), pro: plan(pp.plans.pro) }, entitlements: ['solo', 'pro'], offeringId: 'default',
  trades: h.CATEGORIES.map((c) => ({ id: c.id, label: c.label, group: Object.fromEntries(h.CATEGORY_GROUPS.map((g) => [g.id, g.label]))[c.group] ?? null })),
  radius: { min: 5, max: 100, default: 25 },
  links: { terms: 'https://localholler.com/terms', privacy: 'https://localholler.com/privacy', support: 'https://localholler.com/faq', manageApple: 'https://apps.apple.com/account/subscriptions', manageGoogle: 'https://play.google.com/store/account/subscriptions' },
  minAppVersion: '1.0.0',
};
writeFileSync(path.join(out, 'data.json'), JSON.stringify({ feeds, alerts, distances, config, prices: { solo: pp.plans.solo, pro: pp.plans.pro } }, null, 1));
console.log('feeds', Object.fromEntries(Object.entries(feeds).map(([k, v]) => [k, v.map((i) => `${i.signalId}:${i.distanceLabel}`)])));
console.log('plans', JSON.stringify(config.plans, null, 1).slice(0, 1500));
