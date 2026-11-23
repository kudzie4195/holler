/**
 * Round 19 integration, step 3 (r19-rules 9610e98 merged onto r19-ship): the interactions between the rewritten label rules and the code
 * the rules branch never saw (round 18, the merged base, steps 1 and 2).
 *  1. every read path that labels a stored match passes the summary and the permit stage (recordLabelInput) and keeps saved or done
 *     matches visible (keptMatchLabel), lists and lifecycle mail included;
 *  2. the contact gate (alert_hold) and the new rules agree;
 *  3. probation ids and the label exemption;
 *  4. storm rules: see tests/signals/spc-wind-title.test.ts ("round 19 integration" block).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

import { FakeDb } from '../ops/fakedb';
import { createStore } from '@/lib/lifecycle/store';
import { buildAlerts } from '@/lib/mobile/feed';
import { matchSignals, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { labelFor, keptMatchLabel, SOURCE_DEFAULTS } from '@/lib/signals/lead-rules';
import { COVERAGE_R19_SOURCES, LABEL_PENDING_INTEGRATION, PROBATION_SOURCE_IDS } from '@/lib/signals/probation';
import { createsWorkFor, stormListLabel } from '@/lib/lists/core';
import { OpportunityChip } from '@/components/feed/opportunity-chip';

const NOW = new Date('2026-11-20T12:00:00Z');
const read = (f: string) => readFileSync(f, 'utf8');

describe('1. every read path passes summary and stage, and keeps saved or done matches', () => {
  // The labeller calls on member and owner read paths (grep of labelForMember( and labelFor( in app/ and lib/, the report lists them all).
  const PATHS: Array<[string, RegExp]> = [
    ['app/app/page.tsx', /keptMatchLabel\(demoteExpired\(labelForMember\(\{ \.\.\.recordLabelInput\(s\)/],
    ['lib/mobile/feed.ts', /keptMatchLabel\(demoteExpired\(labelForMember\(\{ \.\.\.recordLabelInput\(s\)/],
    ['app/api/cron/notify/route.ts', /labelForMember\(\{ \.\.\.recordLabelInput\(s\)/],
    ['lib/push/notify.ts', /labelForMember\(\{ \.\.\.recordLabelInput\(s\)/],
    ['lib/lifecycle/store.ts', /keptMatchLabel\(labelForMember\(\{ \.\.\.recordLabelInput\(s\)/],
    ['lib/signals/score-admin.ts', /labelForMember\(\{ \.\.\.recordLabelInput\(s\)/],
    ['lib/admin/metros.ts', /labelFor\(recordLabelInput\(s\)/],
    ['lib/admin/metros-load.ts', /labelFor\(recordLabelInput\(s\)/],
    ['lib/admin/contact-path.ts', /summary: s\.summary, permitStage: s\.permitStage/],
  ];
  it('the source of each read path labels through recordLabelInput (or passes summary and stage itself)', () => {
    for (const [f, re] of PATHS) expect(read(f), f).toMatch(re);
    // the stage column is read where the label is computed
    for (const f of ['app/app/page.tsx', 'lib/mobile/feed.ts', 'app/api/cron/notify/route.ts', 'lib/push/notify.ts', 'lib/lifecycle/store.ts', 'lib/signals/score-admin.ts']) expect(read(f), f).toMatch(/STAGE_SELECT/);
    expect(read('lib/lists/load.ts')).toMatch(/permitStage:data->>permitStage/);
  });

  it('lifecycle mail: a saved match the rules now hide is still listed (as a feed item, no chip it no longer earns); a new one is not', async () => {
    const heat = (id: number, status: string) => ({
      id, user_id: 'U', status, created_at: `2026-11-1${id}T00:00:00Z`,
      signal: { id, source: 'socrata-nyc-311', kind: 'civic', subtype: '311', title: '311 request in New York City: HEAT/HOT WATER / ENTIRE BUILDING', summary: null, categories: ['hvac'], city: 'New York', state: 'NY', severity: 2, occurred_at: `2026-11-1${id}T00:00:00Z` },
    });
    expect(labelFor({ source: 'socrata-nyc-311', kind: 'civic', subtype: '311', title: '311 request in New York City: HEAT/HOT WATER / ENTIRE BUILDING' }, 'hvac')).toBe('context');
    const db = new FakeDb({ holler_matches: [heat(1, 'new'), heat(2, 'saved'), heat(3, 'done')] });
    const store = createStore(db as never);
    const r = await store.matchesOf('U', ['hvac']);
    expect(r.items.map((i) => i.id).sort()).toEqual([2, 3]);
    expect(r.items.every((i) => i.label === 'market_insight')).toBe(true);
    expect(keptMatchLabel('context', 'saved')).toBe('market_insight');
  });

  it('lifecycle mail: a permit at a finished stage is labelled from its stage, as on the feed', async () => {
    const rec = { id: 7, source: 'socrata-sf-permits', kind: 'permit', subtype: 'permit', title: 'Remodel permit in San Francisco', summary: 'Alteration | Single Family | 9 ASH ST', categories: ['general-contractor', 'cleaning'], city: 'San Francisco', state: 'CA', severity: 1, occurred_at: '2026-11-17T00:00:00Z' };
    const plain = new FakeDb({ holler_matches: [{ id: 7, user_id: 'U', status: 'new', created_at: '2026-11-17T00:00:00Z', signal: rec }] });
    const staged = new FakeDb({ holler_matches: [{ id: 7, user_id: 'U', status: 'new', created_at: '2026-11-17T00:00:00Z', signal: { ...rec, permitStage: 'final_inspection' } }] });
    const a = await createStore(plain as never).matchesOf('U', ['cleaning']);
    const b = await createStore(staged as never).matchesOf('U', ['cleaning']);
    expect(a.items[0]?.label).toBe('market_insight');
    expect(b.items[0]?.label).toBe('coming_soon');
  });

  it('address lists: a finished stage is read like the feed, and a storm list reads the report remark the round 19 storm rules need', () => {
    const remodel = { source: 'socrata-sf-permits', kind: 'permit', subtype: 'permit', title: 'Remodel permit in X', summary: 'Alteration | Single Family | 9 ASH ST' };
    expect(createsWorkFor(remodel, 'cleaning')).toBe(false);
    expect(createsWorkFor({ ...remodel, permitStage: 'final_inspection' }, 'cleaning')).toBe(true);
    const storm = (comments: string) => ({
      id: 1, source: 'spc', kind: 'report', title: 'Wind damage reported near 2 N Smyrna, GA', lat: 33.9, lon: -84.5, city: 'Smyrna', state: 'GA', occurred_at: '2026-11-20T00:00:00Z',
      url: null, categories: ['roofing', 'tree-service'], stormType: 'wind', hailInches: null, windMph: null, comments,
    });
    // the remark names the roof: act now for a roofer (round 19 line 39); a remark about trees only: a heads-up for the roofer
    expect(stormListLabel(storm('Roof blown off a house.') as never, ['roofing'], NOW.getTime())).toBe('act_now');
    expect(stormListLabel(storm('Trees down.') as never, ['roofing'], NOW.getTime())).toBe('coming_soon');
  });
});

describe('2. the contact gate and the new rules agree', () => {
  const LOC = { lat: 33.75, lon: -84.39 };
  const member = (categories: string[]): MatchProfile => ({ user_id: 'm1', categories, lat: LOC.lat, lon: LOC.lon, state: 'GA', radius_mi: 25 });
  const permit = (title: string, summary: string, categories: string[]): MatchSignal => ({
    id: Math.floor(Math.random() * 1e9), source: 'arcgis-dekalb-permits', kind: 'permit', subtype: 'permit', title, summary, categories,
    lat: LOC.lat + 0.01, lon: LOC.lon, state: 'GA', severity: 1, occurred_at: '2026-11-19T00:00:00Z', data: { subtype: 'permit' }, contactPath: null,
  });

  it('the gate holds only what the rules call an alert: a feed-only card is never held "Background", a context card makes no row at all', () => {
    const newHome = permit('New home permit in DeKalb County', 'New | 1 or 2 Family Dwelling | Issued', ['general-contractor', 'real-estate', 'moving']);
    const remodel = permit('Remodel permit in DeKalb County', 'Alteration | Single Family | Issued', ['general-contractor']);
    const rows = matchSignals([newHome, remodel], [member(['landscaping', 'painting'])], undefined, NOW, false);
    const byId = new Map(rows.map((r) => [r.signal_id, r]));
    // landscaping on a new home: a heads-up with no contact path, so held
    expect(byId.get(newHome.id)).toMatchObject({ alert_hold: 'background' });
    // painting on a remodel: feed only under owner call 2, so never held (nothing to hold), still in the feed
    expect(byId.get(remodel.id)).toBeDefined();
    expect(byId.get(remodel.id)).not.toHaveProperty('alert_hold');
    // a record the rules make context for every trade is not matched, so it can never come back through the held path
    const graffiti: MatchSignal = { ...permit('311 request in Chicago: Graffiti Removal', 'Graffiti on public property', ['painting']), source: 'socrata-chicago-311', kind: 'civic', subtype: '311', data: { subtype: '311' } };
    expect(matchSignals([graffiti], [member(['painting'])], undefined, NOW, false)).toEqual([]);
  });

  it('a held card in the feed shows its hold, never an urgent or heads-up chip; a held card the rules now call context is not shown', async () => {
    const chip = renderToStaticMarkup(createElement(OpportunityChip, { label: 'act_now', lang: 'en', hold: 'background' }));
    expect(chip).toContain('Background');
    expect(chip).not.toMatch(/Act now|Coming soon/);
    const row = (id: number, title: string, summary: string, categories: string[]) => ({
      id, status: 'new', distance_mi: 2, draft: null, created_at: NOW.toISOString(), alert_hold: 'background',
      signal: { id: 100 + id, source: 'arcgis-dekalb-permits', kind: 'permit', title, summary, url: null, city: 'Decatur', state: 'GA', county: null, zip: null, severity: 1, categories, occurred_at: NOW.toISOString(), expires_at: null, subtype: 'permit' },
    });
    const deps = { userId: 'u1', locked: false, db: new FakeDb() as never, admin: null, siteUrl: 'https://localholler.com', now: NOW.getTime(), trades: ['moving', 'painting'] };
    const out = await buildAlerts([
      row(1, 'New home permit in DeKalb County', 'New Construction | Issued', ['general-contractor', 'real-estate', 'moving']),
      // a stored held card that the round 19 rules now call context for this member (public graffiti: the city does it): not shown
      { ...row(2, '311 request in Chicago: Graffiti Removal', 'Graffiti on public property', ['painting']), signal: { ...row(2, '311 request in Chicago: Graffiti Removal', 'Graffiti on public property', ['painting']).signal, source: 'socrata-chicago-311', kind: 'civic', subtype: '311' } },
    ] as never, deps);
    expect(out.map((a) => a.signalId)).toEqual([101]);
    expect(out[0].hold).toBe('background');
  });

  it('the digest and the push never read a held card (alert_hold is filtered and the row is stored notified and pushed)', () => {
    expect(read('app/api/cron/notify/route.ts')).toMatch(/const held = current\.filter\(\(r\) => !!holdOf\(r\.m\)\)/);
    expect(read('lib/push/notify.ts')).toMatch(/holdOf/);
    expect(read('lib/signals/run.ts')).toMatch(/if \(r\.alert_hold\) Object\.assign\(r, \{ notified: true, pushed_at: now\.toISOString\(\) \}\)/);
  });
});

describe('3. probation and the label exemption', () => {
  it('the eight coverage ids have no SOURCE_DEFAULTS entry and are exempt only while on probation; the Philadelphia three have had entries since r19-metros', () => {
    // 11 round-19 probation sources; round 20 page watch adds its bids-pw-* pages (all on probation, labels proposed in proposed-labels.ts).
    expect([...PROBATION_SOURCE_IDS].filter((id) => !id.startsWith('bids-pw-'))).toHaveLength(11);
    for (const s of COVERAGE_R19_SOURCES) expect(SOURCE_DEFAULTS[s.id], s.id).toBeUndefined();
    for (const id of ['carto-phl-permits', 'carto-phl-violations', 'carto-phl-business']) expect(SOURCE_DEFAULTS[id], id).toBeDefined();
    expect([...LABEL_PENDING_INTEGRATION].filter((id) => !id.startsWith('bids-pw-')).sort()).toEqual(COVERAGE_R19_SOURCES.map((s) => s.id).sort());
    const t = read('tests/signals/lead-rules.test.ts');
    expect(t).toMatch(/a\.probation && LABEL_PENDING_INTEGRATION\.includes\(a\.id\) && !\(a\.id in SOURCE_DEFAULTS\)/);
  });
});
