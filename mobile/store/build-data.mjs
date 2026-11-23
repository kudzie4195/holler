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
const toIso = (s) => (s == null ? null : new Date(s.replace(' ', 'T').replace(/\+00$/, '+00:00')).toISOString());

// One member profile per screenshot (fixtures: scenarios). The work ZIP is placed with the server's own lookupZip(), the same call
// lib/auth/profile.ts makes when a member saves a ZIP, and every row must pass the server's own matchOne() for that profile: inside
// the radius, sharing a trade, and with a distance. A row that fails stops the build, so no shot can show a feed the server would
// not send that member.
function memberFor(name, sc) {
  const place = h.lookupZip(sc.zip);
  if (!place) throw new Error(`${name}: unknown ZIP ${sc.zip}`);
  return {
    place,
    match: { user_id: `capture-${name}`, categories: sc.trades, lat: place.lat, lon: place.lon, state: place.state, radius_mi: sc.radiusMi, plan: 'starter', subscription_status: 'active', extra_areas: [], keywords: [] },
  };
}

// Same shape as lib/mobile/feed.ts buildAlerts() for a member with access, no contacts, no feedback, no draft.
function alertDto(r, matchId, distanceMi) {
  const meta = h.getSourceMeta(r.source);
  const intentIn = { kind: r.kind, subtype: r.subtype ?? null, source: r.source };
  return {
    matchId, signalId: r.id, matchedAt: toIso(r.created_at), status: 'new', kind: r.kind, source: r.source,
    sourceLabel: meta?.label ?? null, sourceUrl: meta?.sourceUrl ?? null, title: r.title, summary: r.summary, url: r.url,
    city: r.city, state: r.state, county: r.county, zip: r.zip, place: [r.city, r.state].filter(Boolean).join(', ') || null,
    occurredAt: toIso(r.occurred_at), expiresAt: toIso(r.expires_at), severity: typeof r.severity === 'number' ? r.severity : 1,
    intent: { key: h.intentLineKey(intentIn), label: h.INTENT_LABEL[h.intentOf(intentIn)], line: h.intentLine(intentIn) },
    distanceMi, distanceLabel: h.formatDistance(distanceMi), feedback: null, contacts: [], draft: null, ai: { note: null },
  };
}

const byId = new Map(fx.rows.map((r) => [r.id, r]));
const feeds = {}; const alerts = {}; const profiles = {}; const distances = {};
for (const [name, sc] of Object.entries(fx.scenarios)) {
  const m = memberFor(name, sc);
  const items = sc.ids.map((id) => {
    const r = byId.get(id);
    if (!r) throw new Error(`${name}: row ${id} is not in the fixture`);
    const hit = h.matchOne({ ...r, data: { subtype: r.subtype } }, m.match);
    if (!hit) throw new Error(`${name}: row ${id} does not match ${sc.zip} r${sc.radiusMi} ${sc.trades.join('+')} (server matchOne)`);
    if (hit.distance_mi == null) throw new Error(`${name}: row ${id} matches without a distance`);
    return alertDto(r, 9000 + r.id, hit.distance_mi);
  });
  // newest first, like the server (created_at desc). The server breaks an exact tie by match id, which the fixture does not have:
  // rows of one scan keep the order the scenario lists.
  const pos = new Map(sc.ids.map((id, i) => [id, i]));
  items.sort((a, b) => (a.matchedAt < b.matchedAt ? 1 : a.matchedAt > b.matchedAt ? -1 : pos.get(a.signalId) - pos.get(b.signalId)));
  feeds[name] = items;
  profiles[name] = { zip: m.place.zip, city: m.place.city, state: m.place.state, lat: m.place.lat, lon: m.place.lon, radiusMi: sc.radiusMi, trades: sc.trades };
  distances[name] = Object.fromEntries(items.map((it) => [it.signalId, it.distanceLabel]));
  for (const it of items) alerts[`${name}:${it.signalId}`] = it;
}

// Config: the server's configBody() mapping, from the same public price source.
const pp = h.PUBLIC_PRICES;
const price = (p) => ({ productId: p.storeProductId, cents: p.cents, display: p.display, displayLong: p.displayLong, period: p.period });
const limitsDto = (tier) => { const l = h.PLAN_LIMITS[tier]; return l; };
const plan = (p) => ({ entitlement: p.entitlement, tier: p.tier, name: p.name, monthly: price(p.monthly), yearly: price(p.annual), yearlySaving: p.annualSaving, limits: p.limits ?? null });
const config = {
  ok: true, apiVersion: 1, currency: 'USD', trialDays: pp.trialDays, trialHeadline: pp.trialHeadline, trialPhrase: pp.trialPhrase,
  plans: { solo: plan(pp.plans.solo), pro: plan(pp.plans.pro) }, entitlements: ['solo', 'pro'], offeringId: 'default',
  trades: h.CATEGORIES.map((c) => ({ id: c.id, label: c.label, group: Object.fromEntries(h.CATEGORY_GROUPS.map((g) => [g.id, g.label]))[c.group] ?? null })),
  radius: { min: 5, max: 100, default: 25 },
  links: { terms: 'https://localholler.com/terms', privacy: 'https://localholler.com/privacy', support: 'https://localholler.com/faq', manageApple: 'https://apps.apple.com/account/subscriptions', manageGoogle: 'https://play.google.com/store/account/subscriptions' },
  minAppVersion: '1.0.0',
};
// Shot 7: the push text exactly as the server builds it (lib/push/notify.ts buildNotification) for row 33440, one new match,
// member city Chicago (the capture member's profile city).
const pushRow = byId.get(33440);
const push = h.buildNotification({ count: 1, top: { signalId: pushRow.id, title: pushRow.title, city: pushRow.city } }, 'Chicago');
writeFileSync(path.join(out, 'data.json'), JSON.stringify({ feeds, alerts, profiles, distances, config, prices: { solo: pp.plans.solo, pro: pp.plans.pro }, push: { signalId: pushRow.id, title: push.title, body: push.body } }, null, 1));
console.log('push', push.title, '|', push.body);
console.log('feeds', JSON.stringify(Object.fromEntries(Object.entries(feeds).map(([k, v]) => [k, `${profiles[k].zip} ${profiles[k].city}, ${profiles[k].state} (${profiles[k].lat}, ${profiles[k].lon}) r${profiles[k].radiusMi} ${profiles[k].trades.join('+')}: ` + v.map((i) => `${i.signalId} ${i.distanceLabel}`).join(' | ')])), null, 1));
console.log('plans', JSON.stringify(config.plans, null, 1).slice(0, 1500));
