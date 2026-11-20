// Capture-only mock of the Holler mobile API (/api/m/*) plus the two Supabase auth URLs the app touches, and a static file server for
// the capture builds. NOT part of the app or the product. Every alert it serves is a real holler_signals row (see .gen/data.json).
// Usage: node store/mock-api.mjs [port] [distRoot]   (distRoot has ios/ and android/ builds; default store/.gen/dist)
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || 8799);
const distRoot = process.argv[3] || path.join(here, '.gen/dist');
const data = JSON.parse(readFileSync(path.join(here, '.gen/data.json'), 'utf8'));
const USER = { id: '00000000-0000-4000-8000-0000000000a1', email: null };

let scenario = { me: 'paid', feed: '01-records' };

const SOLO_LIMITS = data.config.plans.solo.limits;
const iso = (ms) => new Date(Date.now() + ms).toISOString();
function me() {
  if (scenario.me === 'onboarding') return { ok: true, user: USER, needsOnboarding: true, profile: null, access: null, limits: SOLO_LIMITS };
  // The member of the current scenario (fixtures/real-signals.json scenarios; ZIP placed by the server's lookupZip in build-data.mjs).
  const m = data.profiles[scenario.feed] ?? data.profiles['01-records'];
  const profile = { businessName: 'Sample Roofing', trades: m.trades, zip: m.zip, city: m.city, state: m.state, radiusMi: m.radiusMi, extraZips: [], keywords: [], alertEmail: true, pushAlerts: true, emailVerified: true, createdAt: iso(-3 * 864e5) };
  const trial = scenario.me === 'trial';
  const access = trial
    ? { state: 'trial', tier: 'starter', tierName: 'Solo', subscriptionStatus: 'trialing', trialEndsAt: iso(14 * 864e5), trialDaysLeft: 14, billingSource: 'none', storeProductId: null, storeExpiresAt: null, mayBuyInStore: true, manageUrl: null }
    : { state: 'paid', tier: 'starter', tierName: 'Solo', subscriptionStatus: 'active', trialEndsAt: iso(-1 * 864e5), trialDaysLeft: 0, billingSource: 'apple', storeProductId: 'com.localholler.app.solo.monthly', storeExpiresAt: iso(20 * 864e5), mayBuyInStore: true, manageUrl: 'https://apps.apple.com/account/subscriptions' };
  return { ok: true, user: USER, needsOnboarding: false, profile, access, limits: SOLO_LIMITS };
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.map': 'application/json' };
const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = (req) => new Promise((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => r(s)); });

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${port}`);
  const p = u.pathname;
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (p === '/__scenario') { scenario = { ...scenario, ...JSON.parse((await readBody(req)) || '{}') }; return send(res, 200, { ok: true, scenario }); }
  if (p === '/api/m/config') return send(res, 200, data.config);
  if (p === '/api/m/me') return send(res, 200, me());
  if (p === '/api/m/feed') return send(res, 200, { ok: true, locked: false, items: data.feeds[scenario.feed] ?? [], nextCursor: null });
  if (p.startsWith('/api/m/alert/')) {
    const it = data.alerts[`${scenario.feed}:${p.split('/').pop()}`];
    return it ? send(res, 200, { ok: true, locked: false, item: it }) : send(res, 404, { ok: false, error: 'not_found', message: 'We could not find that alert.' });
  }
  if (p === '/api/m/check') return send(res, 200, { ok: false, error: 'invalid', message: 'not used in captures' });
  if (p.startsWith('/api/m/')) return send(res, 200, { ok: true });
  if (p.startsWith('/auth/v1/')) return send(res, 200, { user: USER });
  // static builds: /ios/..., /android/...
  let file = path.join(distRoot, p.endsWith('/') ? p + 'index.html' : p);
  if (!file.startsWith(distRoot) || !existsSync(file) || statSync(file).isDirectory()) return send(res, 404, 'not found', 'text/plain');
  send(res, 200, readFileSync(file), MIME[path.extname(file)] ?? 'application/octet-stream');
}).listen(port, '127.0.0.1', () => console.log(`mock-api on http://127.0.0.1:${port}, dist ${distRoot}`));
