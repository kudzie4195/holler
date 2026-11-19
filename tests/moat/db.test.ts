/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from 'vitest';
import { cleanPlace } from '@/lib/storms/report';
import { bootDb, hasPglite } from './pg';

const HOSTILE = `'; drop table x; -- 123 Main Street Apt 4 call 555-123-4567 jane@evil.test`;
let db: any;

beforeAll(async () => {
  if (!hasPglite) return;
  db = await bootDb();
}, 60_000);

const q = async (sql: string, p?: unknown[]) => (await db.query(sql, p)).rows;

describe.skipIf(!hasPglite)('archive and prune (PGlite, real migration)', () => {
  it('holler_plain_place stays in step with cleanPlace in lib/storms/report.ts', async () => {
    const corpus = [
      'Cobb', 'COBB', 'cobb county', '2 ESE Longview', '12.5 NNW Fort Worth', '  St.   Louis ', "O'Brien", "Winston-Salem", 'ST. LOUIS', 'MC KINNEY',
      '123 Main Street', 'Main Street', 'Oak Rd', 'I-85', 'US 41', 'US-41', 'SR-9', 'Mile Marker', 'Exit', 'Apt', 'Suite', 'PO Box', 'po box',
      'Rodney', 'Roadrunner', 'Frisco; drop table', 'a'.repeat(41), 'a'.repeat(40), '', ' ', null, undefined, 'Zürich', 'Name1', '-Dash', ".dot", "'quote",
      'Smith & Sons', 'Hwy', 'Highway 9', 'Park Way', 'Parkway', 'Mm', 'Mmm', 'Avenue', 'Avenue Q', 'Boulder\tCity', 'N 5 Main', '2 ESE', '2 ESE ', '1 N X', 'Mile',
      'THE VILLAGES', 'McDonough', 'East Point', 'I-',  'Ohio US', 'Interstate', 'US-', 'USA', 'Fort-Wayne',
    ];
    for (const raw of corpus) {
      const sql = (await q(`select public.holler_plain_place($1) as v`, [raw ?? null]))[0].v;
      expect(sql, JSON.stringify(raw)).toBe(cleanPlace(raw as any));
    }
  });

  it('copies only the coarse columns: hostile text in every other column leaves no trace', async () => {
    await q(
      `insert into public.holler_signals(id,source,external_id,kind,title,summary,url,lat,lon,city,state,county,zip,place_slug,categories,severity,occurred_at,data) values
       (101,'nws','h1','alert',$1,$1,'https://evil.test/'||$1,33.1,-84.2,$1,$1,$1,$1,'p',array['roofing',$1],2,now() - interval '130 days',jsonb_build_object('subtype',$1,'address',$1,'note',$1)),
       (102,'nws','h2','alert',$1,$1,null,33.1,-84.2,'Marietta','GA','Cobb','30060','marietta-ga','{roofing}',2,now() - interval '131 days',jsonb_build_object('subtype','permit','address',$1,'owner',$1))`,
      [HOSTILE],
    );
    await q(`select public.holler_archive_signals('infinity')`);
    const rows = await q(`select * from public.holler_signal_archive where signal_id in (101,102) order by signal_id`);
    expect(rows).toHaveLength(2);
    // archived_at is a clock value (it can contain digits like '33.1'), so it is left out of the leak scan.
    const dump = JSON.stringify((rows as Record<string, unknown>[]).map((r) => ({ ...r, archived_at: undefined, id: undefined })));
    for (const needle of ['evil', 'drop table', 'Main Street', '555', 'jane', 'marietta-ga', '33.1', '-84.2']) expect(dump).not.toContain(needle);
    expect(rows[0]).toMatchObject({ zip: null, county: null, city: null, state: null, subtype: null, categories: ['roofing'] });
    expect(rows[1]).toMatchObject({ zip: '30060', county: 'Cobb', city: 'Marietta', state: 'GA', subtype: 'permit', source: 'nws', kind: 'alert', severity: 2 });
    expect(Object.keys(rows[1]).sort()).toEqual(['archived_at', 'categories', 'city', 'county', 'id', 'kind', 'occurred_on', 'severity', 'signal_id', 'source', 'state', 'subtype', 'zip']);
  });

  it('a zip with anything but five digits is never copied', async () => {
    let n = 200;
    for (const z of ['3006', '300601', '30060-1234', '3006a', ' 30060', '30060\n', '٣٠٠٦٠']) {
      n++;
      await q(`insert into public.holler_signals(id,source,external_id,kind,title,zip,occurred_at) values ($1::bigint,'nws','z'||$1::text,'alert','t',$2,now() - interval '140 days')`, [n, z]);
    }
    await q(`select public.holler_archive_signals('infinity')`);
    const rows = await q(`select zip from public.holler_signal_archive where signal_id between 201 and 207`);
    expect(rows).toHaveLength(7);
    expect(rows.every((r: any) => r.zip === null)).toBe(true);
  });

  it('backfill is idempotent', async () => {
    const before = (await q(`select count(*)::int n from public.holler_signal_archive`))[0].n;
    expect((await q(`select public.holler_archive_signals('infinity') n`))[0].n).toBe(0);
    expect((await q(`select count(*)::int n from public.holler_signal_archive`))[0].n).toBe(before);
  });

  it('archive-then-delete is atomic: a failing archive deletes nothing', async () => {
    await q(`insert into public.holler_signals(id,source,external_id,kind,title,occurred_at) values (301,'nws','a1','alert','old', now() - interval '300 days'),(302,'nws','a2','alert','old2', now() - interval '301 days')`);
    await db.exec(`create or replace function public.holler_test_boom() returns trigger language plpgsql as $$ begin if new.signal_id = 302 then raise exception 'boom'; end if; return new; end $$;
      create trigger holler_test_boom before insert on public.holler_signal_archive for each row execute function public.holler_test_boom();`);
    await expect(q(`select * from public.holler_prune_signals(now() - interval '120 days', now() + interval '60 days')`)).rejects.toThrow(/boom/);
    expect((await q(`select count(*)::int n from public.holler_signals where id in (301,302)`))[0].n).toBe(2);
    expect((await q(`select count(*)::int n from public.holler_signal_archive where signal_id in (301,302)`))[0].n).toBe(0);
    await db.exec(`drop trigger holler_test_boom on public.holler_signal_archive; drop function public.holler_test_boom();`);
    const r = (await q(`select * from public.holler_prune_signals(now() - interval '120 days', now() + interval '60 days')`))[0];
    expect(r.deleted_old).toBeGreaterThanOrEqual(2);
    expect((await q(`select count(*)::int n from public.holler_signals where id in (301,302)`))[0].n).toBe(0);
    expect((await q(`select count(*)::int n from public.holler_signal_archive where signal_id in (301,302)`))[0].n).toBe(2);
  });

  it('never archives resident requests and a recent row is neither archived by prune nor deleted', async () => {
    await q(`insert into public.holler_signals(id,source,external_id,kind,title,occurred_at) values (401,'holler-request','r1','ask','req', now() - interval '150 days'),(402,'nws','f1','alert','fresh', now() - interval '5 days')`);
    await q(`select * from public.holler_prune_signals(now() - interval '120 days', now() + interval '60 days')`);
    expect((await q(`select count(*)::int n from public.holler_signals where id=401`))[0].n).toBe(0);
    expect((await q(`select count(*)::int n from public.holler_signal_archive where signal_id=401`))[0].n).toBe(0);
    expect((await q(`select count(*)::int n from public.holler_signals where id=402`))[0].n).toBe(1);
  });
});
