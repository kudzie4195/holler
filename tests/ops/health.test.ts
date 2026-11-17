// All inputs are hand-written (assumed): scan-run rows follow the holler_scan_runs columns in supabase/migrations/0001_holler.sql
// and the adapter fields (id, label, kind, cadenceMinutes) follow lib/signals/types.ts. No external API shape is asserted here.
import { describe, expect, it } from 'vitest';
import { expectsRows, formatAge, planHealth, renderHealthEmail, type HealthAdapter, type HealthCounts, type HealthRun } from '../../lib/email/health';

const NOW = new Date('2026-11-17T13:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

const counts: HealthCounts = { newSignups24h: 4, activeSubscribers: 2, trialing: 9, usersEmailed24h: 3 };

const nws: HealthAdapter = { id: 'nws', label: 'NWS alerts', kind: 'alert', cadenceMinutes: 15 };
const spc: HealthAdapter = { id: 'spc', label: 'Storm reports', kind: 'report', cadenceMinutes: 30 };
const permits: HealthAdapter = { id: 'socrata-x-permits', label: 'X permits', kind: 'permit', cadenceMinutes: 360 };
const ask: HealthAdapter = { id: 'bluesky', label: 'Bluesky', kind: 'ask', cadenceMinutes: 360 };
const sam: HealthAdapter = { id: 'sam-gov', label: 'SAM', kind: 'contract', cadenceMinutes: 720, missingEnv: ['SAM_API_KEY'] };

/** Healthy history: one run per cadence for `days` days. */
function history(a: HealthAdapter, days = 4, fetched = 10, over: Partial<HealthRun> = {}): HealthRun[] {
  const out: HealthRun[] = [];
  const step = a.cadenceMinutes * MIN;
  for (let t = 0; t <= days * 24 * HOUR; t += step) out.push({ source: a.id, started_at: ago(t + 2 * MIN), fetched, inserted: 1, error: null, ...over });
  return out;
}

describe('expectsRows', () => {
  it('is true for weather, storm reports and city records, false for the quiet kinds', () => {
    expect(expectsRows(nws)).toBe(true);
    expect(expectsRows(spc)).toBe(true);
    expect(expectsRows(permits)).toBe(true);
    expect(expectsRows({ kind: 'civic', cadenceMinutes: 180 })).toBe(true);
    for (const kind of ['ask', 'contract', 'event', 'disaster', 'quake', 'travel']) expect(expectsRows({ kind, cadenceMinutes: 60 })).toBe(false);
  });
  it('is false for a source checked less than daily', () => {
    expect(expectsRows({ kind: 'civic', cadenceMinutes: 3 * 24 * 60 })).toBe(false);
  });
});

describe('planHealth: healthy', () => {
  const runs = [...history(nws), ...history(spc), ...history(permits), ...history(ask)];
  const r = planHealth({ adapters: [nws, spc, permits, ask], runs, counts, now: NOW });
  it('says all sources OK with no problem lines', () => {
    expect(r.ok).toBe(true);
    expect(r.subject).toBe('Holler health: all sources OK');
    expect(r.problems).toEqual([]);
    expect(r.problemCount).toBe(0);
  });
  it('reports per source last run, status and 24 h sums', () => {
    const n = r.sources.find((s) => s.id === 'nws')!;
    expect(n.status).toBe('ok');
    expect(n.lastRunAt).toBe(ago(2 * MIN));
    expect(n.runs24h).toBe(96); // 24 h of 15 min ticks, the newest 2 min old
    expect(n.fetched24h).toBe(n.runs24h * 10);
    expect(n.inserted24h).toBe(n.runs24h);
    expect(r.totals24h.runs).toBeGreaterThan(0);
  });
  it('passes the counts through', () => {
    expect(r.counts).toEqual(counts);
  });
});

describe('planHealth: problems', () => {
  it('flags a source whose latest run errored, with the error text', () => {
    const runs = [...history(nws), { source: 'nws', started_at: ago(1 * MIN), fetched: 0, inserted: 0, error: 'HTTP 503 from api.weather.gov' }];
    const r = planHealth({ adapters: [nws], runs, counts, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.sources[0].problems).toContain('errored');
    expect(r.sources[0].status).toBe('error');
    expect(r.problems.some((l) => l.startsWith('nws: errored on its latest run: HTTP 503'))).toBe(true);
  });

  it('does not flag an old error when the latest run was clean', () => {
    const runs = [...history(nws), { source: 'nws', started_at: ago(5 * HOUR), fetched: 0, inserted: 0, error: 'timeout' }];
    const r = planHealth({ adapters: [nws], runs, counts, now: NOW });
    expect(r.ok).toBe(true);
  });

  it('flags no run in 3x cadence, and not before', () => {
    const justOk = planHealth({ adapters: [nws], runs: [{ source: 'nws', started_at: ago(44 * MIN), fetched: 5, inserted: 0, error: null }, ...history(nws).slice(10)], counts, now: NOW });
    expect(justOk.sources[0].problems).not.toContain('stale');
    const stale = planHealth({ adapters: [nws], runs: [{ source: 'nws', started_at: ago(50 * MIN), fetched: 5, inserted: 0, error: null }], counts, now: NOW });
    expect(stale.sources[0].problems).toContain('stale');
    expect(stale.problems.some((l) => l.startsWith('nws: no run in 50 min'))).toBe(true);
  });

  it('uses each source own cadence for staleness', () => {
    // a 12 h source with its last run 20 h ago is fine (limit is 36 h)
    const slow: HealthAdapter = { id: 'usaspending', label: 'US', kind: 'contract', cadenceMinutes: 720 };
    const r = planHealth({ adapters: [slow], runs: [{ source: 'usaspending', started_at: ago(20 * HOUR), fetched: 3, inserted: 3, error: null }], counts, now: NOW });
    expect(r.sources[0].problems).toEqual([]);
  });

  it('flags a source with no runs at all in the lookback window', () => {
    const r = planHealth({ adapters: [nws, spc], runs: history(nws), counts, now: NOW });
    const s = r.sources.find((x) => x.id === 'spc')!;
    expect(s.status).toBe('never');
    expect(s.problems).toEqual(['never_ran']);
    expect(r.problems.some((l) => l.startsWith('spc: no run in the last 96 h'))).toBe(true);
  });

  it('flags zero rows for 3 days on a productive source, but not on a quiet kind', () => {
    const r = planHealth({
      adapters: [permits, ask],
      runs: [...history(permits, 4, 0, { inserted: 0 }), ...history(ask, 4, 0, { inserted: 0 })],
      counts,
      now: NOW,
    });
    expect(r.sources.find((s) => s.id === 'socrata-x-permits')!.problems).toEqual(['zero_rows_3d']);
    expect(r.sources.find((s) => s.id === 'bluesky')!.problems).toEqual([]);
    expect(r.problems).toContain('socrata-x-permits: no new rows for 3 days running');
  });

  it('review P2-16: a portal that stopped publishing still "fetches" its old lookback rows, but inserts nothing, so it is flagged', () => {
    // 10 rows fetched on every run (the dataset window still holds old permits), 0 new for 3 days
    const r = planHealth({ adapters: [permits], runs: history(permits, 4, 10, { inserted: 0 }), counts, now: NOW });
    expect(r.sources[0].problems).toEqual(['zero_rows_3d']);
    expect(r.ok).toBe(false);
  });

  it('review P2-16: new rows inserted on any run in the 3 days keep a source healthy even if later runs fetch the same rows', () => {
    const runs = history(permits, 4, 10, { inserted: 0 });
    runs[3] = { ...runs[3], inserted: 4 };
    expect(planHealth({ adapters: [permits], runs, counts, now: NOW }).ok).toBe(true);
  });

  it('does not raise zero_rows_3d for storm reports, but still flags errored and stale runs for them', () => {
    const quiet = planHealth({ adapters: [nws, spc], runs: [...history(nws), ...history(spc, 4, 0)], counts, now: NOW });
    expect(quiet.sources.find((s) => s.id === 'spc')!.problems).toEqual([]);
    expect(quiet.problems.some((l) => l.startsWith('spc:'))).toBe(false);
    expect(quiet.ok).toBe(true);
    const errored = planHealth({
      adapters: [nws, spc],
      runs: [...history(nws), ...history(spc, 4, 0), { source: 'spc', started_at: ago(MIN), fetched: 0, inserted: 0, error: 'boom' }],
      counts,
      now: NOW,
    });
    expect(errored.sources.find((s) => s.id === 'spc')!.problems).toEqual(['errored']);
    const stale = planHealth({ adapters: [nws, spc], runs: [...history(nws), ...history(spc, 4, 0).filter((r) => Date.parse(r.started_at!) < NOW.getTime() - 5 * HOUR)], counts, now: NOW });
    expect(stale.sources.find((s) => s.id === 'spc')!.problems).toContain('stale');
  });

  it('does not flag zero rows when one run in the 3 days inserted something', () => {
    const runs = history(permits, 4, 0, { inserted: 0 });
    runs[5] = { ...runs[5], fetched: 2, inserted: 2 };
    const r = planHealth({ adapters: [permits], runs, counts, now: NOW });
    expect(r.ok).toBe(true);
  });

  it('does not judge a source that has only 1 day of history (a new dataset)', () => {
    const r = planHealth({ adapters: [permits], runs: history(permits, 1, 0), counts, now: NOW });
    expect(r.sources[0].problems).toEqual([]);
    // but it shows up under Watch after its first empty day
    expect(r.watch).toEqual(['socrata-x-permits: nothing fetched in the last 24 h']);
    expect(r.ok).toBe(true);
  });

  it('reports an erroring source once (error), not twice (error plus zero rows)', () => {
    const r = planHealth({ adapters: [permits], runs: history(permits, 4, 0, { error: 'error: parsed 0 of 50 rows, shape may have changed' }), counts, now: NOW });
    expect(r.sources[0].problems).toEqual(['errored']);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain('parsed 0 of 50 rows');
  });

  it('counts sources with problems in the subject, singular and plural', () => {
    const one = planHealth({ adapters: [nws, spc], runs: [...history(nws), ...history(spc), { source: 'spc', started_at: ago(MIN), fetched: 0, inserted: 0, error: 'boom' }], counts, now: NOW });
    expect(one.subject).toBe('Holler health: 1 source needs attention');
    const three = planHealth({
      adapters: [nws, spc, permits],
      runs: [nws, spc, permits].map((a) => ({ source: a.id, started_at: ago(MIN), fetched: 0, inserted: 0, error: 'boom' })),
      counts,
      now: NOW,
    });
    expect(three.subject).toBe('Holler health: 3 sources need attention');
  });

  it('puts the scanner line first when nothing has run for a while, and counts it', () => {
    const old = [nws, spc].map((a) => ({ source: a.id, started_at: ago(5 * HOUR), fetched: 4, inserted: 0, error: null }));
    const r = planHealth({ adapters: [nws, spc], runs: old, counts, now: NOW });
    expect(r.problems[0]).toMatch(/^scanner: last scan ran 5 h ago/);
    expect(r.scanner.minutesSinceLastRun).toBe(300);
    expect(r.problemCount).toBe(3); // scanner, nws, spc
  });

  it('orders problems: errors first, then stale, then zero rows', () => {
    const runs = [
      ...history(permits, 4, 0, { inserted: 0 }),
      { source: 'spc', started_at: ago(10 * HOUR), fetched: 3, inserted: 0, error: null },
      { source: 'nws', started_at: ago(MIN), fetched: 0, inserted: 0, error: 'HTTP 500' },
    ];
    const r = planHealth({ adapters: [permits, spc, nws], runs, counts, now: NOW });
    const idx = (p: string) => r.problems.findIndex((l) => l.startsWith(p));
    expect(idx('nws:')).toBeLessThan(idx('spc:'));
    expect(idx('spc:')).toBeLessThan(idx('socrata-x-permits:'));
  });

  it('ignores _prune rows and sources that are no longer in the registry', () => {
    const runs = [...history(nws), { source: '_prune', started_at: ago(MIN), fetched: 0, inserted: 0, error: 'x' }, { source: 'retired', started_at: ago(MIN), fetched: 0, inserted: 0, error: 'x' }];
    const r = planHealth({ adapters: [nws], runs, counts, now: NOW });
    expect(r.ok).toBe(true);
    expect(r.sources).toHaveLength(1);
  });

  it('lists sources missing an env key as not configured, never as problems', () => {
    const r = planHealth({ adapters: [nws, sam], runs: history(nws), counts, now: NOW });
    expect(r.ok).toBe(true);
    expect(r.notConfigured).toEqual(['sam-gov: needs SAM_API_KEY']);
    expect(r.sources.find((s) => s.id === 'sam-gov')!.status).toBe('not_configured');
  });

  it('survives garbage rows', () => {
    const runs = [{ source: 'nws', started_at: 'nope', fetched: null, inserted: null, error: null }, { source: null, started_at: ago(MIN), fetched: 1, inserted: 1, error: null }] as HealthRun[];
    expect(() => planHealth({ adapters: [nws], runs, counts, now: NOW })).not.toThrow();
  });
});

describe('renderHealthEmail', () => {
  const bad = planHealth({
    adapters: [nws, spc, permits],
    runs: [...history(nws), { source: 'nws', started_at: ago(MIN), fetched: 0, inserted: 0, error: 'HTTP 503 <b>' }, ...history(permits, 4, 0)],
    counts,
    now: NOW,
  });
  it('puts problems first, one line each, and the counts after', () => {
    const m = renderHealthEmail(bad);
    expect(m.subject).toBe(bad.subject);
    expect(m.text.startsWith(bad.subject)).toBe(true);
    const problemsAt = m.text.indexOf('Needs attention');
    expect(problemsAt).toBeGreaterThan(-1);
    expect(problemsAt).toBeLessThan(m.text.indexOf('Last 24 hours'));
    for (const l of bad.problems) expect(m.text).toContain(`- ${l}`);
    expect(m.text).toContain('New signups: 4');
    expect(m.text).toContain('Active subscribers: 2 (in free trial: 9)');
    expect(m.text).toContain('Users emailed: 3');
  });
  it('is short and has no problem block when healthy', () => {
    const ok = planHealth({ adapters: [nws], runs: history(nws), counts, now: NOW });
    const m = renderHealthEmail(ok);
    expect(m.subject).toBe('Holler health: all sources OK');
    expect(m.text).not.toContain('Needs attention');
    expect(m.text.split('\n').length).toBeLessThan(14);
  });
  it('escapes html, never uses an em dash, and caps long lists', () => {
    const m = renderHealthEmail(bad);
    expect(m.html).not.toContain('<b>');
    expect(m.html).toContain('&lt;b&gt;');
    expect(m.text + m.html).not.toContain('—');
    const many = { ...bad, problems: Array.from({ length: 40 }, (_, i) => `s${i}: errored`) };
    const capped = renderHealthEmail(many, 25);
    expect(capped.text).toContain('...and 15 more');
  });
  it('shows unknown counts as unknown, not 0', () => {
    const m = renderHealthEmail({ ...bad, counts: { newSignups24h: null, activeSubscribers: null, trialing: null, usersEmailed24h: null } });
    expect(m.text).toContain('New signups: unknown');
  });
});

describe('formatAge', () => {
  it('uses minutes, hours, days', () => {
    expect(formatAge(50 * MIN)).toBe('50 min');
    expect(formatAge(5 * HOUR)).toBe('5 h');
    expect(formatAge(72 * HOUR)).toBe('3 days');
  });
});
