// Round 19 UNIFY: after merging the other branch, one label engine. Nothing in the product imports their engine, their NYC agent join or
// anything under reference/ (kept unchanged there for a later comparison, outside the build, the typecheck, lint and the default tests).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mjs)$/.test(n) ? [p] : [];
  });
}

describe('one engine after the merge', () => {
  it('no product file imports opportunity.ts, member-opportunity.ts, the NYC agent join or reference/', () => {
    const bad = /from\s+['"][^'"]*(signals\/(member-)?opportunity|\/(member-)?opportunity'|nyc-agents|nyc-hpd-agents|reference\/)/;
    const offenders = ['app', 'lib', 'components', 'scripts', 'tests'].flatMap(files).filter((f) => bad.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the other engine is kept, unchanged in place, under reference/r10-engine', () => {
    for (const f of ['lib/signals/opportunity.ts', 'lib/signals/member-opportunity.ts', 'scripts/opportunity-replay.ts', 'scripts/match-replay.ts', 'tests/signals/opportunity.test.ts', 'tests/signals/opportunity-surfaces.test.ts']) {
      expect(statSync(join('reference/r10-engine', f)).isFile(), f).toBe(true);
    }
    expect(readFileSync('tsconfig.json', 'utf8')).toMatch(/"exclude": \[[^\]]*"reference"/);
    expect(readFileSync('eslint.config.mjs', 'utf8')).toMatch(/"reference\/\*\*"/);
    expect(readFileSync('vitest.config.ts', 'utf8')).toMatch(/include: \['tests\/\*\*\/\*\.test\.ts'\]/);
  });
});
