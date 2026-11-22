import { vi } from 'vitest';
import { FirecrawlError, type FirecrawlClient, type ScrapeRequest, type ScrapeResult } from '@/lib/firecrawl/client';
import { rowsFromJson } from '@/lib/firecrawl/extract';
import { extracted, pageMd } from './helpers';

type Row = Record<string, unknown>;

/** Minimal in-memory stand-in for the supabase-js calls the ledger makes on holler_scan_runs. */
export class FakeDb {
  rows: Row[] = [];
  inserts: Row[] = [];
  touched = 0;
  from(table: string) {
    this.touched += 1;
    if (table !== 'holler_scan_runs') throw new Error(`unexpected table ${table}`);
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the returned object literals need the fake db
    const db = this;
    return {
      insert: async (r: Row) => {
        const row = { id: db.rows.length + 1, ...r };
        db.rows.push(row);
        db.inserts.push(row);
        return { error: null };
      },
      select() {
        const filters: Array<(r: Row) => boolean> = [];
        let order: Array<[string, boolean]> = [];
        let lim = Infinity;
        let range: [number, number] | null = null;
        const q = {
          like: (c: string, p: string) => (filters.push((r) => String(r[c] ?? '').startsWith(p.replace('%', '').replace(/\\/g, ''))), q),
          eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
          gte: (c: string, v: string) => (filters.push((r) => String(r[c] ?? '') >= v), q),
          order: (c: string, o: { ascending: boolean }) => ((order = [...order, [c, o.ascending]]), q),
          limit: (n: number) => ((lim = n), q),
          range: (a: number, b: number) => ((range = [a, b]), q),
          then(resolve: (v: { data: Row[]; error: null }) => unknown) {
            let out = db.rows.filter((r) => filters.every((f) => f(r)));
            for (const [c, asc] of [...order].reverse()) out = [...out].sort((x, y) => (String(x[c]) < String(y[c]) ? -1 : String(x[c]) > String(y[c]) ? 1 : 0) * (asc ? 1 : -1));
            if (range) out = out.slice(range[0], range[1] + 1);
            out = out.slice(0, lim);
            return Promise.resolve({ data: out, error: null }).then(resolve);
          },
        };
        return q;
      },
    };
  }
}

export interface ClientScript {
  /** Called per scrape; return a result or throw. */
  scrape: (req: ScrapeRequest, n: number) => Partial<ScrapeResult> | Error;
  remaining?: number | null;
  /** billingPeriodStart returned by credit-usage. */
  billingStart?: string | null;
}

export function mockClient(script: ClientScript) {
  const calls: ScrapeRequest[] = [];
  let creditUsageCalls = 0;
  const client: FirecrawlClient = {
    async scrape(req) {
      calls.push(req);
      const out = script.scrape(req, calls.length);
      if (out instanceof Error) throw out;
      const json = req.formats.some((f) => typeof f === 'object' && f.type === 'json');
      return { markdown: null, json: null, changeStatus: null, pageStatus: 200, warning: null, creditsReported: null, creditsEstimated: json ? 5 : 1, attempts: 1, ...out };
    },
    async creditUsage() {
      creditUsageCalls += 1;
      if (script.remaining === undefined) throw new FirecrawlError('network', null, 'no', true);
      return { remainingCredits: script.remaining, planCredits: 1000, billingPeriodStart: script.billingStart ?? null, billingPeriodEnd: null };
    },
  };
  return { client, calls, creditUsageCalls: () => creditUsageCalls };
}

/** A well-behaved Firecrawl for one source: the check says `status`, the extraction returns the fixture rows and page. */
export function fixtureScript(id: string, status: 'new' | 'changed' | 'same'): ClientScript {
  return {
    remaining: 900,
    scrape: (req) => {
      const isJson = req.formats.some((f) => typeof f === 'object' && f.type === 'json');
      if (isJson) return { markdown: pageMd(id), json: { solicitations: rowsFromJson(extracted(id)) } };
      return { markdown: pageMd(id), changeStatus: status };
    },
  };
}

export const okRobots = () => vi.fn(async () => new Response('User-agent: *\nDisallow: /admin\n', { status: 200 })) as unknown as typeof fetch;
