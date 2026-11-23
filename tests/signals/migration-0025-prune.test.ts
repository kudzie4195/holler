/* eslint-disable @typescript-eslint/no-explicit-any */
// REV2 probe M1 (review-STAGE-2.md), copied in as a regression test: migrations 0001..0025, then the REAL archive-and-prune function
// (0015 holler_prune_signals) and a plain delete. No FK error, the status history is kept (signal_id set to null), links and matches go.
// Skips when PGlite is not installed.
import { expect, it } from 'vitest';
import { bootDb, hasPglite } from '../moat/pg';

it.skipIf(!hasPglite)('REV2 M1: the real prune function after 0025: no FK error, history kept, links and matches of a pruned signal go', async () => {
  const db = await bootDb('0025_zzz');
  await db.exec(`insert into auth.users(id,email) values ('00000000-0000-0000-0000-000000000001','a@example.com')`);
  await db.exec(`insert into holler_signals (source, external_id, kind, title, categories, severity, occurred_at, data) values
    ('socrata-norfolk-permits','OLD-ROOT','permit','t','{}',1, now() - interval '200 days', '{}'),
    ('socrata-norfolk-permits','FOLLOWER','permit','t','{}',1, now() - interval '10 days', '{"projectOf":"socrata-norfolk-permits:OLD-ROOT"}'),
    ('socrata-norfolk-permits','FUTURE','permit','t','{}',1, now() + interval '400 days', '{}')`);
  const ids = Object.fromEntries((await db.query(`select external_id, id from holler_signals`)).rows.map((r: any) => [r.external_id, r.id]));
  await db.exec(`insert into holler_permit_stages (source, permit_id, stage, signal_id, emitted) values ('socrata-norfolk-permits','OLD-ROOT','finaled',${ids['OLD-ROOT']},true), ('socrata-norfolk-permits','FUTURE','issued',${ids.FUTURE},false)`);
  await db.exec(`insert into holler_project_links (project_key, source, external_id, signal_id, occurred_at, root_source, root_external_id) values
    ('k','socrata-norfolk-permits','OLD-ROOT',${ids['OLD-ROOT']}, now() - interval '200 days', null, null),
    ('k','socrata-norfolk-permits','FOLLOWER',${ids.FOLLOWER}, now() - interval '199 days', 'socrata-norfolk-permits','OLD-ROOT')`);
  await db.exec(`insert into holler_matches (user_id, signal_id) values ('00000000-0000-0000-0000-000000000001', ${ids['OLD-ROOT']})`);
  await db.query(`select * from holler_prune_signals(now() - interval '120 days', now() + interval '365 days')`);
  const left = (await db.query(`select
     (select string_agg(external_id, ',' order by external_id) from holler_signals) signals,
     (select string_agg(permit_id || ':' || coalesce(signal_id::text,'null'), ',' order by permit_id) from holler_permit_stages) stages,
     (select string_agg(external_id || '->' || coalesce(root_external_id,'-'), ',') from holler_project_links) links,
     (select count(*)::int from holler_matches) matches`)).rows[0];
  expect(left.signals).toBe('FOLLOWER');
  expect(left.stages).toBe('FUTURE:null,OLD-ROOT:null'); // the history outlives the signal
  // the follower outlives its root: its link still names the root. The scan treats that as an orphan (projects.ts stages(): the follower stands on its own)
  expect(left.links).toBe('FOLLOWER->OLD-ROOT');
  expect(left.matches).toBe(0);
}, 60_000);
