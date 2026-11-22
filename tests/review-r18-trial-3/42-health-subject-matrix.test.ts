// Round 18 integration: review 3 probe (logs/REV3-TRIAL-probe-tests) kept as a permanent regression test.
// REV3 probe 42 (r18 TRIAL, commit b99347a): the health email subject in every combination of
//   run-level problems (0, 1, 2)  x  source states (absent, 0 behind, 1 behind, 3 behind)  x  trial check (absent, ok, mismatch, not_applied, error).
// Rule under test (review r2 R6): the trial part REPLACES only the all-clear and is APPENDED to any other subject.
// Writes the table to $REV3_LOGS/REV3-TRIAL-health-subjects.md only when REV3_LOGS is set (round 18 integration: never by default).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadTrialDbCheck, type TrialDbCheck } from '../../lib/auth/trial-check';
import { planHealth, renderHealthEmail, type HealthCounts, type HealthReport } from '../../lib/email/health';

const LOGS = process.env.REV3_LOGS;
const NOW = new Date('2026-11-22T13:03:00.000Z');
const counts: HealthCounts = { newSignups24h: 1, activeSubscribers: 2, trialing: 3, usersEmailed24h: 4 };
const okRun = { source: null, started_at: new Date(NOW.getTime() - 60_000).toISOString(), fetched: 1, inserted: 1, error: null };
const base = (problems: number): HealthReport =>
  planHealth({ adapters: Array.from({ length: problems }, (_, i) => ({ id: `x${i}`, label: `X${i}`, kind: 'permit', cadenceMinutes: 15 })) as any, runs: problems ? [] : [okRun], counts, now: NOW });
const rpc = (data: unknown, error: any = null) => ({ rpc: async () => ({ data, error }) });
const states = (behind: number) => ({ total: 5, behind, counts: { healthy: 5 - behind, delayed: behind, degraded: 0, unavailable: 0, not_set_up: 0 }, attention: [], quiet: [] }) as any;

describe('REV3 health email subject: every state', () => {
  it('composition table', async () => {
    const trial: [string, TrialDbCheck | null | undefined][] = [
      ['absent', undefined],
      ['ok (60/60/60)', await loadTrialDbCheck(rpc({ default_days: 60, stamp_cap_days: 60, guard_cap_days: 60 }))],
      ['mismatch (14/14/14)', await loadTrialDbCheck(rpc({ default_days: 14, stamp_cap_days: 14, guard_cap_days: 14 }))],
      ['not_applied (PGRST202)', await loadTrialDbCheck(rpc(null, { code: 'PGRST202' }))],
      ['not_applied (42883)', await loadTrialDbCheck(rpc(null, { code: '42883' }))],
      ['error (timeout)', await loadTrialDbCheck(rpc(null, { code: '57014' }))],
    ];
    const T = { mm: 'free trial length does not match the database', err: 'could not check the free trial length' };
    const rows: string[] = ['| run-level problems | sources behind | trial check | subject |', '|---|---|---|---|'];
    const seen = new Set<string>();
    for (const problems of [0, 1, 2]) for (const behind of [null, 0, 1, 3]) for (const [name, tc] of trial) {
      const r = base(problems);
      expect(r.problemCount).toBe(problems === 0 ? 0 : r.problemCount); // sanity
      if (behind !== null) r.sourceStates = states(behind);
      if (tc !== undefined) r.trialCheck = tc;
      const m = renderHealthEmail(r);
      const sourcePart =
        r.problemCount > 0 ? `Holler health: ${r.problemCount} ${r.problemCount === 1 ? 'source needs' : 'sources need'} attention`
        : behind ? `Holler health: ${behind} ${behind === 1 ? 'source is' : 'sources are'} behind on data`
        : 'Holler health: all sources OK';
      const part = !tc || tc.status === 'ok' ? null : tc.status === 'error' ? T.err : T.mm;
      const want = !part ? sourcePart : sourcePart === 'Holler health: all sources OK' ? `Holler health: ${part}` : `${sourcePart}; ${part}`;
      expect(m.subject, `${problems}/${behind}/${name}`).toBe(want);
      // never an all-clear over a trial problem, never the source problem dropped, one "Holler health:" prefix, a sane length
      if (part) expect(m.subject).not.toContain('all sources OK');
      if (sourcePart !== 'Holler health: all sources OK') expect(m.subject.startsWith(sourcePart)).toBe(true);
      expect(m.subject.match(/Holler health:/g)).toHaveLength(1);
      expect(m.subject.length).toBeLessThan(120);
      expect(m.subject).not.toMatch(/[\r\n]/);
      expect(m.text.split('\n')[0]).toBe(m.subject);
      if (tc) expect(m.text).toContain('Free trial length');
      rows.push(`| ${r.problemCount} | ${behind === null ? 'not read' : behind} | ${name} | ${m.subject} |`);
      seen.add(m.subject);
    }
    if (LOGS) writeFileSync(`${LOGS}/REV3-TRIAL-health-subjects.md`, ['# REV3 TRIAL: health email subject in every state (b99347a)', '', ...rows, '', `Distinct subjects: ${seen.size}`, ...[...seen].sort().map((s) => `- ${s}`), ''].join('\n'));
    expect(rows.length).toBe(2 + 3 * 4 * 6);
  });
});
