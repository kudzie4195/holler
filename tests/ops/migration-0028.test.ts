/* eslint-disable @typescript-eslint/no-explicit-any */
// Migration 0028 (free trial 60 days, round 18) run for real on PGlite on top of 0001..0025: the column default, the one-trial cap and
// the member-insert guard move to 60 days; holler_trial_db_check() reads them back; the extension touches exactly the members who never
// paid and whose trial is running or ended in the last 46 days, gives them the remainder of 60 days from their ORIGINAL start, clears
// only their trial_ending / trial_ended ledger rows, and a second run changes nothing. Skips when PGlite is not installed.
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { bootDb, hasPglite } from '../moat/pg';
import { selectLifecycle, type LifecycleProfile, type SendRow } from '../../lib/lifecycle/select';

const SQL = fs.readFileSync('supabase/migrations/0028_holler_trial_60.sql', 'utf8');
const SQL_0019 = fs.readFileSync('supabase/migrations/0019_holler_trial_14.sql', 'utf8');

const id = (n: number) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;

/** Days from now() of each row's trial_ends_at, rounded to the hour, keyed by user number. */
async function ends(db: any): Promise<Record<number, number>> {
  const r = await db.query(`select user_id::text u, round(extract(epoch from (trial_ends_at - now())) / 3600.0)::int h from holler_profiles order by 1`);
  return Object.fromEntries(r.rows.map((x: any) => [Number(x.u.slice(-2)), x.h / 24]));
}

it.skipIf(!hasPglite)('0028: 60 days in all three places, the check function, and an extension that only reaches members who never paid', async () => {
  const db = await bootDb('0025_zzz'); // the database as it is before round 18 (0019 trial of 14 days)

  // Fixtures, as the database looks today. [n, stamp days ago | null | 'bad', created days ago, ends in days, extra columns]
  const rows: [number, number | null | 'bad', number, number, string][] = [
    [1, null, 5, 9, ''], // A running 14-day trial: extend to created + 60 (= +55)
    [2, null, 24, -10, ''], // B ended 10 days ago: extend to created + 60 (= +36), ledger reset
    [3, null, 64, -50, ''], // C ended 50 days ago (outside 46): untouched
    [4, null, 54, -40, `, subscription_status = 'active'`], // D paying: untouched
    [5, null, 10, 4, `, stripe_subscription_id = 'sub_5'`], // E has a Stripe subscription: untouched
    [6, null, 10, 4, `, plan_source = 'apple'`], // F store plan: untouched
    [7, null, 10, 4, ''], // G has an APPLIED store billing event: untouched
    [8, 30, 2, -16, ''], // H came back: stamp 30 days ago, cut to stamp + 14; gets stamp + 60 (= +30), not a fresh 60
    [9, 'bad', 5, 9, ''], // I unreadable stamp: skipped
    [10, null, 3, 57, ''], // J already at created + 60: untouched
    [11, null, 20, -6, `, subscription_status = 'canceled'`], // K canceled: untouched
    [12, 70, 20, -10, ''], // L came back, first start 70 days ago (the old trigger cuts the row to stamp + 14): start + 60 is past: untouched
    // Review F1: an ended trial whose new end would be 72 hours away or less stays ended (no second "paused" email without a reminder).
    [13, null, 59.5, -45.5, ''], // start 59.5 d back: new end +12 h: stays ended
    [14, null, 57.6, -43.6, ''], // start 57.6 d back: +57.6 h: stays ended
    [15, null, 58, -44, ''], // start 58 d back: +48 h: stays ended
    [16, null, 59, -45, ''], // start 59 d back: +24 h: stays ended
    [17, null, 59.9, -45.9, ''], // start 59.9 d back: +2.4 h: stays ended
    [18, null, 57, -43, ''], // start 57 d back: exactly +72 h: stays ended (the reminder window opens at 84 h, so it could not come first reliably)
    [19, null, 56, -42, ''], // start 56 d back: +96 h: revived, the reminder comes first
    [20, null, 46, -32, ''], // start 46 d back: +14 d: revived, ledger reset
    [21, null, 10, 4, ''], // a sandbox (not applied) store event only: never paid, extended (review F7)
  ];
  for (const [n, stamp] of rows) {
    const meta = stamp === null ? `'{}'::jsonb` : stamp === 'bad' ? `'{"holler_trial_started_at":"garbage"}'::jsonb` : `jsonb_build_object('holler_trial_started_at', (now() - interval '${stamp} days')::text)`;
    await db.exec(`insert into auth.users (id, email, raw_app_meta_data) values ('${id(n)}', 'u${n}@example.test', ${meta})`);
  }
  for (const [n, , created, end] of rows) {
    await db.exec(`insert into holler_profiles (user_id, business_name, created_at, trial_ends_at) values ('${id(n)}', 'Biz ${n}', now() - interval '${created} days', now() + interval '${end} days')`);
  }
  for (const [n, , , , extra] of rows) if (extra) await db.exec(`update holler_profiles set ${extra.slice(2)} where user_id = '${id(n)}'`);
  await db.exec(`insert into holler_billing_events (event_id, user_id, type, store, event_ts, result) values ('ev7', '${id(7)}', 'INITIAL_PURCHASE', 'app_store', now(), 'applied')`);
  await db.exec(`insert into holler_billing_events (event_id, user_id, type, store, event_ts, result) values ('ev21', '${id(21)}', 'INITIAL_PURCHASE', 'app_store', now(), 'sandbox')`);
  // Review F4: the app already moved this member to start + 60, written as whole milliseconds; Postgres keeps microseconds.
  await db.exec(`insert into auth.users (id, email) values ('${id(22)}', 'u22@example.test')`);
  await db.exec(`insert into holler_profiles (user_id, business_name, created_at) values ('${id(22)}', 'Biz 22', date_trunc('second', now() - interval '10 days') + interval '123456 microseconds')`);
  await db.exec(`update holler_profiles set trial_ends_at = date_trunc('milliseconds', created_at + interval '60 days') where user_id = '${id(22)}'`);
  for (const n of [2, 3, 5, 13, 17, 20, 22]) {
    await db.exec(`insert into holler_lifecycle_sends (user_id, kind) values ('${id(n)}', 'welcome'), ('${id(n)}', 'trial_ending'), ('${id(n)}', 'trial_ended'), ('${id(n)}', 'optout')`);
  }
  const before = await ends(db);
  expect(before[8]).toBe(-16); // the old trigger kept the returning member at stamp + 14
  const endBefore22 = (await db.query(`select trial_ends_at::text t from holler_profiles where user_id = '${id(22)}'`)).rows[0].t;
  const statusBefore = (await db.query(`select user_id, plan, subscription_status, stripe_customer_id, stripe_subscription_id, plan_source, store_product_id, store_expires_at from holler_profiles order by 1`)).rows;

  await db.exec(SQL);
  const after = await ends(db);
  expect(after).toEqual({
    1: 55, // A
    2: 36, // B
    3: -50, // C
    4: -40, // D
    5: 4, // E
    6: 4, // F
    7: 4, // G
    8: 30, // H: the remainder of 60 days from the ORIGINAL start
    9: 9, // I
    10: 57, // J
    11: -6, // K
    12: -56, // L: the old insert trigger cut it to stamp + 14 (70 - 14 = 56 days ago); start + 60 is past, so 0028 leaves it
    13: -45.5,
    14: before[14],
    15: -44,
    16: -45,
    17: before[17],
    18: -43,
    19: 4, // revived: 96 h left
    20: 14, // revived: 14 days left
    21: 50, // sandbox event only: extended
    22: 50, // already at start + 60
  });
  // Review F4: the millisecond row is not touched at all and keeps its ledger.
  expect((await db.query(`select trial_ends_at::text t from holler_profiles where user_id = '${id(22)}'`)).rows[0].t).toBe(endBefore22);
  // Subscription state is never written.
  expect((await db.query(`select user_id, plan, subscription_status, stripe_customer_id, stripe_subscription_id, plan_source, store_product_id, store_expires_at from holler_profiles order by 1`)).rows).toEqual(statusBefore);
  // Ledger: only an extended member's trial_ending / trial_ended rows go; welcome and opt-out stay; everyone else keeps everything.
  const sends = (await db.query(`select right(user_id::text, 2)::int n, string_agg(kind, ',' order by kind) k from holler_lifecycle_sends group by 1 order by 1`)).rows;
  const all = 'optout,trial_ended,trial_ending,welcome';
  expect(sends).toEqual([
    { n: 2, k: 'optout,welcome' },
    { n: 3, k: all },
    { n: 5, k: all },
    { n: 13, k: all },
    { n: 17, k: all },
    { n: 20, k: 'optout,welcome' },
    { n: 22, k: all },
  ]);

  // Lifecycle emails after the migration, with the real selection, hour by hour: every revived or extended member gets the reminder
  // BEFORE the "ended" email; a member left ended gets no second "ended" email (their ledger row stays).
  const profs = (await db.query(`select user_id::text user_id, created_at::text created_at, created_at::text email_verified_at, subscription_status, trial_ends_at::text trial_ends_at, stripe_subscription_id from holler_profiles`)).rows as LifecycleProfile[];
  const ledger = (await db.query(`select user_id::text user_id, kind from holler_lifecycle_sends where kind <> 'optout'`)).rows as SendRow[];
  const dbNow = Date.parse((await db.query(`select now()::text t`)).rows[0].t);
  const kinds = (n: number, upToDays: number) => {
    const p = profs.find((x) => x.user_id === id(n))!;
    const sends = ledger.filter((l) => l.user_id === id(n));
    const out: string[] = [];
    for (let h = 0; h <= upToDays * 24; h++) {
      for (const c of selectLifecycle([p], sends, new Date(dbNow + h * 3_600_000))) {
        out.push(c.kind);
        sends.push({ user_id: c.userId, kind: c.kind });
      }
    }
    return out.filter((k) => k !== 'welcome');
  };
  for (const n of [19, 20, 2]) expect(kinds(n, 40), `member ${n}`).toEqual(['trial_ending', 'trial_ended']);
  for (const n of [13, 17]) expect(kinds(n, 5), `member ${n}`).toEqual([]);

  // Idempotent: a second run changes nothing, and does not clear ledger rows written after the first run.
  await db.exec(`insert into holler_lifecycle_sends (user_id, kind) values ('${id(2)}', 'trial_ending')`);
  await db.exec(SQL);
  expect(await ends(db)).toEqual(after);
  expect((await db.query(`select count(*)::int c from holler_lifecycle_sends where user_id = '${id(2)}' and kind = 'trial_ending'`)).rows[0].c).toBe(1);

  // The three places say 60, read back from the catalog.
  const def = (await db.query(`select pg_get_expr(adbin, adrelid) e from pg_attrdef a join pg_attribute t on t.attrelid = a.adrelid and t.attnum = a.adnum where t.attrelid = 'public.holler_profiles'::regclass and t.attname = 'trial_ends_at'`)).rows[0].e;
  expect(def).toContain('60 days');
  expect((await db.query(`select public.holler_trial_db_check() c`)).rows[0].c).toEqual({ default_days: 60, stamp_cap_days: 60, guard_cap_days: 60 });

  // The check sees drift: re-running 0019 puts 14 back everywhere (what the health email must report), and 0028 again fixes it.
  await db.exec(SQL_0019);
  expect((await db.query(`select public.holler_trial_db_check() c`)).rows[0].c).toEqual({ default_days: 14, stamp_cap_days: 14, guard_cap_days: 14 });
  await db.exec(SQL);
  expect((await db.query(`select public.holler_trial_db_check() c`)).rows[0].c).toEqual({ default_days: 60, stamp_cap_days: 60, guard_cap_days: 60 });

  // Privileges: the check is for the service role only; the two trigger functions stay revoked from members.
  const exec = (await db.query(`select r, has_function_privilege(r, 'public.holler_trial_db_check()', 'execute') ok from unnest(array['anon','authenticated','service_role']) r order by 1`)).rows;
  expect(exec).toEqual([{ r: 'anon', ok: false }, { r: 'authenticated', ok: false }, { r: 'service_role', ok: true }]);
  for (const fn of ['holler_profiles_trial_from_stamp()', 'holler_profiles_billing_guard()']) {
    const g = (await db.query(`select bool_or(has_function_privilege(r, 'public.${fn}', 'execute')) any from unnest(array['anon','authenticated']) r`)).rows[0].any;
    expect(g, fn).toBe(false);
  }

  // A new row gets 60 days; a returning person's new row is still cut to stamp + 60 (one trial per person).
  await db.exec(`insert into auth.users (id, email) values ('${id(50)}', 'u50@example.test')`);
  await db.exec(`insert into holler_profiles (user_id, business_name) values ('${id(50)}', 'New')`);
  await db.exec(`insert into auth.users (id, email, raw_app_meta_data) values ('${id(51)}', 'u51@example.test', jsonb_build_object('holler_trial_started_at', (now() - interval '50 days')::text))`);
  await db.exec(`insert into holler_profiles (user_id, business_name) values ('${id(51)}', 'Back')`);
  const fresh = await ends(db);
  expect(fresh[50]).toBe(60);
  expect(fresh[51]).toBe(10);
}, 60_000); // explicit: booting PGlite and applying 26 migrations can take a while on a loaded machine

it.skipIf(!hasPglite)('0028: a member inserting their own profile with the 60-day default passes the guard; a member cannot set or move the end', async () => {
  const db = await bootDb('0028_zzz');
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
  await expect(asMember(`insert into holler_profiles (user_id, business_name, trial_ends_at) values ('${uid}', 'Mine', now() + interval '61 days')`)).rejects.toThrow(/billing fields are set by the server only|permission denied/); // column grants or the guard
  await asMember(`insert into holler_profiles (user_id, business_name) values ('${uid}', 'Mine')`);
  expect((await ends(db))[30]).toBe(60);
  // A member can never move their own trial end.
  await expect(asMember(`update holler_profiles set trial_ends_at = now() + interval '90 days' where user_id = '${uid}'`)).rejects.toThrow();
}, 60_000);

it.skipIf(!hasPglite)('before 0028 (14-day database): the server can still set a new member to start + 60, which is what lib/auth/trial.ts does', async () => {
  const db = await bootDb('0025_zzz');
  const uid = id(40);
  await db.exec(`insert into auth.users (id, email) values ('${uid}', 'u40@example.test')`);
  await db.exec(`insert into holler_profiles (user_id, business_name) values ('${uid}', 'Early')`);
  expect((await ends(db))[40]).toBe(14); // the old default
  // The admin client's update: the billing guard lets a non-member writer through (service role claim), and the stamp trigger is
  // BEFORE INSERT only, so an update is not cut back to stamp + 14.
  await db.exec(`update auth.users set raw_app_meta_data = jsonb_build_object('holler_trial_started_at', now()::text) where id = '${uid}'`);
  await db.exec(`select set_config('request.jwt.claim.role', 'service_role', false)`);
  await db.exec(`update holler_profiles set trial_ends_at = created_at + interval '60 days' where user_id = '${uid}' and subscription_status = 'trialing' and stripe_subscription_id is null and trial_ends_at < created_at + interval '60 days'`);
  expect((await ends(db))[40]).toBe(60);
}, 60_000);
