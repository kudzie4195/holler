// Round 24 FIX3 (review-FIX2 F10): when the 14-day export is absent, tests/r24/check-delivery.test.ts says so by name in the run output.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('F10: the D1 export cases skip visibly', () => {
  it('a run without the export lists a skip named "NEEDS the 14-day export ... NOT RUN"', () => {
    let out = '';
    try {
      out = execFileSync(
        process.execPath,
        ['node_modules/vitest/vitest.mjs', 'run', 'tests/r24/check-delivery.test.ts', '--reporter=verbose', '--pool=forks', '--maxWorkers=1'],
        { env: { ...process.env, HOLLER_D1_EXPORT: '/nonexistent/holler-fix3/signals-14d.json', NO_COLOR: '1', FORCE_COLOR: '0' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 170_000 },
      );
    } catch (e) {
      out = `${(e as { stdout?: string }).stdout ?? ''}${(e as { stderr?: string }).stderr ?? ''}`;
      throw new Error(`nested run failed:\n${out.slice(-3000)}`);
    }
    expect(out).toContain('NEEDS the 14-day export at /nonexistent/holler-fix3/signals-14d.json (not found, so NOT RUN): every D1 case on real records');
    expect(out).toMatch(/1 skipped|skipped/);
  }, 180_000);
});
