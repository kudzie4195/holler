/* eslint-disable @typescript-eslint/no-explicit-any */
// Migration 0026 run for real on PGlite on top of 0001..0025: idempotent, RLS on, nothing for anon or authenticated, service role only,
// the status and shape checks hold. Skips when PGlite is not installed.
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { bootDb, hasPglite } from '../moat/pg';

const SQL = fs.readFileSync('supabase/migrations/0026_holler_business_lookup.sql', 'utf8');

it('0026 only creates holler_ objects and has no grant to anon or authenticated', () => {
  for (const m of SQL.matchAll(/create (?:table|index|unique index) if not exists (?:public\.)?(\w+)/g)) expect(m[1].startsWith('holler_')).toBe(true);
  expect(SQL).not.toMatch(/grant[^;]*\b(anon|authenticated)\b/i);
  expect(SQL).toMatch(/enable row level security/);
});

it.skipIf(!hasPglite)('applies twice; RLS on; only service_role has privileges; the checks hold; upsert on the key works', async () => {
  const db = await bootDb('0026_zzz');
  await db.exec(SQL);
  const rls = await db.query(`select relrowsecurity from pg_class where relname = 'holler_business_lookup'`);
  expect(rls.rows.map((r: any) => r.relrowsecurity)).toEqual([true]);
  const grants = await db.query(`select distinct grantee from information_schema.role_table_grants where table_name = 'holler_business_lookup' and grantee in ('anon','authenticated','public')`);
  expect(grants.rows).toEqual([]);
  const svc = await db.query(`select string_agg(privilege_type, ',' order by privilege_type) p from information_schema.role_table_grants where table_name = 'holler_business_lookup' and grantee = 'service_role'`);
  expect(svc.rows[0].p).toBe('DELETE,INSERT,SELECT,UPDATE');

  await db.exec(`insert into holler_business_lookup (name_key, city_key, state, status, phone, website, listing_name) values ('peachtree roofing','atlanta','GA','found','404-555-0123',null,'Peachtree Roofing')`);
  await db.exec(`insert into holler_business_lookup (name_key, city_key, state, status) values ('gallagher roofing','atlanta','GA','not_found')`);
  await db.exec(`insert into holler_business_lookup (name_key, city_key, state, status) values ('peachtree roofing','atlanta','GA','not_found') on conflict (name_key, city_key, state) do update set status = excluded.status, phone = null, website = null, listing_name = null`);
  expect((await db.query(`select status from holler_business_lookup where name_key = 'peachtree roofing'`)).rows[0].status).toBe('not_found');
  await expect(db.exec(`insert into holler_business_lookup (name_key, city_key, state, status) values ('a b','x','GA','maybe')`)).rejects.toThrow();
  await expect(db.exec(`insert into holler_business_lookup (name_key, city_key, state, status) values ('a b','x','GA','found')`)).rejects.toThrow(); // found needs a phone or website
  await expect(db.exec(`insert into holler_business_lookup (name_key, city_key, state, status, phone) values ('a c','x','GA','not_found','404-555-0123')`)).rejects.toThrow();
  await expect(db.exec(`insert into holler_business_lookup (name_key, city_key, state, status) values ('a d','x','Georgia','not_found')`)).rejects.toThrow();
}, 30_000);
