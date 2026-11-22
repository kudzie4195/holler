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
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('@/lib/outreach/loader');
    vi.doUnmock('@/lib/supabase/admin');
    vi.doUnmock('@/lib/email');
    sent.length = 0;
  });

  function adminFake(matches: unknown[]) {
    return {
      from(table: string) {
        const q: Record<string, unknown> = {};
        let patch: unknown = null;
        for (const m of ['select', 'eq', 'order']) q[m] = () => q;
        q.range = () => Promise.resolve({ data: table === 'holler_matches' ? matches : [], error: null });
        q.update = (p: unknown) => ((patch = p), q);
        q.in = () =>
          patch
            ? Promise.resolve({ error: null })
            : Promise.resolve({
                // u2: the digest labels each match for the member's trades (gutters for the re-roof permits, commercial cleaning for a licence).
                data: [{ user_id: 'u1', business_name: 'Acme', categories: ['siding-gutters', 'janitorial-commercial'], alert_email: true, subscription_status: 'active', trial_ends_at: null, last_notified_at: null, email_verified_at: '2026-11-01T00:00:00Z', created_at: '2026-11-01T00:00:00Z' }],
                error: null,
              });
        q.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res);
        return q;
      },
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'owner@acme.test' } }, error: null }) } },
    };
  }

  async function run(matches: unknown[], loaderImpl: (db: unknown, userId: string, ids: number[]) => Promise<Map<number, unknown[]>>) {
    vi.resetModules();
    vi.stubEnv('CRON_SECRET', 's3cret');
    vi.doMock('server-only', () => ({}));
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminFake(matches) }));
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
    // u2: a re-roof permit title, which is Coming soon for a gutter company (an untitled permit with no trade label is context).
    signal: { id, kind: 'permit', source: 'socrata-chicago-permits', title: `Roof permit in Atlanta #${id}`, categories: ['roofing'], url: 'https://example.com', city: 'Atlanta', state: 'GA', occurred_at: new Date(NOW.getTime() - 3_600_000).toISOString(), ...over },
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
    expect(sent[0].html).toContain('Roof permit in Atlanta #1');
    expect(sent[0].html).not.toContain('Contact:');
  });
  // u2: was 'the email intent label comes from the signal subtype: a business licence reads "Money being spent"'. The digest now
  // labels by opportunity for the member's trade, and a city-work 311 request is context, so it is not mailed at all.
  it('the email label comes from the opportunity: a business licence reads "Coming soon" with its next step; a pothole request is left out', async () => {
    const res = await run(
      [
        sig(1, { kind: 'civic', source: 'socrata-chicago-business', subtype: 'business', title: 'New business licence', summary: 'Retail Food Establishment | Preparation of Food and Dining on Premises With Seating' }),
        sig(2, { kind: 'civic', source: 'socrata-chicago-311', subtype: '311', title: 'Pothole request' }),
      ],
      async () => new Map(),
    );
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    const html = sent[0].html;
    const text = sent[0].text;
    expect(html).toContain('Coming soon');
    expect(text).toContain('Coming soon. A new business license was issued here');
    expect(text).toContain('Next step: Introduce yourself while the business is getting set up.');
    expect(text).toContain('Not known: ');
    expect(html).not.toContain('Money being spent');
    expect(text).not.toContain('Pothole request');
    expect(text.indexOf('New business licence')).toBeLessThan(text.indexOf('Coming soon. A new business'));
  });
});
