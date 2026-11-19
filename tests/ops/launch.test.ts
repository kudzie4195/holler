// Launch kit: .env.example, supabase/cron.sql, LAUNCH.md and scripts/smoke.mjs.
// The smoke script is run for real as a child process against a small local http server that imitates the routes.
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ENV_KEYS } from '../../lib/env';
import { formatTable, judgeScan, parseArgs } from '../../scripts/smoke.mjs';

const root = path.resolve(__dirname, '../..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

describe('.env.example', () => {
  const text = read('.env.example');
  it('lists every ENV_KEYS key exactly once, each with a comment line right above', () => {
    const lines = text.split('\n');
    for (const k of ENV_KEYS) {
      const idx = lines.findIndex((l) => l.startsWith(`${k}=`));
      expect(idx, `${k} missing`).toBeGreaterThan(-1);
      expect(lines.filter((l) => l.startsWith(`${k}=`))).toHaveLength(1);
      expect(lines[idx - 1].startsWith('# '), `${k} has no comment`).toBe(true);
      expect(/^# (REQUIRED|RECOMMENDED|OPTIONAL)/.test(lines[idx - 1]), `${k} comment must say required, recommended or optional`).toBe(true);
    }
  });
  it('marks exactly the five spec-required keys as REQUIRED', () => {
    const lines = text.split('\n');
    const required = ENV_KEYS.filter((k) => lines[lines.findIndex((l) => l.startsWith(`${k}=`)) - 1].startsWith('# REQUIRED'));
    expect(required).toEqual(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SITE_URL', 'CRON_SECRET']);
  });
  it('has no real-looking secret and no key that is not in ENV_KEYS', () => {
    expect(text).not.toMatch(/sk_(live|test)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}|re_[A-Za-z0-9]{12,}|eyJ[A-Za-z0-9]{10,}/);
    const keys = text.split('\n').filter((l) => /^[A-Z][A-Z0-9_]+=/.test(l)).map((l) => l.split('=')[0]);
    for (const k of keys) expect(ENV_KEYS as readonly string[]).toContain(k);
  });
  it('has no em dash', () => expect(text).not.toContain('—'));
});

describe('supabase/cron.sql', () => {
  const sql = read('supabase/cron.sql');
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const JOBS = ['holler-scan', 'holler-notify', 'holler-health', 'holler-dataforseo', 'holler-ai', 'holler-monitor', 'holler-lifecycle', 'holler-moat', 'holler-events-prune'];
  it('schedules the nine named jobs with the right cadence', () => {
    expect(code).toMatch(/cron\.schedule\(\s*'holler-scan',\s*'\*\/15 \* \* \* \*'/);
    expect(code).toMatch(/cron\.schedule\(\s*'holler-notify',\s*'7,22,37,52 \* \* \* \*'/);
    expect(code).toMatch(/cron\.schedule\(\s*'holler-health',\s*'3 13 \* \* \*'/);
    expect(code).toMatch(/cron\.schedule\(\s*'holler-dataforseo',\s*'23 3,9,15,21 1-3 \* \*'/);
    expect(code).toMatch(/cron\.schedule\(\s*'holler-ai',\s*'4 \* \* \* \*'/);
    expect(code).toMatch(/cron\.schedule\(\s*'holler-monitor',\s*'11 \* \* \* \*'/);
    expect(code).toMatch(/cron\.schedule\(\s*'holler-lifecycle',\s*'17 \* \* \* \*'/);
    expect(code).toMatch(/cron\.schedule\(\s*'holler-moat',\s*'41 18 \* \* \*'/);
    expect(code).toMatch(/cron\.schedule\(\s*'holler-events-prune',\s*'29 4 \* \* 0',\s*\$job\$ select public\.holler_events_prune\(400\); \$job\$\)/);
    const names = [...code.matchAll(/cron\.schedule\(\s*'([^']+)'/g)].map((m) => m[1]);
    expect(names.sort()).toEqual([...JOBS].sort());
  });
  it('no two jobs share a start minute, with no exception (health moved to 13:03, off the scan minute)', () => {
    // Expand each 5-field schedule to the set of (day-of-week, hour, minute) it can fire at, for one week; day-of-month is ignored
    // (dataforseo runs on days 1 to 3 only, which can only remove clashes).
    const field = (f: string, max: number) => {
      if (f === '*') return Array.from({ length: max }, (_, i) => i);
      if (f.startsWith('*/')) return Array.from({ length: max }, (_, i) => i).filter((i) => i % Number(f.slice(2)) === 0);
      return f.split(',').map(Number);
    };
    const slots = new Map<string, string[]>();
    for (const m of code.matchAll(/cron\.schedule\(\s*'([^']+)',\s*'([^']+)'/g)) {
      const [min, hour, , , dow] = m[2].split(' ');
      for (const d of field(dow, 7)) for (const h of field(hour, 24)) for (const mi of field(min, 60)) {
        const k = `${d}:${h}:${mi}`;
        slots.set(k, [...(slots.get(k) ?? []), m[1]]);
      }
    }
    const clashes = [...new Set([...slots.values()].filter((v) => v.length > 1).map((v) => v.sort().join('+')))];
    expect(clashes).toEqual([]);
  });
  it('calls net.http_get on /api/cron/<name> with an Authorization Bearer header', () => {
    for (const n of ['scan', 'notify', 'health', 'dataforseo', 'ai', 'lifecycle', 'moat']) expect(code).toContain(`|| '/api/cron/${n}'`);
    // LAUNCH.md names the same health time and no longer admits a shared minute.
    expect(read('LAUNCH.md')).toContain('`holler-health` (daily 13:03 UTC)');
    expect(read('LAUNCH.md')).not.toMatch(/same minute except/);
    expect(code).toContain(`|| '/api/cron/health?monitor=1'`);
    expect(code.match(/net\.http_get\(/g)).toHaveLength(8);
    expect(code.match(/'Authorization', 'Bearer ' \|\|/g)).toHaveLength(8);
    expect(code.match(/timeout_milliseconds := 58000/g)).toHaveLength(8);
  });
  it('reads the secret from Vault, and the only literals are the placeholders', () => {
    expect(code).toContain("vault.create_secret('<CRON_SECRET>'");
    expect(code).toContain("vault.create_secret('https://<SITE>'");
    expect(code.match(/decrypted_secret from vault\.decrypted_secrets/g)!.length).toBeGreaterThanOrEqual(16);
    expect(code).not.toMatch(/Bearer [A-Za-z0-9]{16,}/);
  });
  it('unschedules before it schedules (rerunnable) and documents the unschedule statements', () => {
    expect(code.indexOf('cron.unschedule(jobname)')).toBeLessThan(code.indexOf('cron.schedule('));
    for (const n of JOBS) expect(sql).toContain(`select cron.unschedule('${n}');`);
    // STEP 2 removes every job it is about to create, so a re-run never fails on an existing name.
    const step2 = code.slice(code.indexOf('cron.unschedule(jobname)'), code.indexOf('cron.schedule('));
    for (const n of JOBS) expect(step2).toContain(`'${n}'`);
  });
  it('only touches holler-* jobs and holler_* secrets, and is not in the migrations folder', () => {
    expect(code).not.toMatch(/cron\.schedule\(\s*'(?!holler-)/);
    for (const m of code.matchAll(/where name = '([^']+)'/g)) expect(m[1].startsWith('holler_')).toBe(true);
  });
});

describe('LAUNCH.md', () => {
  const md = read('LAUNCH.md');
  it('has the ordered launch steps', () => {
    const order = ['Apply the database migrations', 'Resend', 'Set environment variables', 'Deploy', 'Run the smoke test', 'Review the dry-run table', 'Schedule the cron jobs', 'Stripe', 'First real signup test', 'Rollback'];
    let at = -1;
    for (const h of order) {
      const i = md.search(new RegExp(`^## \\d+\\. .*${h}`, 'm'));
      expect(i, `missing step "${h}"`).toBeGreaterThan(at);
      at = i;
    }
  });
  const allMigrations = readdirSync(path.join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  const listedInOrder = (migrations: string[]) => {
    for (const m of migrations) expect(md, m).toContain(`supabase/migrations/${m}`);
    // Listed in apply order.
    const at = migrations.map((m) => md.indexOf(`Run \`supabase/migrations/${m}\``));
    expect(at.every((i) => i >= 0), JSON.stringify(migrations.filter((_, i) => at[i] < 0))).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  };
  it('names migrations 0001 to 0020 in apply order, the five webhook events and the smoke command', () => {
    const upTo20 = allMigrations.filter((f) => Number(f.slice(0, 4)) <= 20);
    expect(upTo20).toEqual(expect.arrayContaining(['0001_holler.sql', '0005_holler_requests.sql', '0013_holler_signal_dedupe.sql', '0019_holler_trial_14.sql', '0020_holler_mobile.sql']));
    expect(upTo20).toHaveLength(20);
    listedInOrder(upTo20);
    for (const s of ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'exactly these five', 'node scripts/smoke.mjs']) expect(md).toContain(s);
    expect(md).not.toContain('exactly these four');
  });
  it('names every migration in the folder in apply order (later migrations land with their own unit)', () => {
    listedInOrder(allMigrations);
  });
  it('round 7: the order block says which migrations go before the deploy, and the new env keys and dry runs are listed', () => {
    const block = md.slice(md.indexOf('**Round 7 order**'), md.indexOf('- [ ] Run `supabase/migrations/0001_holler.sql`'));
    expect(block).toMatch(/BEFORE the deploy: run 0015 and 0019/);
    expect(block).toMatch(/Any time, before or after the deploy, in number order: 0013, 0014, 0016, 0017, 0018/);
    for (const k of ['AI_MONTHLY_CAP_USD', 'AI_CLASSIFY_MODEL']) expect(md).toContain(`\`${k}\``);
    for (const u of ['/api/cron/ai?dry=1', '/api/cron/lifecycle?dry=1', '/api/cron/moat?dry=1', '/api/cron/health?monitor=1&dry=1']) expect(md).toContain(u);
    for (const q of ['from public.holler_conversion_by_source', 'from public.holler_ai_spend', 'public.holler_attribution']) expect(md).toContain(q);
    // The conversion query reads the columns 0015 now defines (emailed, answered, kind).
    expect(md).toContain('select window_days, source, kind, intent, trade, alerts, emailed, answered, useful, not_relevant, led_to_work, total_job_value_usd');
    for (const j of ['holler-ai', 'holler-monitor', 'holler-lifecycle', 'holler-moat', 'holler-events-prune']) expect(md).toContain(`select cron.unschedule('${j}');`);
  });
  it('round 3: portal cancels at period end with plan switching off, new routes are smoke-checked, optional keys need a Privacy update', () => {
    expect(md).toMatch(/cancel \*\*at the end of the billing period\*\*/);
    expect(md).toMatch(/Switching plans[^\n]*\*\*off\*\*/);
    for (const r of ['/pricing', '/request', '/guides', '/faq', '/data']) {
      expect(md).toContain(`\`${r}\``);
      expect(read('scripts/smoke.mjs')).toContain(`'${r}'`);
    }
    expect(md).toMatch(/optional source key[\s\S]*Bluesky, Serper or Brave, Ticketmaster, SAM\.gov[\s\S]*app\/privacy\/page\.tsx/);
    expect(md).toContain('Pro `$13.99` a month or `$139.99` a year');
    expect(md).toContain('Solo `$7.99` a month or `$79.99` a year');
  });
  it('mentions every ENV_KEYS key that a founder must act on, and no em dash', () => {
    for (const k of ENV_KEYS) expect(md, k).toContain(k);
    expect(md).not.toContain('—');
  });
});

describe('smoke.mjs pure helpers', () => {
  it('parseArgs', () => {
    expect(parseArgs(['https://holler.example/', 'sec'])).toEqual({ base: 'https://holler.example', secret: 'sec' });
    expect(parseArgs(['https://holler.example'])).toEqual({ base: 'https://holler.example', secret: null });
    expect(parseArgs([]).help).toBe(true);
    expect(parseArgs(['nope']).error).toMatch(/not a URL/);
    expect(parseArgs(['ftp://x.test']).error).toMatch(/not a URL/);
  });
  it('judgeScan fails on error, and on fetched>0 with parsed 0, warns on skipped(env), passes quiet sources', () => {
    const j = judgeScan({
      sources: [
        { id: 'a', status: 'ok', fetched: 5, parsed: 5, latestOccurredAt: '2026-11-17T00:00:00Z' },
        { id: 'quiet', status: 'ok', fetched: 0, parsed: 0, latestOccurredAt: null },
        { id: 'broken', status: 'error', fetched: 0, parsed: 0, error: 'HTTP 503' },
        { id: 'drift', status: 'ok', fetched: 40, parsed: 0 },
        { id: 'k', status: 'skipped(env)', fetched: 0, parsed: 0, missingEnv: ['SAM_API_KEY'] },
      ],
    });
    expect(j.failures).toEqual(['broken: error HTTP 503', 'drift: fetched 40 rows but parsed 0 (shape may have changed)']);
    expect(j.warnings).toEqual(['k: skipped, needs SAM_API_KEY']);
    expect(j.rows).toHaveLength(5);
    expect(judgeScan({ sources: [] }).failures).toEqual(['scan returned no sources']);
  });
  it('formatTable aligns columns', () => {
    const t = formatTable([{ a: 'x', b: 'long value' }], ['a', 'b']).split('\n');
    expect(t[0]).toBe('a  b');
    expect(t[1]).toBe('-  ----------');
  });
});

// --- end to end: run the script against a fake site -------------------------------------------------------------
type Handler = (url: URL, headers: http.IncomingHttpHeaders) => { status: number; body?: string; headers?: Record<string, string> };
let server: http.Server | null = null;

async function start(handler: Handler): Promise<string> {
  server = http.createServer((req, res) => {
    const out = handler(new URL(req.url ?? '/', 'http://x'), req.headers);
    res.writeHead(out.status, out.headers ?? {});
    res.end(out.body ?? '');
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

const SECRET = 'smoke-secret';
const scan = {
  sources: [
    { id: 'nws', status: 'ok', fetched: 12, parsed: 12, latestOccurredAt: '2026-11-17T11:50:00.000Z' },
    { id: 'sam-gov', status: 'skipped(env)', fetched: 0, parsed: 0, missingEnv: ['SAM_API_KEY'] },
  ],
};

function goodSite(over: Partial<Record<string, ReturnType<Handler>>> = {}, scanBody: unknown = scan): Handler {
  return (url, headers) => {
    const p = url.pathname;
    if (over[p]) return over[p]!;
    if (p.startsWith('/api/cron/')) {
      if (headers.authorization !== `Bearer ${SECRET}`) return { status: 401, body: '{"error":"unauthorized"}' };
      if (p === '/api/cron/scan') return { status: 200, body: JSON.stringify(scanBody) };
      if (p === '/api/cron/health') return { status: 200, body: JSON.stringify({ ok: true, subject: 'Holler health: all sources OK', problemCount: 0 }) };
      return { status: 200, body: '{}' };
    }
    if (p === '/app') return { status: 307, headers: { location: '/login?next=/app' } };
    if (p === '/robots.txt') return { status: 200, body: 'User-agent: *\nAllow: /\nSitemap: https://x.test/sitemap.xml\n' };
    if (p === '/sitemap.xml') return { status: 200, body: '<?xml version="1.0"?><urlset><url><loc>https://x.test/</loc></url></urlset>' };
    if (p === '/llms.txt') return { status: 200, body: '# Holler\n'.repeat(10) };
    if (p === '/local/georgia/nowhere-xx') return { status: 404, body: 'not found' };
    if (p === '/check') return { status: 404 };
    return { status: 200, body: '<html></html>' };
  };
}

function run(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(root, 'scripts/smoke.mjs'), ...args], { timeout: 60_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: stdout + stderr });
    });
  });
}

describe('scripts/smoke.mjs end to end', () => {
  it('passes on a healthy site (public checks only), warns for the optional page', async () => {
    const base = await start(goodSite());
    const r = await run([base]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('PASS: ');
    expect(r.out).toContain('GET /local/georgia/nowhere-xx -> 404');
    expect(r.out).toContain('GET /app signed out -> 307 to /login?next=/app');
    expect(r.out).toContain('GET /api/cron/scan without key -> 401');
    expect(r.out).toContain('WARN  GET /check');
    expect(r.out).toContain('skipped the authenticated cron checks');
  });

  it('with the secret prints the per-source table and passes', async () => {
    const base = await start(goodSite());
    const r = await run([base, SECRET]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/source\s+status\s+fetched\s+parsed\s+latestOccurredAt/);
    expect(r.out).toMatch(/nws\s+ok\s+12\s+12\s+2026-11-17T11:50:00.000Z/);
    expect(r.out).toMatch(/sam-gov\s+skipped\(env\)\s+0\s+0/);
    expect(r.out).toContain('WARN  sam-gov: skipped, needs SAM_API_KEY');
    expect(r.out).toContain('GET /api/cron/health?dry=1 -> 200');
    expect(r.out.trim().split('\n').pop()).toMatch(/^PASS:/);
  });

  it('fails (exit 1) when a source returns rows that parse to nothing', async () => {
    const base = await start(goodSite({}, { sources: [{ id: 'socrata-x', status: 'ok', fetched: 50, parsed: 0 }] }));
    const r = await run([base, SECRET]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('FAIL  socrata-x: fetched 50 rows but parsed 0');
    expect(r.out.trim().split('\n').pop()).toMatch(/^FAIL:/);
  });

  it('fails on a soft 404, an open cron route, a missing page and an /app that does not redirect', async () => {
    const base = await start(
      goodSite({
        '/local/georgia/nowhere-xx': { status: 200, body: 'not found body' },
        '/api/cron/notify': { status: 200, body: '{}' },
        '/about': { status: 500 },
        '/app': { status: 200 },
      }),
    );
    const r = await run([base]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('FAIL  GET /local/georgia/nowhere-xx -> 200, expected 404');
    expect(r.out).toContain('FAIL  GET /api/cron/notify without key -> 200, expected 401');
    expect(r.out).toContain('FAIL  GET /about -> 500');
    expect(r.out).toContain('FAIL  GET /app signed out -> 200');
  });

  it('fails when a cron route rejects the right secret (wrong CRON_SECRET deployed)', async () => {
    const base = await start(goodSite());
    const r = await run([base, 'not-the-deployed-secret']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('FAIL  GET /api/cron/scan?dry=1 -> 401');
  });

  it('fails cleanly when the site is unreachable', async () => {
    const r = await run(['http://127.0.0.1:1']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('FAIL');
  });
});
