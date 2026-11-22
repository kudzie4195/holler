/**
 * Round 18 ES redo 1: the reviewer's probe (gates/r18/logs/REV-ES-probe-tests/rev-es-forgot-lang.probe.test.ts) kept as a regression test: which language POST /api/auth/forgot mails in, for every mix of saved profile language, language
 * parked at sign-up and page language, and what the caller can see. The real route and the real render; only the admin client, `after`
 * and the send are faked. Writes the matrix to REV-ES-probe-forgot-matrix.log.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
afterEach(() => { vi.resetModules(); vi.restoreAllMocks(); });

type Saved = 'en' | 'es' | 'no-profile' | '42703' | 'PGRST204' | 'throws';
function mocks(o: { member: boolean; saved: Saved; parked?: unknown }) {
  vi.resetModules();
  const sent: { to: string; subject: string; text: string; html: string }[] = [];
  const after: (() => Promise<void>)[] = [];
  vi.doMock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (cb: () => Promise<void>) => { after.push(cb); } }));
  vi.doMock('@/lib/env', async (orig) => { const real = await orig<typeof import('@/lib/env')>(); return { ...real, siteUrl: 'https://localholler.test' }; });
  vi.doMock('@/lib/email', async (orig) => ({ ...(await orig<typeof import('@/lib/email')>()), sendEmail: async (m: any) => { sent.push(m); return { ok: true }; } }));
  const profileRead = async () => {
    if (o.saved === 'throws') throw new Error('network');
    if (o.saved === '42703') return { data: null, error: { code: '42703', message: 'column holler_profiles.language does not exist' } };
    if (o.saved === 'PGRST204') return { data: null, error: { code: 'PGRST204', message: "Could not find the 'language' column" } };
    if (o.saved === 'no-profile') return { data: null, error: null };
    return { data: { language: o.saved }, error: null };
  };
  const admin = {
    rpc: async (name: string) => (name === 'holler_rate_hit' ? { data: true, error: null } : { data: o.member ? 'uid-1' : null, error: null }),
    auth: { admin: { generateLink: async () => ({ data: { properties: { hashed_token: 'HASH' }, user: { id: 'uid-1', app_metadata: { products: ['holler'], ...(o.parked === undefined ? {} : { holler_language: o.parked }) } } }, error: null }) } },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: profileRead }) }) }),
  };
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin }));
  return { sent, after };
}
const ask = async (page?: unknown) => {
  const { POST } = await import('@/app/api/auth/forgot/route');
  return POST(new Request('https://localholler.test/api/auth/forgot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(page === undefined ? { email: 'victim@example.com' } : { email: 'victim@example.com', lang: page }) }));
};

describe('review probe: forgot-password language matrix', () => {
  it('saved profile language, then the language parked at sign-up, then the page; the answer to the caller never changes', async () => {
    const rows: string[] = ['saved        parked   page  -> mail language, link next        | answer to the caller'];
    const answers = new Set<string>();
    for (const saved of ['en', 'es', 'no-profile', '42703', 'PGRST204', 'throws'] as Saved[]) {
      for (const parked of [undefined, 'es', 'fr']) {
        for (const page of [undefined, 'es', 'fr']) {
          const h = mocks({ member: true, saved, parked });
          const res = await ask(page);
          const body = await res.text();
          for (const cb of h.after) await cb();
          answers.add(`${res.status} ${body}`);
          const m = h.sent[0];
          const lang = m ? (m.subject === 'Reset your Holler password' ? 'en' : m.subject === 'Cambie su contraseña de Holler' ? 'es' : `?${m.subject}`) : 'NOT SENT';
          const next = m ? decodeURIComponent(/next=([^\s&"]+)/.exec(m.text)?.[1] ?? '?') : '';
          const expected = saved === 'en' || saved === 'es' ? saved : parked === 'es' ? 'es' : page === 'es' ? 'es' : 'en';
          rows.push(`${saved.padEnd(12)} ${String(parked ?? '-').padEnd(8)} ${String(page ?? 'en').padEnd(5)} -> ${lang.padEnd(3)} ${next.padEnd(10)} ${lang === expected ? '' : `(EXPECTED ${expected})`} | ${res.status} ${body}`);
          expect(lang, `${saved}/${parked}/${page}`).toBe(expected);
          expect(next).toBe(lang === 'es' ? '/es/reset' : '/reset');
          // the link itself is on the site origin and goes through the no-referrer /auth/confirm
          expect(m.text).toContain('https://localholler.test/auth/confirm?token_hash=HASH&type=recovery&next=');
        }
      }
    }
    // an email with no Holler account: nothing is sent, and the answer is the same
    for (const page of [undefined, 'es']) {
      const h = mocks({ member: false, saved: 'no-profile' });
      const res = await ask(page);
      const body = await res.text();
      for (const cb of h.after) await cb();
      answers.add(`${res.status} ${body}`);
      rows.push(`(no Holler account)      ${String(page ?? 'en').padEnd(5)} -> ${h.sent.length ? 'SENT' : 'nothing sent'} | ${res.status} ${body}`);
      expect(h.sent).toHaveLength(0);
    }
    rows.push('', `distinct answers seen by the caller across all ${rows.length - 2} cases: ${[...answers].join(' || ')}`);
    rows.push('', 'What a third party can do: ask on the Spanish page for someone else\'s address. With a saved profile language the page language is ignored.', 'With NO profile yet, or with migration 0024 not applied (42703 / PGRST204), or with the read failing, the page language decides, so the', 'caller picks the language of the reset email the member receives. Nothing about the account comes back to the caller.');
    if (process.env.REV_ES_MATRIX) writeFileSync(process.env.REV_ES_MATRIX, rows.join('\n') + '\n');
    expect(answers.size).toBe(1);
    // 56 route imports in one test: 2.6 to 4.3 s alone, more on a busy machine (review 2 P3-4).
  }, 20_000);
});
