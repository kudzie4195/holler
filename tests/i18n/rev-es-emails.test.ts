/**
 * Round 18 ES redo 1: the reviewer's email probe (gates/r18/logs/REV-ES-probe-tests/rev-es-emails.probe.test.ts) kept as a regression
 * test. Renders every account and lifecycle email in Spanish and English with the real render functions (the lifecycle ones through the
 * real buildMail with a fake store) and checks where every link points and that both languages state the same numbers. Samples are
 * written to REV_ES_SAMPLES when it is set, otherwise to a temporary folder.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const SITE = 'https://localholler.test';
vi.mock('@/lib/env', async (orig) => {
  const real = await orig<typeof import('@/lib/env')>();
  return { ...real, env: { ...real.env, SUPPORT_EMAIL: 'help@localholler.test', CRON_SECRET: 'probe-secret' }, siteUrl: SITE };
});

const OUT = process.env.REV_ES_SAMPLES ?? join(tmpdir(), 'holler-rev-es-samples');
const NOW = new Date('2026-11-22T15:00:00Z');
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const items = [
  { title: 'Roof permit in Smyrna', city: 'Smyrna', state: 'GA', occurredAt: ago(20), kind: 'permit', source: 'arcgis-atlanta-permits', subtype: 'permit', severity: 2 },
  { title: '1.75 inch hail reported near Smyrna, GA', city: 'Smyrna', state: 'GA', occurredAt: ago(30), kind: 'report', source: 'spc', subtype: null, severity: 3 },
  { title: 'Severe Thunderstorm Warning', city: 'Marietta', state: 'GA', occurredAt: ago(40), kind: 'alert', source: 'nws', subtype: null, severity: 2 },
  { title: '311 request in Atlanta: tree down', city: 'Atlanta', state: 'GA', occurredAt: ago(50), kind: 'civic', source: 'socrata-atlanta-311', subtype: '311', severity: 1 },
];
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
const urlsInText = (text: string) => text.match(/https?:\/\/[^\s)]+/g) ?? [];
const save = (name: string, lang: string, r: { subject: string; html: string; text: string }) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/email-${name}.${lang}.txt`, `Subject: ${r.subject}\n\n${r.text}`);
  writeFileSync(`${OUT}/email-${name}.${lang}.html`, r.html);
};

async function renderAll(lang: 'es' | 'en') {
  const tpl = await import('@/lib/email/templates');
  const { renderConfirmEmailOnly } = await import('@/lib/mobile/verify-email');
  const { verifyUrlFor } = await import('@/lib/auth/verification');
  const { buildMail } = await import('@/lib/lifecycle/run');
  const life = await import('@/lib/lifecycle/templates');
  const moat = await import('@/lib/moat/email');
  const L = lang === 'en' ? {} : { lang };
  const out: Record<string, { subject: string; html: string; text: string }> = {};
  const verifyUrl = verifyUrlFor('11111111-1111-4111-8111-111111111111', lang)!;
  out.verify = tpl.renderVerifyEmail({ verifyUrl, appUrl: `${SITE}/app`, ...L });
  out.welcome = tpl.renderWelcome({ businessName: 'Techos García', appUrl: `${SITE}/app`, ...L });
  out['confirm-only'] = renderConfirmEmailOnly({ verifyUrl, appUrl: `${SITE}/app` }, lang);
  const resetUrl = `${SITE}/auth/confirm?token_hash=abc123&type=recovery&next=${encodeURIComponent(lang === 'en' ? '/reset' : '/es/reset')}`;
  out.reset = tpl.renderPasswordReset({ resetUrl, ...L });
  // the four lifecycle emails, through the real builder (links from siteUrl)
  const p: any = { user_id: '11111111-1111-4111-8111-111111111111', business_name: 'Techos García' };
  const deps = (store: any) => ({ store, siteUrl: SITE, secret: 'probe-secret', ...(lang === 'en' ? {} : { langFor: async () => lang }) });
  const withMatches: any = { matchesOf: async () => ({ total: 12, capped: true, items }), quietPreview: async () => null, missedSince: async () => ({ count: 7, capped: false }), bestOf: async () => items };
  const quiet: any = { matchesOf: async () => ({ total: 0, capped: false, items: [] }), quietPreview: async () => ({ lines: [{ label: 'building permits', count: 41, key: 'permit' }, { label: 'storm reports', count: 6, key: 'storm-report' }, { label: '311 requests', count: 1, key: '311' }], total: 48, capped: false, days: 90 }), missedSince: async () => ({ count: 0, capped: false }) };
  out['life-welcome-matches'] = (await buildMail('welcome', p, deps(withMatches) as any, NOW))!;
  out['life-welcome-quiet'] = (await buildMail('welcome', p, deps(quiet) as any, NOW))!;
  out['life-trial-ending'] = life.renderTrialEnding({ businessName: 'Techos García', feedUrl: `${SITE}/app`, plansUrl: `${SITE}/app/settings#billing-h`, unsubscribeUrl: `${SITE}/api/cron/lifecycle/unsubscribe?t=tok`, items: items.slice(0, 3), ...L });
  out['life-trial-ending-none'] = life.renderTrialEnding({ businessName: 'Techos García', feedUrl: `${SITE}/app`, plansUrl: `${SITE}/app/settings#billing-h`, unsubscribeUrl: `${SITE}/api/cron/lifecycle/unsubscribe?t=tok`, items: [], ...L });
  out['life-trial-ended'] = (await buildMail('trial_ended', p, deps(withMatches) as any, NOW))!;
  out['outcome-question'] = moat.renderFollowUp({
    businessName: 'Techos García',
    items: items.slice(0, 2).map((i, n) => ({ title: i.title, kind: i.kind, source: i.source, place: `${i.city}, ${i.state}`, occurredAt: i.occurredAt, yesUrl: `${SITE}/api/feedback/outcome?t=yes${n}${lang === 'en' ? '' : '&l=es'}`, noUrl: `${SITE}/api/feedback/outcome?t=no${n}${lang === 'en' ? '' : '&l=es'}` })),
    unsubscribeUrl: `${SITE}/api/cron/notify/unsubscribe?t=tok`,
    now: NOW,
    ...L,
  });
  return out;
}

describe('review probe: the Spanish emails', () => {
  it('renders every email in es and en and saves the samples', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    for (const lang of ['es', 'en'] as const) {
      const all = await renderAll(lang);
      for (const [name, r] of Object.entries(all)) {
        expect(r, `${name} ${lang}`).toBeTruthy();
        save(name, lang, r);
      }
    }
    vi.useRealTimers();
  });

  it('every link in a Spanish email is on the site origin (or mailto:), and token links go only to no-referrer paths', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { TOKEN_PAGE_PATHS } = await import('@/lib/security-headers');
    const all = await renderAll('es');
    const report: string[] = [];
    for (const [name, r] of Object.entries(all)) {
      const links = [...new Set([...hrefs(r.html), ...urlsInText(r.text)])];
      for (const l of links) {
        if (l.startsWith('mailto:')) continue;
        const u = new URL(l);
        report.push(`${name}: ${u.origin}${u.pathname}${u.search ? '?' + [...u.searchParams.keys()].join('&') : ''}${u.hash}`);
        expect(u.origin, `${name} ${l}`).toBe(SITE);
        const hasToken = ['t', 'token', 'token_hash'].some((k) => u.searchParams.has(k));
        if (hasToken) expect(TOKEN_PAGE_PATHS as readonly string[], `${name} token link ${u.pathname}`).toContain(u.pathname);
      }
      expect(r.html, name).toContain('lang="es"');
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/email-links.es.txt`, [...new Set(report)].join('\n') + '\n');
    vi.useRealTimers();
  });

  it('the Spanish emails state the same trial length, prices and link lifetimes as the English ones', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const es = await renderAll('es');
    const en = await renderAll('en');
    const nums = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\$?\d+(?:[.,]\d+)?%?/g) ?? []).sort().join(' ');
    const diff: string[] = [];
    for (const k of Object.keys(es)) if (nums(es[k].text) !== nums(en[k].text)) diff.push(`${k}\n   es: ${nums(es[k].text)}\n   en: ${nums(en[k].text)}`);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/email-number-diff.txt`, diff.length ? diff.join('\n') + '\n' : 'every number (prices, days, counts) is the same in es and en\n');
    expect(diff).toEqual([]);
    vi.useRealTimers();
  });
});
