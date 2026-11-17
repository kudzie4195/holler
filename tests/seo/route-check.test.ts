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
