/* eslint-disable @typescript-eslint/no-explicit-any */
// Migration 0038 (free trial 30 days, round 23) run for real on PGlite on top of 0001..0037: the column default, the one-trial cap and
// the member-insert guard move to 30 days, holler_trial_db_check() reads them back as 30, a row inserted afterwards gets 30 days, and —
// the point of the whole migration — NOT ONE EXISTING PROFILE IS TOUCHED. Every trial_ends_at and every holler_lifecycle_sends row is
// compared byte for byte before and after, with 60-day, 14-day and 7-day trials, running and ended, paying, store-billed and returning
// members in the set. The app side of the same promise (lib/auth/trial.ts never cuts a 60-day trial back to 30) is checked here too.
// Skips when PGlite is not installed.
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { bootDb, hasPglite } from '../moat/pg';
import { TRIAL_DAYS, TRIAL_MAX_DAYS, trialCapFromStart, trialEndFromStart } from '../../lib/auth/membership';
import { mayExtendTrial } from '../../lib/auth/trial';

const SQL = fs.readFileSync('supabase/migrations/0038_holler_trial_30.sql', 'utf8');
const SQL_0028 = fs.readFileSync('supabase/migrations/0028_holler_trial_60.sql', 'utf8');

const id = (n: number) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;

/** Every profile row that matters here, exactly as stored (text, so microseconds are compared too). */
async function rows(db: any): Promise<unknown[]> {
  return (
    await db.query(
      `select user_id::text u, created_at::text c, trial_ends_at::text e, plan, subscription_status, stripe_customer_id,
              stripe_subscription_id, plan_source, store_product_id, store_expires_at::text se
         from holler_profiles order by 1`,
    )
  ).rows;
}

async function sends(db: any): Promise<unknown[]> {
  return (await db.query(`select user_id::text u, kind from holler_lifecycle_sends order by 1, 2`)).rows;
}

it.skipIf(!hasPglite)('0038: 30 days in all three places, and every trial that already exists keeps its exact end date', async () => {
  const db = await bootDb('0037_zzz'); // the database as it is in production today (0028 applied: 60-day trials)

  // [n, stamp days ago | null | 'bad', created days ago, ends in days from now, extra columns]
  // The "ends in" values are what a 60-day (0028), 14-day (0019) or 7-day (0001) trial looks like today.
  const set: [number, number | null | 'bad', number, number, string][] = [
    [1, null, 5, 55, ''], // 60-day trial running, 55 days left
    [2, null, 55, 5, ''], // 60-day trial running, 5 days left
    [3, null, 70, -10, ''], // 60-day trial ended 10 days ago
    [4, null, 10, 50, `, subscription_status = 'active', stripe_subscription_id = 'sub_4'`], // paying
    [5, null, 10, 50, `, plan_source = 'apple'`], // store-billed
    [6, null, 20, -6, `, subscription_status = 'canceled'`], // canceled
    [7, 90, 2, -32, ''], // came back: new row cut to stamp + 60, already past
    [8, 'bad', 5, 55, ''], // unreadable stamp
    [9, null, 50, -36, ''], // old 14-day trial, long ended
    [10, null, 3, 11, ''], // old 14-day trial still running (11 days left)
    [11, null, 1, 6, ''], // old 7-day trial still running
    [12, null, 1, 29, ''], // exactly what a NEW 30-day trial will look like
  ];
  for (const [n, stamp] of set) {
    const meta =
      stamp === null
        ? `'{}'::jsonb`
        : stamp === 'bad'
          ? `'{"holler_trial_started_at":"garbage"}'::jsonb`
          : `jsonb_build_object('holler_trial_started_at', (now() - interval '${stamp} days')::text)`;
    await db.exec(`insert into auth.users (id, email, raw_app_meta_data) values ('${id(n)}', 'u${n}@example.test', ${meta})`);
  }
  for (const [n, , created, end] of set) {
    await db.exec(
      `insert into holler_profiles (user_id, business_name, created_at, trial_ends_at) values ('${id(n)}', 'Biz ${n}', now() - interval '${created} days', now() + interval '${end} days')`,
    );
  }
  for (const [n, , , , extra] of set) if (extra) await db.exec(`update holler_profiles set ${extra.slice(2)} where user_id = '${id(n)}'`);
  for (const n of [1, 3, 10]) {
    await db.exec(`insert into holler_lifecycle_sends (user_id, kind) values ('${id(n)}', 'welcome'), ('${id(n)}', 'trial_ending'), ('${id(n)}', 'trial_ended')`);
  }

  // Before: the database is at 60 days and these are the stored rows.
  expect((await db.query(`select public.holler_trial_db_check() c`)).rows[0].c).toEqual({ default_days: 60, stamp_cap_days: 60, guard_cap_days: 60 });
  const before = await rows(db);
  const sendsBefore = await sends(db);
  expect(before).toHaveLength(set.length);

  await db.exec(SQL);

  // THE POINT: not one existing row moved, and no lifecycle row was cleared.
  expect(await rows(db)).toEqual(before);
  expect(await sends(db)).toEqual(sendsBefore);

  // The three places say 30, read back from the catalog by 0028's own check function (its body is unchanged).
  const def = (
    await db.query(
      `select pg_get_expr(adbin, adrelid) e from pg_attrdef a join pg_attribute t on t.attrelid = a.adrelid and t.attnum = a.adnum
        where t.attrelid = 'public.holler_profiles'::regclass and t.attname = 'trial_ends_at'`,
    )
  ).rows[0].e;
  expect(def).toContain('30 days');
  expect((await db.query(`select public.holler_trial_db_check() c`)).rows[0].c).toEqual({
    default_days: TRIAL_DAYS,
    stamp_cap_days: TRIAL_DAYS,
    guard_cap_days: TRIAL_DAYS,
  });

  // A profile created from here forward gets 30 days; a returning person's new row is still cut to stamp + 30 (one trial per person).
  await db.exec(`insert into auth.users (id, email) values ('${id(50)}', 'u50@example.test')`);
  await db.exec(`insert into holler_profiles (user_id, business_name) values ('${id(50)}', 'New')`);
  await db.exec(
    `insert into auth.users (id, email, raw_app_meta_data) values ('${id(51)}', 'u51@example.test', jsonb_build_object('holler_trial_started_at', (now() - interval '20 days')::text))`,
  );
  await db.exec(`insert into holler_profiles (user_id, business_name) values ('${id(51)}', 'Back')`);
  const days = async (n: number) =>
    (await db.query(`select round(extract(epoch from (trial_ends_at - now())) / 3600.0)::int h from holler_profiles where user_id = '${id(n)}'`)).rows[0].h / 24;
  expect(await days(50)).toBe(30);
  expect(await days(51)).toBe(10); // stamp + 30

  // Still nothing moved on the old rows after those inserts.
  expect((await rows(db)).filter((r: any) => Number(r.u.slice(-2)) < 50)).toEqual(before);

  // Idempotent.
  await db.exec(SQL);
  expect((await rows(db)).filter((r: any) => Number(r.u.slice(-2)) < 50)).toEqual(before);
  expect(await sends(db)).toEqual(sendsBefore);

  // Privileges unchanged: the check is service role only, the two trigger functions stay revoked from members.
  expect((await db.query(`select r, has_function_privilege(r, 'public.holler_trial_db_check()', 'execute') ok from unnest(array['anon','authenticated','service_role']) r order by 1`)).rows).toEqual([
    { r: 'anon', ok: false },
    { r: 'authenticated', ok: false },
    { r: 'service_role', ok: true },
  ]);
  for (const fn of ['holler_profiles_trial_from_stamp()', 'holler_profiles_billing_guard()']) {
    const g = (await db.query(`select bool_or(has_function_privilege(r, 'public.${fn}', 'execute')) any from unnest(array['anon','authenticated']) r`)).rows[0].any;
    expect(g, fn).toBe(false);
  }

  // Rollback really is "run 0028 again".
  await db.exec(SQL_0028);
  expect((await db.query(`select public.holler_trial_db_check() c`)).rows[0].c).toEqual({ default_days: 60, stamp_cap_days: 60, guard_cap_days: 60 });
}, 90_000);

it.skipIf(!hasPglite)('0038: a member inserting their own profile gets 30 days and cannot ask for more', async () => {
  const db = await bootDb('0038_zzz');
  const uid = id(30);
  await db.exec(`insert into auth.users (id, email) values ('${uid}', 'u30@example.test')`);
  const asMember = async (sql: string) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false); select set_config('request.jwt.claim.role', 'authenticated', false);`);
    try {
      await db.exec(sql);
    } finally {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);`);
    }
  };
  await expect(
    asMember(`insert into holler_profiles (user_id, business_name, trial_ends_at) values ('${uid}', 'Mine', now() + interval '31 days')`),
  ).rejects.toThrow(/billing fields are set by the server only|permission denied/);
  await asMember(`insert into holler_profiles (user_id, business_name) values ('${uid}', 'Mine')`);
  const h = (await db.query(`select round(extract(epoch from (trial_ends_at - now())) / 3600.0)::int h from holler_profiles where user_id = '${uid}'`)).rows[0].h;
  expect(h / 24).toBe(30);
  await expect(asMember(`update holler_profiles set trial_ends_at = now() + interval '90 days' where user_id = '${uid}'`)).rejects.toThrow();
}, 90_000);

it('the app never shortens a trial a member already holds (lib/auth/trial.ts, TRIAL_MAX_DAYS)', () => {
  expect(TRIAL_DAYS).toBe(30);
  expect(TRIAL_MAX_DAYS).toBe(60);
  const NOW = Date.parse('2026-12-01T00:00:00.000Z');
  const DAY = 86_400_000;
  const start = new Date(NOW - 10 * DAY).toISOString();
  const row = (endsInDays: number) => ({
    created_at: start,
    trial_ends_at: new Date(NOW + endsInDays * DAY).toISOString(),
    subscription_status: 'trialing',
    stripe_subscription_id: null,
    plan_source: 'none',
  });

  // A 60-day trial started 10 days ago has 50 days left. It is NOT extended (it is already past start + 30) ...
  expect(mayExtendTrial(row(50), start, NOW)).toBe(false);
  // ... and it is NOT cut back either: the cut-back threshold is start + 60 days, which is exactly where it sits.
  expect(Date.parse(trialCapFromStart(start))).toBe(NOW + 50 * DAY);
  expect(Date.parse(row(50).trial_ends_at)).toBeLessThanOrEqual(Date.parse(trialCapFromStart(start)));
  // A 14-day trial started 10 days ago (4 days left) is still moved out to start + 30 days (20 days left), as before.
  expect(mayExtendTrial(row(4), start, NOW)).toBe(true);
  expect(Date.parse(trialEndFromStart(start))).toBe(NOW + 20 * DAY);
});
