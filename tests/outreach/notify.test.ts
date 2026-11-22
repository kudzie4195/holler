import { afterEach, describe, expect, it, vi } from 'vitest';
import { contactLine, renderDigest } from '@/lib/email/templates';

const NOW = new Date('2026-11-17T12:00:00.000Z');
const item = (over: Record<string, unknown> = {}) => ({ kind: 'permit', title: 'New roofing permit', place: 'Atlanta, GA', occurredAt: NOW.toISOString(), ...over });
const render = (items: ReturnType<typeof item>[]) =>
  renderDigest({ businessName: 'Acme', items, appUrl: 'https://holler.test/app', unsubscribeUrl: 'https://holler.test/u', now: NOW });

describe('digest: Contact line', () => {
  it('adds one line under an alert with an organisation, in html and text', () => {
    const mail = render([item({ contact: { name: 'Peachtree Roofing LLC', role: 'Named on this permit' } })]);
    expect(mail.html).toContain('Contact: Peachtree Roofing LLC (Named on this permit)');
    expect(mail.text).toContain('Contact: Peachtree Roofing LLC (Named on this permit)');
  });

  it('escapes html in the name', () => {
    const mail = render([item({ contact: { name: '<script>alert(1)</script> & "Sons"', role: 'Named on this permit' } })]);
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('&amp;');
    expect(mail.html).toContain('&quot;Sons&quot;');
  });

  it('has no line when there is no organisation contact', () => {
    for (const contact of [undefined, null, { name: '', role: 'x' }]) {
      const mail = render([item({ contact })]);
      expect(mail.html).not.toContain('Contact:');
      expect(mail.text).not.toContain('Contact:');
    }
  });

  it('contains no em dash', () => {
    expect(contactLine({ name: 'A — B Co', role: 'The business inspected' })).not.toContain('—');
  });
});

describe('GET /api/cron/notify: the email names an organisation and nothing else', () => {
  const sent: { html: string; text: string }[] = [];
  const marked: unknown[][] = [];
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('@/lib/outreach/loader');
    vi.doUnmock('@/lib/supabase/admin');
    vi.doUnmock('@/lib/email');
    sent.length = 0;
    marked.length = 0;
  });

  function adminFake(matches: unknown[], profileExtra: Record<string, unknown> = {}) {
    return {
      from(table: string) {
        const q: Record<string, unknown> = {};
        let patch: unknown = null;
        for (const m of ['select', 'eq', 'order']) q[m] = () => q;
        q.range = () => Promise.resolve({ data: table === 'holler_matches' ? matches : [], error: null });
        q.update = (p: unknown) => ((patch = p), q);
        q.in = (_col: unknown, ids: unknown) =>
          patch
            ? (marked.push(ids as unknown[]), Promise.resolve({ error: null }))
            : Promise.resolve({
                data: [{ user_id: 'u1', business_name: 'Acme', alert_email: true, subscription_status: 'active', trial_ends_at: null, last_notified_at: null, email_verified_at: '2026-11-01T00:00:00Z', created_at: '2026-11-01T00:00:00Z', ...profileExtra }],
                error: null,
              });
        q.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res);
        return q;
      },
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'owner@acme.test' } }, error: null }) } },
    };
  }

  async function run(matches: unknown[], loaderImpl: (db: unknown, userId: string, ids: number[]) => Promise<Map<number, unknown[]>>, profileExtra: Record<string, unknown> = {}) {
    vi.resetModules();
    vi.stubEnv('CRON_SECRET', 's3cret');
    vi.doMock('server-only', () => ({}));
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminFake(matches, profileExtra) }));
    // The real loader (lib/contacts/load.ts) is another unit's file: inject a fake through the same wrapper the route uses.
    vi.doMock('@/lib/outreach/loader', async (orig) => {
      const real = await orig<typeof import('@/lib/outreach/loader')>();
      return { ...real, loadMemberContacts: (o: Parameters<typeof real.loadMemberContacts>[0]) => real.loadMemberContacts({ ...o, loader: loaderImpl as never, orgCheck: null }) };
    });
    vi.doMock('@/lib/email', async (orig) => ({
      ...(await orig<typeof import('@/lib/email')>()),
      sendEmail: async (m: { html: string; text: string }) => (sent.push(m), { ok: true, id: 'x' }),
    }));
    const GET = (await import('@/app/api/cron/notify/route')).GET;
    return GET(new Request('http://localhost/api/cron/notify', { headers: { authorization: 'Bearer s3cret' } }));
  }

  const sig = (id: number, over: Record<string, unknown>) => ({
    id: id * 10,
    user_id: 'u1',
    created_at: new Date(NOW.getTime() - 60_000).toISOString(),
    signal: { id, kind: 'permit', source: 'socrata-chicago-permits', title: `Permit ${id}`, url: 'https://example.com', city: 'Atlanta', state: 'GA', occurred_at: new Date(NOW.getTime() - 3_600_000).toISOString(), ...over },
  });

  it('one Contact line per organisation alert, no address, phone or email, none for other alerts', async () => {
    const loader = vi.fn(async (_db: unknown, userId: string, ids: number[]) => {
      expect(userId).toBe('u1');
      const m = new Map<number, unknown[]>();
      for (const id of ids) {
        if (id === 1)
          m.set(1, [
            { signalId: 1, role: 'site', name: '', address: '12 Main St', city: 'Atlanta', state: 'GA', zip: '30301' },
            { signalId: 1, role: 'contractor', name: 'Peachtree Roofing LLC', phone: '404-555-0100', email: 'jobs@peachtree.example', website: 'peachtree.example', address: '99 Secret Rd' },
          ]);
      }
      return m;
    });
    const res = await run([sig(1, {}), sig(2, {}), sig(3, { source: 'nws', kind: 'alert', title: 'Hail warning' })], loader);
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    const mail = sent[0].html + sent[0].text;
    expect(mail).toContain('Contact: Peachtree Roofing LLC (Named on this permit)');
    expect(mail.match(/Contact: /g)!.length).toBe(2); // html + text for the one organisation alert
    for (const secret of ['404-555-0100', 'jobs@peachtree', '12 Main St', '99 Secret Rd', 'peachtree.example']) expect(mail).not.toContain(secret);
    // the area alert (id 3) never asked the loader
    expect(loader.mock.calls[0][2]).toEqual([1, 2]);
  });

  it('a failing loader leaves the email as before', async () => {
    const res = await run([sig(1, {})], async () => {
      throw new Error('db down');
    });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain('Permit 1');
    expect(sent[0].html).not.toContain('Contact:');
  });
  it('the email carries the brief per item and no intent block (changed deliberately, brief card v1 redo); a business licence and a 311 each read their own brief', async () => {
    const res = await run(
      [
        sig(1, { kind: 'civic', source: 'socrata-chicago-business', subtype: 'business', title: 'New business licence' }),
        // round 19 RULES line 10: a 311 request alerts only through a named rule (a Cambridge-style pipe-boundary question is one)
        sig(2, { kind: 'civic', source: 'socrata-chicago-311', subtype: '311', title: 'Sewer pipe boundary question' }),
        sig(3, { kind: 'civic', source: 'socrata-chicago-311', subtype: '311', title: 'Pothole request' }), // context: never mailed
      ],
      async () => new Map(),
    );
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    const html = sent[0].html;
    const text = sent[0].text;
    expect(html).not.toContain('Money being spent');
    expect(text).not.toContain('Money being spent');
    expect(html).not.toContain('Might need work');
    expect(html).toContain('Sewer pipe boundary question');
    expect(html).not.toContain('Pothole request');
    // the licence's brief names a new business license, the 311's brief names the request
    expect(text).toContain('A new business license was filed nearby');
    expect(text).toContain('the license was filed');
    expect(text).toContain('it was filed; the record does not show the city confirmed it');
    expect(text.indexOf('New business licence')).toBeLessThan(text.indexOf('A new business license was filed nearby'));
  });

  it('a market_insight match (a roof permit for a roofer) is stored for the feed but never mailed, and is marked notified', async () => {
    const res = await run(
      [sig(1, { title: 'Roof permit in Atlanta', categories: ['roofing'] }), sig(2, { title: 'Wind damage reported near Smyrna', source: 'spc', kind: 'report', categories: ['roofing'] })],
      async () => new Map(),
      { categories: ['roofing'] },
    );
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    const mail = sent[0].html + sent[0].text;
    expect(mail).toContain('Wind damage reported near Smyrna');
    expect(mail).not.toContain('Roof permit in Atlanta');
    expect(marked.flat()).toContain(10); // the permit's match id (signal 1 * 10): marked notified without a mail
  });

  it('only market_insight matches: no email at all, the matches are marked notified', async () => {
    const res = await run([sig(1, { title: 'Roof permit in Atlanta', categories: ['roofing'] })], async () => new Map(), { categories: ['roofing'] });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
    expect(marked.flat()).toContain(10);
  });
});
