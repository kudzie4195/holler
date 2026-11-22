// Round 18 integration, Part C: one "Round 18 order" block in LAUNCH.md, in the agreed order, each step with its reason.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const md = readFileSync('LAUNCH.md', 'utf8');

it('LAUNCH.md has exactly one Round 18 order block with the seven steps in order, each with a reason, and the 0029 line', () => {
  expect(md.split('**Round 18 order**').length - 1).toBe(1);
  const block = md.slice(md.indexOf('**Round 18 order**'), md.indexOf('**NEEDS KUDZI (round 18'));
  const steps = [...block.matchAll(/^(\d)\. (.*)$/gm)].map((m) => [Number(m[1]), m[2]] as const);
  expect(steps.map(([n]) => n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  const want = [/^Run 0028 .*before the deploy and again right after it/, /^Run 0030 .*any time/, /^Deploy/, /^Run the lookup probe on two businesses you know; only if BOTH return `found`, run 0026/, /^Check one live DeKalb permit read for the site-address field; then run 0027/, /^Leave `HOLLER_VIOLATION_OWNERS_ENABLED` and `HOLLER_STAGE_UPDATES_ENABLED` unset/, /^NEEDS KUDZI: recapture the store price screenshots; the store listing text and the intro offers still say 14 days/];
  steps.forEach(([, text], i) => {
    expect(text).toMatch(want[i]);
    expect(text, `step ${i + 1} has a reason`).toMatch(/ Why: /);
  });
  expect(block).toMatch(/Migration number 0029 is unused/);
});
