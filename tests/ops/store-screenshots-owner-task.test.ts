// Review r18 TRIAL F3: the committed 08-price store screenshots still show the 14-day trial and cannot be recaptured here (no
// mobile/node_modules). mobile/store/check-screenshots.py stays red ON PURPOSE (a store submission must not go out with them) and says
// why; nothing in the web gates may depend on it; LAUNCH.md lists the recapture as an owner task.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const read = (f: string) => readFileSync(path.join(root, f), 'utf8');
const STORE_SCRIPTS = /check-screenshots\.py|make-screenshots\.py|build-captures\.sh/;

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe('store screenshots: a known owner task, outside the web gates', () => {
  it('no npm script, web config or web test runs the screenshot scripts', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
    for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) expect(cmd, name).not.toMatch(STORE_SCRIPTS);
    for (const f of ['vitest.config.ts', 'next.config.ts', 'eslint.config.mjs', 'tsconfig.json']) expect(read(f), f).not.toMatch(STORE_SCRIPTS);
    const self = path.join(root, 'tests/ops/store-screenshots-owner-task.test.ts');
    const runners = walk(path.join(root, 'tests')).filter((f) => f !== self && /\.(ts|tsx|mjs|js)$/.test(f) && /\b(execSync|execFileSync|spawnSync|spawn|exec)\(/.test(readFileSync(f, 'utf8')));
    for (const f of runners) expect(readFileSync(f, 'utf8'), path.relative(root, f)).not.toMatch(STORE_SCRIPTS);
  });

  it('the checker still exits 1 on a failure, and names the stale 08-price shots as a known owner task', () => {
    const py = read('mobile/store/check-screenshots.py');
    expect(py).toContain('sys.exit(1 if fail else 0)');
    expect(py).toContain('KNOWN OWNER TASK (round 18)');
    expect(py).toContain('Recapture the 08-price screenshots before ANY store submission');
  });

  it('LAUNCH.md lists the recapture under NEEDS KUDZI', () => {
    const launch = read('LAUNCH.md');
    const block = launch.slice(launch.indexOf('**NEEDS KUDZI (rounds 18 and 19'));
    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain('Recapture the 08-price screenshots before ANY store submission');
  });
});
