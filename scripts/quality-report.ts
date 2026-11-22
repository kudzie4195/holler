/**
 * Read-only run of the alert-quality dashboard numbers (PLAN-2.0 item 3.4, round 15 unit H) over rows copied from the live database.
 *
 * Input: scripts/fixtures/quality-live/live.json, copied from READ-ONLY `select` results (the same columns, filters and tables that
 * lib/admin/quality-load.ts reads through supabase-js). Output: /home/claude/gates/r15/H-dashboard.md (or the path given as the first
 * argument). The numbers come from the real lib/admin/quality.ts buildQualityReport. Nothing here touches a database, network or clock.
 *
 *   JITI_TSCONFIG_PATHS=1 node node_modules/jiti/lib/jiti-cli.mjs scripts/quality-report.ts [out.md]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildQualityReport, type QualityInputs } from '../lib/admin/quality';

const live = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'quality-live', 'live.json'), 'utf8')) as Omit<QualityInputs, 'now'> & { now: string; note: string };
const report = buildQualityReport({ ...live, now: new Date(live.now) });
const pct = (v: number | null) => (v === null ? '-' : `${Math.round(v * 100)}%`);
const rows = [report.all, ...report.trades];
const out = [
  '# H-dashboard: alert-quality numbers, one read-only run against live data',
  '',
  `Run time: ${report.generatedAt} (database clock). Window: ${report.windowDays} days, since ${report.since}. Code: lib/admin/quality.ts (numbers), lib/admin/quality-load.ts (the selects), route /api/admin/quality (owner only).`,
  `Inputs (sourced): ${live.note}`,
  '',
  `Sections read: ${Object.entries(report.sections).map(([k, v]) => `${k}=${v}`).join(', ')}.`,
  '',
  '| Trade | Members (with access) | Sent | Act now | Coming soon | Market insight | Context | Useful share | Answers | Not relevant | New members | With a useful card | Within 24 h | Median h | P90 h |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((t) => `| ${t.trade} | ${t.members} (${t.membersWithAccess}) | ${t.sent.total} | ${t.sent.act_now} | ${t.sent.coming_soon} | ${t.sent.market_insight} | ${t.sent.context} | ${pct(t.sent.usefulShare)} | ${t.feedback.answered} | ${pct(t.feedback.falsePositiveRate)} | ${t.firstCard.newMembers} | ${t.firstCard.withUsefulCard} | ${t.firstCard.within24h} | ${t.firstCard.medianHours ?? '-'} | ${t.firstCard.p90Hours ?? '-'} |`),
  '',
  '## Notes from the report',
  '',
  ...(report.notes.length ? report.notes.map((n) => `- ${n}`) : ['- none']),
  '',
  '## Raw report (JSON)',
  '',
  '```json',
  JSON.stringify(report, null, 2),
  '```',
  '',
].join('\n');
const target = process.argv[2] ?? '/home/claude/gates/r15/H-dashboard.md';
writeFileSync(target, out);
console.log(`wrote ${target}`);
