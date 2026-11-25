/**
 * Round 33 review fixes: the script's own behaviour (lib/signals/sam-backfill-cli.ts, which scripts/sam-backfill.ts wraps). Each test fails
 * if the thing it names is removed: the switch check, the dedupe flag, the quiet flag, the dry-run isolation, the option validation.
 * Every fetch is a stub; nothing touches the network or a database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeInsert, positiveInt, runCli, type CliIo, type InsertFn, type StoreMods } from '@/lib/signals/sam-backfill-cli';
import { type BackfillState } from '@/lib/signals/sam-backfill';
import { rematchSignals } from '@/lib/signals/rematch';
import { fakeTables } from '../match/fake-table';
import type { SignalInput } from '@/lib/signals/types';

vi.mock('server-only', () => ({}));

const NOW = new Date('2026-11-25T15:00:00Z');
const KEY = 'CLI-TEST-KEY-not-real-123456';
let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sam-cli-'));
  file = join(dir, 'state.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const notice = (id: string) => ({
  noticeId: id, title: `Grounds maintenance ${id}`, type: 'Combined Synopsis/Solicitation', naicsCode: '561730', postedDate: '2026-11-10', responseDeadLine: '2026-12-20',
  typeOfSetAside: 'SBA', placeOfPerformance: { city: { name: 'Atlanta' }, state: { code: 'GA' } },
});

interface Rig { io: CliIo; out: string[]; err: string[]; calls: string[]; inserted: SignalInput[][]; clock: { now: Date } }
function rig(env: Record<string, string | undefined>, opts: { fetchAnswer?: (u: URL) => unknown } = {}): Rig {
  const out: string[] = [];
  const err: string[] = [];
  const calls: string[] = [];
  const inserted: SignalInput[][] = [];
  const clock = { now: NOW };
  const io: CliIo = {
    env,
    out: (m) => out.push(m),
    err: (m) => err.push(m),
    now: () => clock.now,
    sleep: async () => {},
    fetch: (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      const u = new URL(String(input));
      const body = opts.fetchAnswer ? opts.fetchAnswer(u) : { totalRecords: 1, opportunitiesData: [notice(`${u.searchParams.get('state')}-${u.searchParams.get('ptype')}`)] };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch,
    buildInsert: async () => {
      const seen = new Set<string>();
      const fn: InsertFn = async (rows) => {
        inserted.push(rows);
        let n = 0;
        for (const r of rows) {
          if (seen.has(r.externalId)) continue;
          seen.add(r.externalId);
          n++;
        }
        return n;
      };
      return fn;
    },
  };
  return { io, out, err, calls, inserted, clock };
}
const ON = { HOLLER_SAM_BACKFILL_ENABLED: '1', SAM_API_KEY: KEY };
const read = (): BackfillState => JSON.parse(readFileSync(file, 'utf8'));

describe('the switch', () => {
  const envs: Record<string, string | undefined>[] = [{ SAM_API_KEY: KEY }, { ...ON, HOLLER_SAM_BACKFILL_ENABLED: '0' }, { ...ON, HOLLER_SAM_BACKFILL_ENABLED: '' }, { ...ON, HOLLER_SAM_BACKFILL_ENABLED: 'nope' }];
  for (const env of envs) {
    it(`--run and --run --dry both refuse with the switch at ${JSON.stringify(env.HOLLER_SAM_BACKFILL_ENABLED)}: exit 2, no request, no state file`, async () => {
      for (const extra of [[], ['--dry']]) {
        const r = rig(env);
        expect(await runCli(['--run', ...extra, '--state', file], r.io)).toBe(2);
        expect(r.calls).toHaveLength(0);
        expect(r.err.join(' ')).toMatch(/HOLLER_SAM_BACKFILL_ENABLED is not on/);
        expect(existsSync(file)).toBe(false);
      }
    });
  }
  it('--plan needs no switch, makes no request and writes no file', async () => {
    const r = rig({});
    expect(await runCli(['--state', file], r.io)).toBe(0);
    expect(await runCli(['--plan', '--state', file], r.io)).toBe(0);
    expect(r.calls).toHaveLength(0);
    expect(existsSync(file)).toBe(false);
    expect(r.out.join('\n')).toMatch(/plan only: no request was made/);
  });
  it('no key: exit 2 before any request', async () => {
    const r = rig({ HOLLER_SAM_BACKFILL_ENABLED: '1' });
    expect(await runCli(['--run', '--state', file], r.io)).toBe(2);
    expect(r.calls).toHaveLength(0);
  });
});

describe('option validation', () => {
  it('positiveInt accepts whole numbers of 1 or more and nothing else', () => {
    expect(positiveInt('--x', undefined)).toBeNull();
    expect(positiveInt('--x', '7')).toBe(7);
    for (const bad of ['abc', '0', '-1', '1.5', '3x', '', ' ', 'NaN', '1e3']) expect(() => positiveInt('--x', bad)).toThrow(/whole number/);
  });
  for (const args of [['--max-requests', 'abc'], ['--max-requests', '0'], ['--daily-budget', '-2'], ['--daily-budget', 'x'], ['--daily-budget', '1.5']]) {
    it(`${args.join(' ')} is refused before any request (exit 2)`, async () => {
      const r = rig(ON);
      expect(await runCli(['--run', ...args, '--state', file], r.io)).toBe(2);
      expect(r.calls).toHaveLength(0);
      expect(r.err.join(' ')).toMatch(/must be a whole number/);
    });
  }
  it('a valid --max-requests really caps the run, and the default budget is 1 request a day', async () => {
    const r = rig(ON);
    expect(await runCli(['--run', '--state', file], r.io)).toBe(0);
    expect(r.calls).toHaveLength(1);
    const r2 = rig(ON);
    expect(await runCli(['--run', '--daily-budget', '9', '--max-requests', '2', '--state', join(dir, 'b.json')], r2.io)).toBe(0);
    expect(r2.calls).toHaveLength(2);
  });
  it('--daily-budget above the ceiling is cut to 400 and said so', async () => {
    const r = rig(ON);
    await runCli(['--run', '--daily-budget', '5000', '--max-requests', '1', '--state', file], r.io);
    expect(r.err.join(' ')).toMatch(/ceiling; using 400/);
    expect(r.out.join('\n')).toMatch(/"dailyBudget": 400/);
  });
});

describe('the documented sequence: --run --dry, then --run', () => {
  it('the dry run stores nothing and marks no task done; the real run then reads and stores the same tasks', async () => {
    const r = rig(ON);
    const args = ['--daily-budget', '3', '--state', file];
    // dry run: three requests (GA:o, TX:o, NC:o)
    expect(await runCli(['--run', '--dry', ...args], r.io)).toBe(0);
    expect(r.calls).toHaveLength(3);
    expect(r.inserted).toHaveLength(0);
    let st = read();
    expect(Object.values(st.tasks)).toHaveLength(0); // no task was recorded, none done
    expect(st.requests.count).toBe(3); // but the requests were counted against the day
    expect(r.out.join('\n')).toMatch(/Dry run: nothing was stored and no task was marked done/);
    // the same UTC day: the budget is used up, the real run waits
    expect(await runCli(['--run', ...args], r.io)).toBe(0);
    expect(r.calls).toHaveLength(3);
    // next UTC day: the real run starts at GA:o, the task the dry run looked at, and stores it
    r.clock.now = new Date('2026-11-26T01:00:00Z');
    expect(await runCli(['--run', ...args], r.io)).toBe(0);
    expect(r.calls).toHaveLength(6);
    expect(r.calls.slice(3).map((c) => new URL(c).searchParams.get('state'))).toEqual(['GA', 'TX', 'NC']);
    expect(r.inserted.map((rows) => rows[0].externalId)).toHaveLength(3);
    st = read();
    expect(st.tasks['GA:o']).toMatchObject({ status: 'done', inserted: 1 });
    expect(st.tasks['TX:o'].status).toBe('done');
    expect(st.tasks['NC:o'].status).toBe('done');
  });
  it('a dry run after a real partial run does not undo or advance it', async () => {
    const r = rig(ON);
    await runCli(['--run', '--daily-budget', '1', '--state', file], r.io); // real: GA:o done
    const before = read();
    r.clock.now = new Date('2026-11-26T01:00:00Z');
    await runCli(['--run', '--dry', '--daily-budget', '1', '--state', file], r.io); // dry: looks at TX:o
    const after = read();
    expect(after.tasks).toEqual(before.tasks);
    expect(after.requests.count).toBe(1);
  });
  it('the state file never holds the key', async () => {
    const r = rig(ON);
    await runCli(['--run', '--daily-budget', '2', '--state', file], r.io);
    await runCli(['--run', '--dry', '--daily-budget', '2', '--state', file], r.io);
    expect(readFileSync(file, 'utf8')).not.toContain(KEY);
    expect(r.out.join('\n')).not.toContain(KEY);
  });
});

describe('makeInsert: dedupe and quiet', () => {
  const rows = [{ source: 'sam-gov', externalId: 'a', data: { type: 'Solicitation', setAside: 'SBA' } }, { source: 'sam-gov', externalId: 'b' }] as unknown as SignalInput[];
  function mods() {
    const calls = { insert: [] as Array<{ rows: Array<SignalInput & { placeSlug: string | null; data: Record<string, unknown> }>; opts: { dedupe: boolean } }>, rematch: [] as Array<{ ids: number[]; opts: { quiet: boolean } }> };
    const m: StoreMods = {
      insertNewSignals: async (_db, r, opts) => {
        calls.insert.push({ rows: r as never, opts });
        return r.map((_, i) => ({ id: i + 10 }));
      },
      rematchSignals: async (_db, ids, opts) => {
        calls.rematch.push({ ids, opts });
        return { created: ids.length };
      },
      placeSlugFor: () => 'atlanta-ga',
    };
    return { m, calls };
  }
  it('inserts with dedupe: true, marks every row data.backfill, keeps the set-aside', async () => {
    const { m, calls } = mods();
    const n = await makeInsert({}, m, { match: true, log: () => {} })(rows);
    expect(n).toBe(2);
    expect(calls.insert).toHaveLength(1);
    expect(calls.insert[0].opts.dedupe).toBe(true);
    expect(calls.insert[0].rows.every((r) => r.data.backfill === true && r.placeSlug === 'atlanta-ga')).toBe(true);
    expect(calls.insert[0].rows[0].data).toMatchObject({ type: 'Solicitation', setAside: 'SBA' });
  });
  it('adds the new rows to feeds with a QUIET rematch (quiet: true), only the ids that were inserted', async () => {
    const { m, calls } = mods();
    await makeInsert({}, m, { match: true, log: () => {} })(rows);
    expect(calls.rematch).toHaveLength(1);
    expect(calls.rematch[0].opts.quiet).toBe(true);
    expect(calls.rematch[0].ids).toEqual([10, 11]);
  });
  it('--no-match: no rematch at all', async () => {
    const { m, calls } = mods();
    await makeInsert({}, m, { match: false, log: () => {} })(rows);
    expect(calls.rematch).toHaveLength(0);
  });
  it('a notice that was already stored (nothing inserted) triggers no rematch', async () => {
    const { m, calls } = mods();
    m.insertNewSignals = async () => [];
    expect(await makeInsert({}, m, { match: true, log: () => {} })(rows)).toBe(0);
    expect(calls.rematch).toHaveLength(0);
  });
  it('the wrapper script wires the real store to runCli and makeInsert', () => {
    const src = readFileSync(join(__dirname, '../../scripts/sam-backfill.ts'), 'utf8');
    expect(src).toMatch(/runCli\(/);
    expect(src).toMatch(/buildRealInsert\(process\.env/);
    const lib = readFileSync(join(__dirname, '../../lib/signals/sam-backfill-cli.ts'), 'utf8');
    expect(lib).toMatch(/insertNewSignals: store\.insertNewSignals/);
    expect(lib).toMatch(/rematchSignals: rematch\.rematchSignals/);
  });
});

describe('a backfilled row is history for every later rematch (the hourly AI step too)', () => {
  const sig = (id: number, data: Record<string, unknown>) => ({
    id, source: 'sam-gov', kind: 'contract', title: 'Federal bid in Atlanta, GA: Grounds maintenance', summary: 'Combined Synopsis/Solicitation | ARMY | NAICS 561730',
    categories: ['landscaping'], lat: 33.749, lon: -84.388, state: 'GA', severity: 2, occurred_at: '2026-11-24T00:00:00.000Z', expires_at: '2026-12-20T12:00:00.000Z', data,
  });
  const profile = { user_id: 'u1', categories: ['landscaping'], lat: 33.749, lon: -84.388, state: 'GA', radius_mi: 25 };
  it('a fresh row marked data.backfill is stored notified even by a NON-quiet rematch; an unmarked fresh row is not', async () => {
    const db = fakeTables({ holler_signals: [sig(1, { backfill: true }), sig(2, {})], holler_matches: [] }, { conflict: { holler_matches: ['user_id', 'signal_id'] } });
    const r = await rematchSignals(db as never, [1, 2], { now: NOW, profiles: [profile as never] });
    expect(r.created).toBe(2);
    const byId = Object.fromEntries((db.tables.holler_matches as Array<{ signal_id: number; notified?: boolean; pushed_at?: string | null }>).map((m) => [m.signal_id, m]));
    expect(byId[1].notified).toBe(true);
    expect(byId[1].pushed_at).toBeTruthy();
    expect(byId[2].notified).toBe(false);
  });
});
