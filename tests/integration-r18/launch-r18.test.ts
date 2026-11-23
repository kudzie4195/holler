// Round 18 integration, Part C, merged with round 19 at integration (INT step 1): ONE "Rounds 18 and 19 order" block in LAUNCH.md, in the
// agreed order, each step with its reason; what is already applied live is said once; every NEEDS KUDZI item of both rounds is kept.
import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';

const md = readFileSync('LAUNCH.md', 'utf8');
const block = md.slice(md.indexOf('**Rounds 18 and 19 order**'), md.indexOf('**NEEDS KUDZI (rounds 18 and 19'));
const kudzi = md.slice(md.indexOf('**NEEDS KUDZI (rounds 18 and 19'), md.indexOf('- [ ] Run `supabase/migrations/0001_holler.sql`'));

it('LAUNCH.md has exactly one combined block and no separate round 18 or round 19 order block', () => {
  expect(md.split('**Rounds 18 and 19 order**').length - 1).toBe(1);
  expect(md).not.toContain('**Round 18 order**');
  expect(md).not.toMatch(/\*\*Round 19 order/);
  expect(md.split('**NEEDS KUDZI').length - 1).toBe(1);
  expect(block.length).toBeGreaterThan(1000);
});

it('already applied live: 0021 to 0025 and the SQL of 0031 and 0032, said before the steps', () => {
  const head = block.slice(0, block.indexOf('\n1. '));
  expect(head).toMatch(/Already applied on the live database, nothing to run: 0021, 0022, 0023, 0024 and 0025, and the SQL of 0031 .* and 0032/);
  expect(head).toMatch(/migration 0024 .* is already applied on the live database/);
});

it('the steps in order, each with a reason: 0028 before, 0030 any time, deploy, 0028 again, probe then 0026, DeKalb then 0027, switches, scorecard, samples, coverage probes, store, language', () => {
  const steps = [...block.matchAll(/^(\d+)\. (.*)$/gm)].map((m) => [Number(m[1]), m[2]] as const);
  expect(steps.map(([n]) => n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const want = [
    /^Run 0028 .*BEFORE the deploy/,
    /^Run 0030 .*any time/,
    /^Deploy the rounds 18 and 19 code/,
    /^Run 0028 AGAIN right after the deploy/,
    /^Run the lookup probe on two businesses you know; only if BOTH return `found`, run 0026/,
    /^Check one live DeKalb permit read for the site-address field; then run 0027/,
    /^Leave `HOLLER_VIOLATION_OWNERS_ENABLED`, `HOLLER_STAGE_UPDATES_ENABLED` and `HOLLER_BUILDERS_PANEL_ENABLED` unset/,
    /^The per-metro scorecard/,
    /^NEEDS KUDZI, after a few days: read the Philadelphia samples/,
    /^NEEDS KUDZI, right after the deploy: probe each of the eight coverage sources once: `curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>\/api\/admin\/coverage-probe\?source=<id>"`/,
    /^NEEDS KUDZI: recapture the store price screenshots; the store listing text and the intro offers still say 14 days; read the new privacy sentence/,
    /^Optional, after the deploy: .*holler_language/,
  ];
  steps.forEach(([, text], i) => {
    expect(text).toMatch(want[i]);
    expect(text, `step ${i + 1} has a reason`).toMatch(/ Why: /);
  });
  expect(block).toMatch(/Migration number 0029 is unused/);
});

it('every migration still to run is named in the steps, and every migration file is in the folder once', () => {
  for (const m of ['0026', '0027', '0028', '0030']) expect(block, m).toContain(`${m}_holler_`);
  const files = readdirSync('supabase/migrations').filter((f) => /^\d{4}_.*\.sql$/.test(f));
  const nums = files.map((f) => f.slice(0, 4));
  expect(new Set(nums).size).toBe(nums.length);
  for (const n of ['0021', '0022', '0023', '0024', '0025', '0026', '0027', '0028', '0030', '0031', '0032']) expect(nums, n).toContain(n);
  expect(nums).not.toContain('0029');
});

it('NEEDS KUDZI keeps every item of both rounds', () => {
  for (const s of [
    'Recapture the 08-price screenshots',
    'App Store Connect and Play Console listing text',
    'Introductory offers on the four subscriptions',
    'RevenueCat dashboard',
    'Read the new privacy sentence',
    "decide on \"Who's building near you\" (`HOLLER_BUILDERS_PANEL_ENABLED`",
    'read the Philadelphia probation samples',
    'NYC registration read',
  ]) expect(kudzi, s).toContain(s);
  expect(kudzi).toMatch(/shows 48 of 60/);
});

it('round 19 coverage (INT step 2): the eight sources are named in the deploy step, the probe step says what a good result is, defers the two promotion steps and needs both flags removed; the coverage checklist is in the one NEEDS KUDZI list', () => {
  const ids = ['socrata-dallas-permits', 'arcgis-arlington-permits', 'arcgis-miamidade-permits', 'arcgis-miamidade-violations', 'arcgis-miamidade-building-violations', 'arcgis-phoenix-permits', 'arcgis-tempe-permits', 'arcgis-houston-311'];
  const step3 = block.slice(block.indexOf('\n3. '), block.indexOf('\n4. '));
  for (const id of ids) expect(step3, id).toContain(`\`${id}\``);
  const step10 = block.slice(block.indexOf('\n10. '), block.indexOf('\n11. '));
  expect(step10).toMatch(/A good result: `httpStatus` 200, `rowCount` 5, `schema` "ok"/);
  expect(step10).toMatch(/Dallas shows `freshness` "stale"/);
  expect(step10).toMatch(/`rowCapNote`, paging must be added before promotion/);
  expect(step10).toMatch(/BOTH flags removed .*`probation: true` AND `schemaUnverified: true`/);
  expect(md).not.toContain('**NEEDS KUDZI: Round 19 coverage');
  for (const s of ['Round 19 coverage: For each source run', 'Round 19 coverage: A good result', 'Round 19 coverage: Daily,', 'Round 19 coverage: To promote one', 'Round 19 coverage, contractor names']) expect(kudzi, s).toContain(s);
});
