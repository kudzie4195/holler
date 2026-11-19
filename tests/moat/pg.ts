/* eslint-disable @typescript-eslint/no-explicit-any */
// PGlite lives in /home/claude/gates/pg (the repo has no database package and packages may not change). Tests that need it skip
// cleanly when it is not there; the gate always has it.
import fs from 'node:fs';
import path from 'node:path';

const PGLITE = '/home/claude/gates/pg/node_modules/@electric-sql/pglite/dist/index.js';
export const hasPglite = fs.existsSync(PGLITE);
const MIG = path.join(__dirname, '../../supabase/migrations');

export async function bootDb(upTo = '0015_zzz'): Promise<any> {
  const { PGlite } = await import(/* @vite-ignore */ PGLITE);
  const db = new PGlite();
  await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema public, auth to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter role service_role bypassrls; grant usage on schema public, auth to service_role;`);
  const files = fs.readdirSync(MIG).filter((f) => f.endsWith('.sql') && f <= upTo).sort();
  for (const f of files) await db.exec(fs.readFileSync(path.join(MIG, f), 'utf8'));
  return db;
}
