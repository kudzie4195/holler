/**
 * Round 17, unit ES: the real /app page for a Spanish member, an English member, and a member whose profile row has no language key
 * (migration 0024 not applied). Harness follows tests/signals/ship-page.test.ts: mocked session, match rows from the real parsers, real
 * Feed and real label, deadline and brief logic.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOW, iso } from '../signals/brief-fixtures';
import { shipCases } from '../signals/ship-fixtures';
import { spanishProblems } from '@/lib/i18n/rules';
import { localizeTitle } from '@/lib/signals/title-i18n';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '·').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

async function renderApp(language: 'es' | 'en' | 'absent', opts: { empty?: boolean; aiNote?: boolean } = {}) {
  const cases = await shipCases();
  const pick = (re: RegExp) => cases.find((c) => re.test(c.name))!;
  const chosen = opts.empty ? [] : [pick(/registered company/), pick(/Raleigh/), pick(/own-trade permit/), pick(/federal bid/), pick(/hail report/)];
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.doMock('server-only', () => ({}));
  const profile: Record<string, unknown> = {
    user_id: 'u1', business_name: 'Taller Los Pinos', categories: ['roofing', 'hvac', 'painting'], zip: '30301', city: 'Atlanta', state: 'GA', lat: 33.75, lon: -84.39,
    radius_mi: 25, alert_email: true, subscription_status: 'active', trial_ends_at: iso(-86_400_000), plan: 'pro',
    stripe_customer_id: null, stripe_subscription_id: null, email_verified_at: iso(-86_400_000), created_at: iso(-30 * 86_400_000),
  };
  if (language !== 'absent') profile.language = language;
  vi.doMock('@/lib/auth/session', () => ({ requireProfile: async () => ({ user: { id: 'u1' }, profile }), getProfile: async () => profile }));
  const rows = chosen.map((c, i) => {
    const d = (c.signal.data ?? {}) as Record<string, unknown>;
    return {
      id: i + 1, status: 'new', distance_mi: 3, draft: null, created_at: iso(-3_600_000 * (i + 1)),
      signal: {
        id: c.signal.id, source: c.signal.source, kind: c.signal.kind, title: c.signal.title, summary: c.signal.summary ?? null, url: c.signal.url ?? null,
        city: c.signal.city ?? null, state: c.signal.state ?? null, county: null, zip: null, occurred_at: c.signal.occurredAt, expires_at: c.signal.expiresAt ?? null,
        severity: c.signal.severity, categories: c.signal.categories, subtype: (d.subtype as string | undefined) ?? null, approxLocation: null,
        dueDate: (d.dueDate as string | undefined) ?? null, bidBuyer: (d.buyer as string | undefined) ?? null,
        jobValue: d.jobValue === undefined ? null : String(d.jobValue), managerName: (d.managerName as string | undefined) ?? null, managerRole: (d.managerRole as string | undefined) ?? null,
      },
    };
  });
  vi.doMock('@/lib/supabase/server', () => ({
    createClient: async () => {
      const q: any = {};
      q.from = () => q;
      q.select = () => q;
      for (const m of ['eq', 'order']) q[m] = () => q;
      q.limit = async () => ({ data: rows, error: null });
      return q;
    },
  }));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
  vi.doMock('@/lib/feedback/service', () => ({ loadFeedback: async () => new Map() }));
  vi.doMock('@/lib/ai', async (orig) => ({
    ...(await orig<typeof import('@/lib/ai')>()),
    notesFor: async () => (opts.aiNote ? new Map(chosen.map((c) => [c.signal.id, 'A roof inspection may follow this record.'])) : new Map()),
    scoresFor: async () => new Map(),
  }));
  vi.doMock('@/lib/outreach/loader', () => ({
    loadMemberContacts: async ({ signalIds }: { signalIds: number[] }) =>
      new Map(chosen.filter((c) => c.contacts?.length && signalIds.includes(c.signal.id)).map((c) => [c.signal.id, c.contacts!.map((k) => ({ ...k, signalId: c.signal.id }))])),
  }));
  vi.doMock('@/lib/signals/source-state-snapshot', () => ({
    loadSourceStateSnapshot: async () => ({
      generatedAt: NOW.toISOString(),
      states: { 'arcgis-atlanta-permits': { state: 'delayed', lastRecordAt: iso(-9 * 3_600_000) }, nws: { state: 'healthy', lastRecordAt: iso(-60_000) } },
    }),
  }));
  vi.doMock('@/app/app/actions', () => ({ setMatchStatus: async () => ({ ok: true }), getRequestReplyStates: async () => ({}), submitFeedback: async () => ({ ok: true }) }));
  vi.doMock('@/components/coming-next-member', () => ({ ComingNextForMember: () => null }));
  vi.doMock('@/components/billing-button', () => ({ BillingButton: () => null }));
  vi.doMock('@/components/feed/empty-feed', () => ({ EmptyFeed: () => null, emptyFeedApplies: (o: { items: number; locked: boolean; failed: boolean }) => o.items === 0 && !o.locked && !o.failed }));
  const AppHome = (await import('@/app/app/page')).default;
  const html = renderToStaticMarkup(await AppHome({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never));
  return { html, chosen };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('/app for a Spanish member', () => {
  it('header, filters, the five-part brief, buttons and distance are Spanish; titles stay as the source wrote them', async () => {
    const { html, chosen } = await renderApp('es');
    const t = text(html);
    expect(t).toContain('Sus coincidencias');
    expect(t).toContain('Taller Los Pinos, a menos de 25 mi de Atlanta, GA.');
    expect(t).toContain('Personas que piden ayuda');
    expect(t).toContain('Por qué importa:');
    expect(t).toContain('Próximo paso:');
    expect(t).toContain('Fuente:');
    expect(t).toContain('Qué es incierto:');
    expect(t).toMatch(/Guardar|Descartar/);
    for (const c of chosen) expect(t).toContain(localizeTitle(c.signal.title, 'es', c.signal.source).replace(/&/g, '&'));
    // English chrome is gone
    for (const english of ['Your matches', 'Why it matters', 'Next step', 'What is uncertain', 'People asking', 'Dismiss', 'Was this alert helpful?']) expect(t, english).not.toContain(english);
  });
  it('the coverage line ("a source near you is behind") is Spanish', async () => {
    const { html } = await renderApp('es');
    expect(text(html)).toMatch(/Es posible que aquí falten algunos registros recientes/);
    expect(text(html)).not.toContain('Some recent records may be missing');
  });
  it('the rendered Spanish chrome breaks no Spanish wording rule', async () => {
    const { html, chosen } = await renderApp('es');
    let t = text(html);
    for (const c of chosen) for (const v of [localizeTitle(c.signal.title, 'es', c.signal.source) === c.signal.title ? c.signal.title : '', c.signal.summary ?? '']) if (v) t = t.split(v.replace(/&/g, '&')).join(' ');
    expect(spanishProblems(t)).toEqual([]);
  });
  it('the AI note (English, written by the model) is not shown to a Spanish member, and is shown to an English one', async () => {
    const es = await renderApp('es', { aiNote: true });
    expect(text(es.html)).not.toContain('A roof inspection may follow this record.');
    const en = await renderApp('en', { aiNote: true });
    expect(text(en.html)).toContain('A roof inspection may follow this record.');
  });
  it('an empty feed is the short Spanish card with a link to /es/check', async () => {
    const { html } = await renderApp('es', { empty: true });
    expect(text(html)).toContain('Todavía no hay coincidencias');
    expect(html).toContain('href="/es/check?zip=30301&amp;trade=roofing"');
  });
});

describe('/app when the language is English, or the column does not exist', () => {
  it('a profile with no language key renders exactly the same page as language "en"', async () => {
    const a = await renderApp('absent');
    const b = await renderApp('en');
    expect(a.html).toBe(b.html);
    const t = text(a.html);
    expect(t).toContain('Your matches');
    expect(t).toContain('Taller Los Pinos, within 25 mi of Atlanta, GA.');
    expect(t).toContain('Why it matters:');
    expect(t).toContain('People asking');
  });
});
