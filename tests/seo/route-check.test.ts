import { describe, expect, it } from 'vitest';
import { decidePublicRoute } from '../../lib/seo/route-check';
import { CATEGORIES } from '../../lib/signals/categories';
import { CITIES, cityPath, STATES, citiesInState } from '../../lib/geo';

describe('404 decision for public SEO paths', () => {
  it('passes known pages', () => {
    expect(decidePublicRoute('/local')).toBe('ok');
    expect(decidePublicRoute('/local/georgia')).toBe('ok');
    expect(decidePublicRoute('/local/georgia/atlanta-ga')).toBe('ok');
    expect(decidePublicRoute('/local/georgia/atlanta-ga/')).toBe('ok');
    expect(decidePublicRoute('/for')).toBe('ok');
    expect(decidePublicRoute('/for/roofing')).toBe('ok');
  });
  it('404s the three soft-404 cases from the final review', () => {
    expect(decidePublicRoute('/local/texas/atlanta-ga')).toBe('not-found');
    expect(decidePublicRoute('/local/nowhere')).toBe('not-found');
    expect(decidePublicRoute('/local/georgia/nowhere-xx')).toBe('not-found');
  });
  it('404s unknown trades, extra segments and odd encodings', () => {
    expect(decidePublicRoute('/for/not-a-trade')).toBe('not-found');
    expect(decidePublicRoute('/for/roofing/extra')).toBe('not-found');
    expect(decidePublicRoute('/for/ROOFING')).toBe('not-found');
    expect(decidePublicRoute('/local/georgia/atlanta-ga/extra')).toBe('not-found');
    expect(decidePublicRoute('/local/%E0%A4%A')).toBe('not-found');
  });
  it('skips paths it does not own', () => {
    expect(decidePublicRoute('/app')).toBe('skip');
    expect(decidePublicRoute('/login')).toBe('skip');
    expect(decidePublicRoute('/locale')).toBe('skip');
  });
  it('accepts every trade in CATEGORIES, every state with cities and every city page', () => {
    for (const c of CATEGORIES) expect(decidePublicRoute(`/for/${c.id}`), c.id).toBe('ok');
    for (const s of STATES) if (citiesInState(s.code).length) expect(decidePublicRoute(`/local/${s.slug}`), s.slug).toBe('ok');
    for (const c of CITIES) expect(decidePublicRoute(cityPath(c)), c.slug).toBe('ok');
  });
});

describe('storm pages /storms/<state>/<slug>', () => {
  it('passes the index, a known state with a well-formed slug, and the FEMA and city forms', () => {
    expect(decidePublicRoute('/storms')).toBe('ok');
    expect(decidePublicRoute('/storms/georgia/cobb-county-2026-11-14')).toBe('ok');
    expect(decidePublicRoute('/storms/georgia/georgia-fema-2026-10-27')).toBe('ok');
    expect(decidePublicRoute('/storms/georgia/city-of-marietta-2026-11-14')).toBe('ok');
    expect(decidePublicRoute('/storms/georgia/city-of-nowhere-2026-01-01')).toBe('ok'); // right shape, no records: the page decides
  });
  it('404s an unknown state, a bad slug shape, an impossible date and extra segments', () => {
    for (const p of [
      '/storms/nowhere/cobb-county-2026-11-14',
      '/storms/ga/cobb-county-2026-11-14',
      '/storms/georgia',
      '/storms/georgia/nonsense',
      '/storms/georgia/cobb-county',
      '/storms/georgia/cobb-county-2026-13-45',
      '/storms/georgia/cobb-county-2026-02-30',
      '/storms/georgia/Cobb-County-2026-11-14',
      '/storms/georgia/placeholder',
      '/storms/georgia/-2026-11-14',
      '/storms/georgia/cobb-county-2026-11-14/extra',
      `/storms/georgia/${'x'.repeat(130)}-2026-11-14`,
      '/storms/%E0%A4%A/x-2026-11-14',
    ]) expect(decidePublicRoute(p), p).toBe('not-found');
  });
});

describe('weekly pages /local/<state>/<city>/week/<date>', () => {
  // Tuesday 2026-11-17. Mondays: 2026-11-16 (this week), 2026-08-31 (11 weeks ago), 2026-08-24 (12 weeks ago), 2026-11-23 (next).
  const NOW = Date.parse('2026-11-17T12:00:00Z');
  const base = '/local/north-carolina/raleigh-nc/week';
  it('passes this Monday and the Monday 11 weeks ago', () => {
    expect(decidePublicRoute(`${base}/2026-11-16`, NOW)).toBe('ok');
    expect(decidePublicRoute(`${base}/2026-08-31`, NOW)).toBe('ok');
    expect(decidePublicRoute(`${base}/2026-11-16/`, NOW)).toBe('ok');
  });
  it('404s 12 weeks ago, a Tuesday, next Monday and garbage', () => {
    expect(decidePublicRoute(`${base}/2026-08-24`, NOW)).toBe('not-found');
    expect(decidePublicRoute(`${base}/2026-11-17`, NOW)).toBe('not-found');
    expect(decidePublicRoute(`${base}/2026-11-23`, NOW)).toBe('not-found');
    expect(decidePublicRoute(`${base}/garbage`, NOW)).toBe('not-found');
    expect(decidePublicRoute(`${base}/2026-02-30`, NOW)).toBe('not-found');
    expect(decidePublicRoute(`${base}/%E0%A4%A`, NOW)).toBe('not-found');
  });
  it('404s a missing date, extra segments and other words in the week slot', () => {
    expect(decidePublicRoute(base, NOW)).toBe('not-found');
    expect(decidePublicRoute(`${base}/`, NOW)).toBe('not-found');
    expect(decidePublicRoute(`${base}/2026-11-16/extra`, NOW)).toBe('not-found');
    expect(decidePublicRoute('/local/north-carolina/raleigh-nc/weeks/2026-11-16', NOW)).toBe('not-found');
    expect(decidePublicRoute('/local/north-carolina/raleigh-nc/Week/2026-11-16', NOW)).toBe('not-found');
  });
  it('still 404s the city and state checks first', () => {
    expect(decidePublicRoute('/local/georgia/raleigh-nc/week/2026-11-16', NOW)).toBe('not-found');
    expect(decidePublicRoute('/local/nowhere/raleigh-nc/week/2026-11-16', NOW)).toBe('not-found');
    expect(decidePublicRoute('/local/north-carolina/nowhere-xx/week/2026-11-16', NOW)).toBe('not-found');
  });
  it('the window moves with the clock', () => {
    expect(decidePublicRoute(`${base}/2026-11-23`, Date.parse('2026-11-23T00:00:00Z'))).toBe('ok');
    expect(decidePublicRoute(`${base}/2026-08-31`, Date.parse('2026-11-23T00:00:00Z'))).toBe('not-found');
    expect(decidePublicRoute(`${base}/2026-09-07`, Date.parse('2026-11-23T00:00:00Z'))).toBe('ok');
  });
  it('leaves every other path as before', () => {
    expect(decidePublicRoute('/local/georgia/atlanta-ga', NOW)).toBe('ok');
    expect(decidePublicRoute('/local/georgia/atlanta-ga/extra', NOW)).toBe('not-found');
    expect(decidePublicRoute('/for/roofing', NOW)).toBe('ok');
    expect(decidePublicRoute('/app', NOW)).toBe('skip');
  });
});


// Build gate (b) 8a: /guides/<unknown-slug> streamed a 200 not-found page. The proxy now 404s it on the first request, like /for.
describe('guide pages /guides/<slug>', () => {
  it('every known guide slug is ok, and the hub is ok', async () => {
    const { GUIDE_SLUGS } = await import('../../lib/seo/guides');
    expect(GUIDE_SLUGS.length).toBeGreaterThan(0);
    for (const s of GUIDE_SLUGS) expect(decidePublicRoute(`/guides/${s}`), s).toBe('ok');
    expect(decidePublicRoute('/guides')).toBe('ok');
    expect(decidePublicRoute('/guides/')).toBe('ok');
  });
  it('unknown slugs, extra segments and changed case are 404', () => {
    expect(decidePublicRoute('/guides/not-a-guide')).toBe('not-found');
    expect(decidePublicRoute('/guides/storm-damage-leads-from-weather-alerts-and-storm-reports/extra')).toBe('not-found');
    expect(decidePublicRoute('/guides/STORM-DAMAGE-LEADS-FROM-WEATHER-ALERTS-AND-STORM-REPORTS')).toBe('not-found');
    expect(decidePublicRoute('/guides/%E0%A4%A')).toBe('not-found');
  });
  it('proxy.ts runs the check for /guides/<slug> (matcher and branch), not for the hub', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../proxy.ts', import.meta.url), 'utf8');
    expect(src).toContain("'/guides/:path+'");
    expect(src).toContain("pathname.startsWith('/guides/')");
    expect(decidePublicRoute('/guidesx')).toBe('skip');
  });
});

describe('proxy.ts storm paths (review P1-2)', () => {
  it('matcher lists /storms paths and bad shapes get a real 404 rewrite while good shapes pass', async () => {
    const { vi } = await import('vitest');
    vi.doMock('@/lib/supabase/proxy', () => ({ updateSession: async () => new Response('session') }));
    const { NextRequest } = await import('next/server');
    const mod = await import('../../proxy');
    expect(mod.config.matcher).toEqual(expect.arrayContaining(['/storms', '/storms/:path*']));
    const run = async (p: string) => mod.proxy(new NextRequest(`https://localholler.com${p}`));
    for (const p of ['/storms/nowhere/cobb-county-2026-11-14', '/storms/georgia/nonsense', '/storms/georgia/cobb-county-2026-13-45']) {
      const res = await run(p);
      expect(res.status, p).toBe(404);
      expect(res.headers.get('x-middleware-rewrite'), p).toContain('/_holler-not-found');
      expect(res.headers.get('x-robots-tag')).toBe('noindex');
    }
    for (const p of ['/storms', '/storms/georgia/cobb-county-2026-11-14', '/storms/georgia/city-of-nowhere-2026-01-01']) {
      const res = await run(p);
      expect(res.status, p).toBe(200);
      expect(res.headers.get('x-middleware-rewrite'), p).toBeNull();
    }
    vi.doUnmock('@/lib/supabase/proxy');
  });
});
