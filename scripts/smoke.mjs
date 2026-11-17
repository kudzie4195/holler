#!/usr/bin/env node
// Holler smoke test. Plain Node 20+, no dependencies.
//
//   node scripts/smoke.mjs https://your-site.example            public checks only
//   node scripts/smoke.mjs https://your-site.example CRON_SECRET  also runs the cron routes
//
// Exit code 0 = PASS, 1 = FAIL. WARN lines never fail the run.
// With the secret it calls /api/cron/scan?dry=1 (fetch and parse, writes nothing) and prints one row per source.

const PUBLIC_PAGES = ['/', '/about', '/privacy', '/terms', '/login', '/signup', '/local', '/local/georgia', '/local/georgia/atlanta-ga', '/pricing', '/request', '/guides', '/faq', '/data'];
// Built by other units this round. A miss is a WARN, not a FAIL.
const OPTIONAL_PAGES = ['/check'];
const CRON_ROUTES = ['/api/cron/scan', '/api/cron/notify', '/api/cron/health'];
const REDIRECT = new Set([301, 302, 303, 307, 308]);

export function parseArgs(argv) {
  const [site, secret] = argv;
  if (!site || site === '-h' || site === '--help') return { help: true };
  let base;
  try {
    const u = new URL(site);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
    base = u.origin;
  } catch {
    return { error: `"${site}" is not a URL. Example: node scripts/smoke.mjs https://holler.example` };
  }
  return { base, secret: secret || null };
}

function pad(v, n) {
  const s = String(v ?? '');
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

export function formatTable(rows, cols) {
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (cells) => cells.map((c, i) => pad(c, widths[i])).join('  ').trimEnd();
  return [line(cols), line(widths.map((w) => '-'.repeat(w))), ...rows.map((r) => line(cols.map((c) => r[c] ?? '')))].join('\n');
}

/** Pure: turns a scan report into table rows plus failures and warnings. */
export function judgeScan(report) {
  const rows = [];
  const failures = [];
  const warnings = [];
  for (const s of report?.sources ?? []) {
    const parsed = s.parsed ?? s.valid ?? 0;
    rows.push({ source: s.id, status: s.status, fetched: s.fetched ?? 0, parsed, latestOccurredAt: s.latestOccurredAt ?? '-' });
    if (s.status === 'error') failures.push(`${s.id}: error ${s.error ?? ''}`.trim());
    else if ((s.fetched ?? 0) > 0 && parsed === 0) failures.push(`${s.id}: fetched ${s.fetched} rows but parsed 0 (shape may have changed)`);
    else if (String(s.status).startsWith('skipped(env)')) warnings.push(`${s.id}: skipped, needs ${(s.missingEnv ?? []).join(', ') || 'an env var'}`);
  }
  if (rows.length === 0) failures.push('scan returned no sources');
  return { rows, failures, warnings };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/smoke.mjs <https://site> [CRON_SECRET]');
    process.exit(args.help && process.argv.length > 2 ? 0 : 1);
  }
  if (args.error) {
    console.error(args.error);
    process.exit(1);
  }
  const { base, secret } = args;
  const results = [];
  const record = (level, name, detail = '') => {
    results.push({ level, name });
    const tag = level === 'ok' ? 'PASS' : level === 'warn' ? 'WARN' : 'FAIL';
    console.log(`${tag}  ${name}${detail ? '  ' + detail : ''}`);
  };

  async function get(path, { headers = {}, timeoutMs = 30_000 } = {}) {
    const t0 = Date.now();
    try {
      const res = await fetch(base + path, { redirect: 'manual', headers: { 'User-Agent': 'holler-smoke/1.0', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
      const body = await res.text();
      return { res, body, ms: Date.now() - t0 };
    } catch (e) {
      return { error: e instanceof Error ? `${e.name}: ${e.message}` : String(e), ms: Date.now() - t0 };
    }
  }

  console.log(`Holler smoke test: ${base}${secret ? ' (with cron secret)' : ' (public checks only)'}\n`);

  for (const p of PUBLIC_PAGES) {
    const r = await get(p);
    if (r.error) record('fail', `GET ${p}`, r.error);
    else if (r.res.status === 200) record('ok', `GET ${p} -> 200`, `${r.ms} ms`);
    else record('fail', `GET ${p} -> ${r.res.status}, expected 200`);
  }
  for (const p of OPTIONAL_PAGES) {
    const r = await get(p);
    if (!r.error && r.res.status === 200) record('ok', `GET ${p} -> 200`, '(optional)');
    else record('warn', `GET ${p} -> ${r.error ?? r.res.status}`, '(optional page)');
  }

  {
    const r = await get('/robots.txt');
    if (r.error || r.res.status !== 200) record('fail', `GET /robots.txt -> ${r.error ?? r.res.status}`);
    else if (!/sitemap:/i.test(r.body)) record('fail', 'GET /robots.txt has no Sitemap line');
    else record('ok', 'GET /robots.txt -> 200 with Sitemap line');
  }
  {
    const r = await get('/sitemap.xml');
    if (r.error || r.res.status !== 200) record('fail', `GET /sitemap.xml -> ${r.error ?? r.res.status}`);
    else if (!/<urlset|<sitemapindex/.test(r.body)) record('fail', 'GET /sitemap.xml is not a sitemap');
    else record('ok', 'GET /sitemap.xml -> 200', `${(r.body.match(/<loc>/g) ?? []).length} urls`);
  }
  {
    const r = await get('/llms.txt');
    if (r.error || r.res.status !== 200) record('fail', `GET /llms.txt -> ${r.error ?? r.res.status}`);
    else if (r.body.trim().length < 50) record('fail', 'GET /llms.txt is nearly empty');
    else record('ok', 'GET /llms.txt -> 200');
  }
  {
    const p = '/local/georgia/nowhere-xx';
    const r = await get(p);
    if (r.error) record('fail', `GET ${p}`, r.error);
    else if (r.res.status === 404) record('ok', `GET ${p} -> 404 (bad city slug)`);
    else record('fail', `GET ${p} -> ${r.res.status}, expected 404 (soft 404 hurts SEO)`);
  }
  {
    const r = await get('/app');
    const loc = r.res?.headers.get('location') ?? '';
    if (r.error) record('fail', 'GET /app signed out', r.error);
    else if (REDIRECT.has(r.res.status) && /\/login/.test(loc)) record('ok', `GET /app signed out -> ${r.res.status} to ${loc}`);
    else record('fail', `GET /app signed out -> ${r.res.status}${loc ? ' to ' + loc : ''}, expected a redirect to /login`);
  }
  for (const p of CRON_ROUTES) {
    const r = await get(p);
    if (r.error) record('fail', `GET ${p} without key`, r.error);
    else if (r.res.status === 401) record('ok', `GET ${p} without key -> 401`);
    else record('fail', `GET ${p} without key -> ${r.res.status}, expected 401`);
  }

  if (!secret) {
    console.log('\nNo CRON_SECRET given: skipped the authenticated cron checks.');
  } else {
    const auth = { Authorization: `Bearer ${secret}` };
    {
      const r = await get('/api/cron/scan?dry=1', { headers: { Authorization: 'Bearer wrong-' + secret } });
      if (!r.error && r.res.status === 401) record('ok', 'cron with a wrong secret -> 401');
      else record('fail', `cron with a wrong secret -> ${r.error ?? r.res.status}, expected 401`);
    }
    console.log('\nDry scan (fetches and parses every source, writes nothing). This takes up to a minute.');
    const r = await get('/api/cron/scan?dry=1', { headers: auth, timeoutMs: 90_000 });
    if (r.error) record('fail', 'GET /api/cron/scan?dry=1', r.error);
    else if (r.res.status !== 200) record('fail', `GET /api/cron/scan?dry=1 -> ${r.res.status}`, r.body.slice(0, 160));
    else {
      let report;
      try {
        report = JSON.parse(r.body);
      } catch {
        record('fail', 'GET /api/cron/scan?dry=1 returned something that is not JSON');
      }
      if (report) {
        const j = judgeScan(report);
        console.log('\n' + formatTable(j.rows, ['source', 'status', 'fetched', 'parsed', 'latestOccurredAt']) + '\n');
        record('ok', `GET /api/cron/scan?dry=1 -> 200`, `${j.rows.length} sources in ${r.ms} ms`);
        for (const w of j.warnings) record('warn', w);
        for (const f of j.failures) record('fail', f);
        if (j.failures.length === 0) record('ok', 'no source is erroring or parsing zero rows from real data');
      }
    }
    {
      const h = await get('/api/cron/health?dry=1', { headers: auth, timeoutMs: 60_000 });
      if (h.error) record('fail', 'GET /api/cron/health?dry=1', h.error);
      else if (h.res.status !== 200) record('fail', `GET /api/cron/health?dry=1 -> ${h.res.status}`, h.body.slice(0, 160));
      else {
        try {
          const rep = JSON.parse(h.body);
          record('ok', 'GET /api/cron/health?dry=1 -> 200', rep.subject ?? '');
          if (!rep.ok) record('warn', `health report lists ${rep.problemCount} problem(s). Expected before the first scans have run.`);
        } catch {
          record('fail', 'GET /api/cron/health?dry=1 returned something that is not JSON');
        }
      }
    }
  }

  const failed = results.filter((x) => x.level === 'fail').length;
  const warned = results.filter((x) => x.level === 'warn').length;
  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${results.length - failed - warned} passed, ${warned} warnings, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error('smoke test crashed:', e);
    process.exit(1);
  });
}
