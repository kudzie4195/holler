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

