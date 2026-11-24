// Round 24 FIX3 (review-FIX2 F2, F9): LAUNCH.md step 8 says when the old waitlist index may be dropped and guards the drop; step 9
// also reads the people who joined without a trade. The SQL is taken from LAUNCH.md itself and run on PGlite.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bootDb, hasPglite } from '../moat/pg';

const launch = fs.readFileSync('LAUNCH.md', 'utf8');
const from = (start: string, end: string) => {
  const a = launch.indexOf(start);
  const b = launch.indexOf(end, a + 1);
  if (a < 0 || b < 0) throw new Error(`section not found: ${start}`);
  return launch.slice(a, b);
};
const step8 = from('8. NEEDS KUDZI (round 24 FIX2, review D8', '9. NEEDS KUDZI (round 24 FIX2, review D8');
const step9 = from('9. NEEDS KUDZI (round 24 FIX2, review D8', '**Round 20 order**');
const sql8 = /```sql\n([\s\S]*?)```/.exec(step8)?.[1] ?? '';
const doBlock = /do \$\$ begin[\s\S]*?end \$\$;/.exec(sql8)?.[0] ?? '';
const inline9 = [...step9.matchAll(/`((?:select|update) [^`]+;)`/g)].map((m) => m[1]);

describe('F2: step 8 says when the drop is safe and guards it', () => {
  it('names both conditions and the rollback risk', () => {
    const flat = step8.replace(/\s+/g, ' ');
    expect(flat).toContain('Drop the old index only when BOTH are true: 0039 is applied AND this deploy is live in production.');
    expect(flat).toContain('If you roll the deploy back after the drop, the waitlist form stops saving until you redeploy this branch.');
    expect(flat).not.toMatch(/the code works in every state/);
    expect(flat).not.toMatch(/—/);
  });
  it('the drop is only inside the guarded block', () => {
    expect(doBlock).toContain("raise exception 'Run 0039 first'");
    expect(doBlock).toContain("indexname = 'holler_zip_waitlist_email_zip_trade_idx'");
    expect(sql8.replace(doBlock, '')).not.toMatch(/drop index/i);
  });
});

describe('F9: step 9 also reads the rows stored without a trade', () => {
  it('has a select and an update for trade is null', () => {
    expect(inline9.some((q) => /^select email from holler_zip_waitlist where zip = '75201' and trade is null and confirmed_at is not null and unsubscribed_at is null and notified_at is null;$/.test(q))).toBe(true);
    expect(inline9.some((q) => /^update holler_zip_waitlist set notified_at = now\(\) where zip = '75201' and trade is null /.test(q))).toBe(true);
  });
});

const pgCase = (name: string, fn: () => Promise<void>) => (hasPglite ? it(name, fn, 60_000) : it.skip(`NEEDS PGlite (not installed, so NOT RUN): ${name}`, fn));
const indexes = async (db: { query: (q: string) => Promise<{ rows: { indexname: string }[] }> }) =>
  (await db.query(`select indexname from pg_indexes where tablename = 'holler_zip_waitlist' order by 1`)).rows.map((r) => r.indexname);
const MIG39 = 'supabase/migrations/0039_holler_zip_waitlist_trade.sql';

describe('the LAUNCH.md SQL on PGlite (0001..0038, then 0039)', () => {
  pgCase('step 8 refuses before 0039 and keeps the old index; after 0039 it drops only the old index', async () => {
    const db = await bootDb('0038_zzz');
    expect(doBlock).not.toBe('');
    await expect(db.exec(doBlock)).rejects.toThrow(/Run 0039 first/);
    expect(await indexes(db)).toContain('holler_zip_waitlist_email_zip_idx');
    await db.exec(fs.readFileSync(MIG39, 'utf8'));
    const before = await indexes(db);
    await db.exec(sql8);
    const after = await indexes(db);
    expect(after).toContain('holler_zip_waitlist_email_zip_trade_idx');
    expect(after).not.toContain('holler_zip_waitlist_email_zip_idx');
    expect(before.filter((i) => !after.includes(i))).toEqual(['holler_zip_waitlist_email_zip_idx']);
    await db.exec(doBlock); // a second run is harmless
  });
  pgCase('step 9: the trade query skips whole-ZIP rows, the trade-is-null query returns them, each update stamps only its own rows', async () => {
    const db = await bootDb('0038_zzz');
    await db.exec(fs.readFileSync(MIG39, 'utf8'));
    await db.exec(doBlock);
    for (const [email, trade] of [['a@x.co', 'lawn-care'], ['b@x.co', null], ['c@x.co', 'plumbing']] as const)
      await db.query(`insert into holler_zip_waitlist (email, zip, trade, consent_version, confirmed_at) values ($1, '75201', $2, 'v1', now())`, [email, trade]);
    const run = async (q: string) => (await db.query(q)).rows.map((r: { email: string }) => r.email);
    const selTrade = inline9.find((q) => q.startsWith('select email') && q.includes("trade = 'lawn-care'"))!;
    const selNull = inline9.find((q) => q.startsWith('select email') && q.includes('trade is null'))!;
    expect(await run(selTrade)).toEqual(['a@x.co']);
    expect(await run(selNull)).toEqual(['b@x.co']);
    for (const q of inline9.filter((x) => x.startsWith('update'))) await db.exec(q);
    const stamped = (await db.query(`select email from holler_zip_waitlist where notified_at is not null order by 1`)).rows.map((r: { email: string }) => r.email);
    expect(stamped).toEqual(['a@x.co', 'b@x.co']);
  });
});
