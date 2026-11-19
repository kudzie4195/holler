// Public pages stay static: nothing on the layout path reads request data. Also: nothing here stores forbidden fields.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const REQUEST_API = /next\/headers|\bcookies\s*\(|\bheaders\s*\(|\bconnection\s*\(|\bsearchParams\b|useSearchParams|next\/server|\bafter\s*\(/;

/** The files app/layout.tsx pulls in for analytics, followed through relative and @/ imports. */
function layoutAnalyticsPath(): string[] {
  const seen = new Set<string>();
  const queue = ['app/layout.tsx'];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const m of code(read(f)).matchAll(/from\s+'((?:@\/|\.\/)[^']+)'/g)) {
      const base = m[1].startsWith('@/') ? m[1].slice(2) : path.posix.join(path.posix.dirname(f), m[1]);
      for (const ext of ['.ts', '.tsx', '/index.ts']) {
        if (fs.existsSync(path.join(root, base + ext))) {
          // Follow only the analytics modules; the rest of the layout path is unchanged by this unit.
          if (/analytics/.test(base)) queue.push(base + ext);
          break;
        }
      }
    }
  }
  return [...seen];
}

describe('static rendering', () => {
  it('the layout mounts <Analytics /> from components/analytics', () => {
    const layout = read('app/layout.tsx');
    expect(layout).toMatch(/import \{ Analytics \} from '@\/components\/analytics'/);
    expect(layout.match(/<Analytics \/>/g)).toHaveLength(1);
  });
  it('the layout path uses no cookies(), headers(), connection(), searchParams or after()', () => {
    const files = layoutAnalyticsPath();
    expect(files).toEqual(expect.arrayContaining(['app/layout.tsx', 'components/analytics.tsx', 'lib/analytics/client.ts', 'lib/analytics/attr.ts']));
    for (const f of files) expect(code(read(f)), f).not.toMatch(REQUEST_API);
  });
  it('the layout itself has no request API', () => {
    expect(code(read('app/layout.tsx'))).not.toMatch(REQUEST_API);
  });
  it('the component is a client component and imports no server-only module', () => {
    const c = read('components/analytics.tsx');
    expect(c.startsWith("'use client'")).toBe(true);
    expect(code(c)).not.toMatch(/server-only|supabase|lib\/analytics\/(server|request|ingest|deps|stripe)/);
  });
  it('request-reading analytics modules are not reachable from the browser modules', () => {
    for (const f of ['lib/analytics/client.ts', 'lib/analytics/attr.ts']) {
      expect(code(read(f)), f).not.toMatch(/from '\.\/(server|request|ingest|deps|stripe)'|server-only/);
    }
  });
  it('the public pages that were static are not made dynamic by this unit', () => {
    for (const p of ['app/page.tsx', 'app/pricing/page.tsx', 'app/faq/page.tsx', 'app/about/page.tsx']) {
      if (!fs.existsSync(path.join(root, p))) continue;
      expect(code(read(p)), p).not.toMatch(/lib\/analytics\/(request|server)/);
    }
  });
});

describe('data minimization in the code', () => {
  const server = ['lib/analytics/server.ts', 'lib/analytics/events.ts', 'lib/analytics/ingest.ts', 'lib/analytics/request.ts', 'lib/analytics/deps.ts', 'lib/analytics/stripe.ts'];
  it('no insert or upsert payload names an ip, user agent or referrer field', () => {
    for (const f of server) expect(code(read(f)), f).not.toMatch(/\b(ip_address|user_agent|referrer|referer|ip_hash|fingerprint)\s*:/i);
  });
  it('the migration has no column for them', () => {
    const sql = read('supabase/migrations/0017_holler_analytics.sql').replace(/^\s*--.*$/gm, '');
    expect(sql).not.toMatch(/\b(ip|ip_address|ip_hash|user_agent|ua|referrer|referer|url|query|fingerprint)\s+(text|inet|cidr|varchar)/i);
  });
  it('the event route reads the user agent only to decide, and does not pass it on', () => {
    const ing = code(read('lib/analytics/ingest.ts'));
    expect(ing).toMatch(/looksAutomated\(h\('user-agent'\)/);
    expect(ing.match(/user-agent/g)).toHaveLength(1);
  });
});
