/**
 * Round 18 ROUTES, items 1 and 3 on the member surfaces: the "What work do you take?" Settings section (English and Spanish, hidden and
 * harmless without migration 0027), the feed chip of a feed-only card, and the notify cron that never emails a held match.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseWorkProfileForm, readWorkProfile, saveWorkProfile } from '@/lib/auth/work-profile';
import { WorkProfileForm } from '@/components/work-profile-form';
import { OpportunityChip } from '@/components/feed/opportunity-chip';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';

const form = (v: Record<string, string | undefined>) => ({ get: (k: string) => (k in v ? (v[k] ?? null) : null) });

/** A fake of the member's Supabase client: `.from('holler_work_profiles').upsert(row, opts)` and the Settings read. */
function fakeClient(result: { error: { code?: string; message?: string } | null } | 'throw', read: { data?: unknown; error?: unknown } = { data: null }) {
  const calls: Array<{ table: string; row: unknown; opts: unknown }> = [];
  const client: any = {
    from(table: string) {
      return {
        upsert: async (row: unknown, opts: unknown) => {
          calls.push({ table, row, opts });
          if (result === 'throw') throw new Error('network');
          return result;
        },
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: read.data ?? null, error: read.error ?? null }) }) }),
      };
    },
  };
  return { client, calls };
}

describe('saving "What work do you take?"', () => {
  it('parses the three fields; empty minimum is no minimum; "$5,000" is 5000', () => {
    expect(parseWorkProfileForm(form({ work_property: 'residential', work_type: 'repairs', work_min_value: '$5,000' }))).toEqual({ work_property: 'residential', work_min_value: 5000, work_type: 'repairs' });
    expect(parseWorkProfileForm(form({ work_property: 'both', work_type: 'both', work_min_value: '' }))).toEqual({ work_property: 'both', work_min_value: null, work_type: 'both' });
    expect(parseWorkProfileForm(form({ work_property: 'both', work_type: 'both' }))).toEqual({ work_property: 'both', work_min_value: null, work_type: 'both' });
    for (const bad of [{ work_property: 'mansions', work_type: 'both' }, { work_property: 'both', work_type: 'x' }, { work_property: 'both', work_type: 'both', work_min_value: '-5' }, { work_property: 'both', work_type: 'both', work_min_value: '12.50' }, { work_property: 'both', work_type: 'both', work_min_value: '999999999' }]) {
      expect(parseWorkProfileForm(form(bad))).toBeNull();
    }
  });
  it('writes only the three columns of the signed-in member, and answers in their language', async () => {
    const f = fakeClient({ error: null });
    const r = await saveWorkProfile(f.client, 'u1', form({ work_property: 'commercial', work_type: 'installs', work_min_value: '2500' }), 'es');
    expect(r).toEqual({ ok: true, message: es['settings.work.saved'] });
    expect(f.calls).toEqual([{ table: 'holler_work_profiles', row: { user_id: 'u1', work_property: 'commercial', work_min_value: 2500, work_type: 'installs' }, opts: { onConflict: 'user_id' } }]);
  });
  it('refuses a bad form and writes nothing', async () => {
    const f = fakeClient({ error: null });
    const r = await saveWorkProfile(f.client, 'u1', form({ work_property: 'x', work_type: 'both' }));
    expect(r).toEqual({ error: en['settings.work.error'] });
    expect(f.calls).toHaveLength(0);
  });
  it('migration 0027 NOT applied (42P01 / PGRST205, or a column missing: 42703 / PGRST204): saves nothing and shows no error', async () => {
    for (const error of [{ code: '42P01', message: 'relation "public.holler_work_profiles" does not exist' }, { code: 'PGRST205', message: "Could not find the table 'public.holler_work_profiles' in the schema cache" }, { code: '42703', message: 'column "work_property" of relation "holler_work_profiles" does not exist' }, { code: 'PGRST204', message: "Could not find the 'work_min_value' column of 'holler_work_profiles' in the schema cache" }]) {
      const r = await saveWorkProfile(fakeClient({ error }).client, 'u1', form({ work_property: 'both', work_type: 'both', work_min_value: '' }));
      expect(r).toEqual({ ok: true, skipped: true });
    }
  });
  it('any other failure is a short error, never a crash', async () => {
    expect(await saveWorkProfile(fakeClient({ error: { code: '42501', message: 'permission denied' } }).client, 'u1', form({ work_property: 'both', work_type: 'both' }))).toEqual({ error: en['settings.work.error'] });
    expect(await saveWorkProfile(fakeClient('throw').client, 'u1', form({ work_property: 'both', work_type: 'both' }))).toEqual({ error: en['settings.work.error'] });
  });
  it('the form renders in English and in Spanish with the saved values', () => {
    const current = { property: 'residential' as const, minValue: 5000, workType: 'repairs' as const };
    const action = async () => ({});
    const htmlEn = renderToStaticMarkup(createElement(WorkProfileForm, { action, current, lang: 'en' }));
    expect(htmlEn).toContain('Residential only');
    expect(htmlEn).toContain('Repairs and service only');
    expect(htmlEn).toContain('value="5000"');
    expect(htmlEn).toContain('name="work_property"');
    const htmlEs = renderToStaticMarkup(createElement(WorkProfileForm, { action, current, lang: 'es' }));
    expect(htmlEs).toContain('Solo residencial');
    expect(htmlEs).toContain('Guardar preferencias de trabajo');
    expect(htmlEs).not.toContain('Residential only');
  });
  it('the Settings section is shown only when the work table can be read (hidden before 0027), and saves through its own server action', async () => {
    expect(await readWorkProfile(fakeClient({ error: null }, { error: { code: '42P01', message: 'relation "public.holler_work_profiles" does not exist' } }).client, 'u1')).toEqual({ available: false, settings: { property: 'both', minValue: null, workType: 'both' } });
    expect(await readWorkProfile(fakeClient({ error: null }, { data: null }).client, 'u1')).toEqual({ available: true, settings: { property: 'both', minValue: null, workType: 'both' } });
    expect(await readWorkProfile(fakeClient({ error: null }, { data: { work_property: 'commercial', work_min_value: 900, work_type: 'repairs' } }).client, 'u1')).toEqual({ available: true, settings: { property: 'commercial', minValue: 900, workType: 'repairs' } });
    const { readFileSync } = await import('node:fs');
    const page = readFileSync('app/app/settings/page.tsx', 'utf8');
    expect(page).toMatch(/\{work\.available \? \(/);
    const actions = readFileSync('app/app/settings/actions.ts', 'utf8');
    // Same auth pattern as every member action: a server action ('use server', origin-checked by Next) that reads the signed-in user,
    // and writes with the member's own client (RLS: own row only).
    expect(actions.startsWith("'use server';")).toBe(true);
    const body = actions.slice(actions.indexOf('export async function saveWorkProfileSetting'));
    expect(body).toMatch(/const user = await getUser\(\);\s*if \(!user\) redirect/);
    expect(body).toMatch(/saveWorkProfile\(supabase, user\.id/);
    expect(body).not.toMatch(/createAdminClient/);
  });
});

describe('the feed chip of a feed-only card', () => {
  it('a background permit shows "Background" and why, not the alert chip', () => {
    const html = renderToStaticMarkup(createElement(OpportunityChip, { label: 'coming_soon', hold: 'background' }));
    expect(html).toContain('Background');
    expect(html).toContain(en['hold.background.note']);
    expect(html).not.toContain('Coming soon');
  });
  it('a permit below the minimum says so, in Spanish too', () => {
    expect(renderToStaticMarkup(createElement(OpportunityChip, { label: 'coming_soon', hold: 'below_min' }))).toContain('Below your minimum');
    expect(renderToStaticMarkup(createElement(OpportunityChip, { label: 'coming_soon', hold: 'below_min', lang: 'es' }))).toContain('Por debajo de su mínimo');
  });
  it('without a hold the chip is exactly as before', () => {
    expect(renderToStaticMarkup(createElement(OpportunityChip, { label: 'coming_soon' }))).toBe(renderToStaticMarkup(createElement(OpportunityChip, { label: 'coming_soon', hold: null })));
    expect(renderToStaticMarkup(createElement(OpportunityChip, { label: 'coming_soon' }))).toContain('Coming soon');
  });
});

// ---- the notify cron (harness from tests/i18n/notify-language.test.ts) ------------------------------------------------------------
const NOW = Date.parse('2026-11-19T12:00:00.000Z');
const H = 3_600_000;
const UID = '11111111-1111-4111-8111-111111111111';
const permitSig = (id: number, title: string) => ({
  id, source: 'arcgis-dekalb-permits', external_id: `p${id}`, expires_at: null, kind: 'permit', title, url: null, city: 'Decatur', state: 'GA',
  occurred_at: new Date(NOW - 2 * H).toISOString(), severity: 1, subtype: 'permit', categories: ['general-contractor', 'real-estate', 'moving'],
});

function fakeAdmin(matches: unknown[], opts: { no0027?: boolean }, updates: Array<{ patch: unknown; ids: unknown }>, selects: string[]) {
  return {
    from(table: string) {
      const ops: Array<{ op: string; args: unknown[] }> = [];
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'range', 'in', 'is', 'update', 'insert', 'limit', 'or', 'gte', 'lt', 'upsert']) q[m] = (...args: unknown[]) => (ops.push({ op: m, args }), q);
      const result = () => {
        const has = (o: string) => ops.some((x) => x.op === o);
        const cols = String(ops.find((x) => x.op === 'select')?.args[0] ?? '');
        if (table === 'holler_matches') {
          if (has('update')) {
            updates.push({ patch: ops.find((x) => x.op === 'update')!.args[0], ids: ops.find((x) => x.op === 'in')?.args[1] });
            return { error: null };
          }
          selects.push(cols);
          if (opts.no0027 && cols.includes('alert_hold')) return { data: null, error: { code: '42703', message: 'column holler_matches.alert_hold does not exist' } };
          return { data: opts.no0027 ? matches.map((m: any) => { const { alert_hold: _h, ...rest } = m; void _h; return rest; }) : matches, error: null };
        }
        if (table === 'holler_profiles') {
          if (has('update')) return { error: null };
          if (cols === 'user_id, language') return { data: [{ user_id: UID, language: 'en' }], error: null };
          return { data: [{ user_id: UID, business_name: 'Oak Moving', categories: ['moving'], alert_email: true, subscription_status: 'active', trial_ends_at: null, last_notified_at: null, email_verified_at: '2026-11-01T00:00:00Z', created_at: '2026-11-01T00:00:00Z' }], error: null };
        }
        return { data: [], error: null };
      };
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
      return q;
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'a@oak.test' } }, error: null }) } },
  };
}

async function runNotify(matches: unknown[], opts: { no0027?: boolean } = {}) {
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', 's3cret');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const sent: { to: string; text: string }[] = [];
  const updates: Array<{ patch: unknown; ids: unknown }> = [];
  const selects: string[] = [];
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeAdmin(matches, opts, updates, selects) }));
  vi.doMock('@/lib/outreach/loader', async (orig) => ({ ...(await orig<typeof import('@/lib/outreach/loader')>()), loadMemberContacts: async () => new Map() }));
  vi.doMock('@/lib/email', async (orig) => ({
    ...(await orig<typeof import('@/lib/email')>()),
    sendEmail: async (m: { to: string; text: string }) => (sent.push(m), { ok: true as const, id: 'e1' }),
  }));
  const { GET } = await import('@/app/api/cron/notify/route');
  const res = await GET(new Request('https://holler.test/api/cron/notify', { headers: { authorization: 'Bearer s3cret' } }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, sent, updates, selects };
}

describe('the notify cron never emails a held match', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    for (const m of ['@/lib/supabase/admin', '@/lib/outreach/loader', '@/lib/email', 'server-only']) vi.doUnmock(m);
  });
  const MATCHES = [
    { id: 1, user_id: UID, created_at: new Date(NOW - H).toISOString(), alert_hold: 'background', signal: permitSig(1, 'New home permit in DeKalb County') },
    { id: 2, user_id: UID, created_at: new Date(NOW - H).toISOString(), alert_hold: null, signal: permitSig(2, 'New home permit in Decatur') },
  ];
  it('the held permit is marked notified without a mail; the other one is emailed', async () => {
    const r = await runNotify(MATCHES);
    expect(r.status).toBe(200);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0].text).toContain('New home permit in Decatur');
    expect(r.sent[0].text).not.toContain('New home permit in DeKalb County');
    const silent = r.updates.find((u) => Array.isArray(u.ids) && (u.ids as number[]).includes(1));
    expect(silent?.patch).toEqual({ notified: true });
  });
  it('migration 0027 NOT applied: the read is made again without alert_hold and both are emailed as before', async () => {
    const r = await runNotify(MATCHES, { no0027: true });
    expect(r.status).toBe(200);
    expect(r.selects[0]).toContain('alert_hold');
    expect(r.selects[1]).not.toContain('alert_hold');
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0].text).toContain('New home permit in Decatur');
    expect(r.sent[0].text).toContain('New home permit in DeKalb County');
  });
});
