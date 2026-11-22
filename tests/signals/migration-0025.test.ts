/* eslint-disable @typescript-eslint/no-explicit-any */
// Migration 0025 run for real on PGlite (a Postgres in WebAssembly), on top of 0001..0023: idempotent, RLS on, service role only,
// the stage history outlives the signal (on delete set null), the link rows go with their signal. Skips when PGlite is not installed.
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { bootDb, hasPglite } from '../moat/pg';

const SQL = fs.readFileSync('supabase/migrations/0025_holler_permit_stages.sql', 'utf8');

it.skipIf(!hasPglite)('applies twice; RLS on; only service_role has privileges; stages survive a signal delete; links go with it; the stage check holds', async () => {
  const db = await bootDb('0025_zzz'); // boot applies every file up to and including 0025 once
  await db.exec(SQL); // the second time
  const tables = "('holler_permit_stages','holler_project_links','holler_dedupe_drops')";
  const rls = await db.query(`select relname, relrowsecurity from pg_class where relname in ${tables} order by 1`);
  expect(rls.rows.map((r: any) => r.relrowsecurity)).toEqual([true, true, true]);
  const grants = await db.query(`select distinct grantee from information_schema.role_table_grants where table_name in ${tables} and grantee in ('anon','authenticated','public')`);
  expect(grants.rows).toEqual([]);
  const svc = await db.query(`select table_name, string_agg(privilege_type, ',' order by privilege_type) p from information_schema.role_table_grants where table_name in ${tables} and grantee = 'service_role' group by 1 order by 1`);
  expect(svc.rows.map((r: any) => r.p)).toEqual(['DELETE,INSERT,SELECT,UPDATE', 'DELETE,INSERT,SELECT,UPDATE', 'DELETE,INSERT,SELECT,UPDATE']);

  await db.exec(`insert into holler_signals (source, external_id, kind, title, categories, severity, occurred_at) values ('s','1','permit','t','{}',1,now())`);
  const id = (await db.query(`select id from holler_signals`)).rows[0].id;
  await db.exec(`insert into holler_permit_stages (source, permit_id, stage, signal_id, emitted) values ('s','1','final_inspection',${id}, true)`);
  await db.exec(`insert into holler_project_links (project_key, source, external_id, signal_id, occurred_at, root_source, root_external_id) values ('k','s','1',${id}, now(), null, null)`);
  await db.exec(`delete from holler_signals`);
  const left = (await db.query(`select (select count(*)::int from holler_permit_stages) stages, (select count(*)::int from holler_project_links) links, (select count(*)::int from holler_permit_stages where signal_id is null) orphaned`)).rows[0];
  expect(left).toEqual({ stages: 1, links: 0, orphaned: 1 }); // the history stays, so a permit already updated is never updated again
  await expect(db.exec(`insert into holler_permit_stages (source, permit_id, stage) values ('s','2','final')`)).rejects.toThrow();
  await expect(db.exec(`insert into holler_permit_stages (source, permit_id, stage) values ('s','1','final_inspection')`)).rejects.toThrow(); // one row per (source, permit, stage)
}, 30_000); // explicit 30 s: booting PGlite and applying 25 migrations took over the default 5 s on a loaded machine (review P2-C)
