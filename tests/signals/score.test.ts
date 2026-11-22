// Round 15 unit F (PLAN-2.0 item 2.7): deterministic score v1. Pure functions, no clock of their own, no randomness.
// Sourced: weights and thresholds are the brief's (contact +30, value > $10k +20, fresh < 48h +20, trade fit +20, low competition +10, N = 3).
// Assumed: the data.valueUsd / data.jobValueUsd field names (a guess for the extractors; the summary text "$N job value" is the real source today).
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  FRESH_MS,
  LOW_COMPETITION_BELOW,
  SCORE_MAX,
  SCORE_POINTS,
  VALUE_MIN_USD,
  feedScoreFor,
  hasNamedContact,
  isExactTradeFit,
  orderByLabelScore,
  scoreOf,
  valueUsdOf,
} from '@/lib/signals/score';
import { matchOne, matchSignals, membersOfTrade, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { buildScoreReport } from '@/lib/signals/score-admin';
import { LABEL_RANK } from '@/lib/signals/lead-rules';
import fs from 'node:fs';
import path from 'node:path';

const NOW = new Date('2026-11-21T16:00:00Z');
const nowMs = NOW.getTime();
const ago = (ms: number) => new Date(nowMs - ms).toISOString();
const HOUR = 3_600_000;
const none = { nowMs, tradeFit: false };

describe('score parts', () => {
  it('weights sum to 100 and an empty input scores 0', () => {
    expect(Object.values(SCORE_POINTS).reduce((a, b) => a + b, 0)).toBe(SCORE_MAX);
    expect(scoreOf(none)).toEqual({ score: 0, parts: { contact: 0, value: 0, fresh: 0, tradeFit: 0, lowCompetition: 0 } });
  });
  it('contact +30', () => {
    expect(scoreOf({ ...none, hasContact: true }).score).toBe(30);
    expect(scoreOf({ ...none, hasContact: false }).score).toBe(0);
    expect(scoreOf({ ...none, hasContact: null }).score).toBe(0);
  });
  it('value +20 only when strictly above $10,000', () => {
    expect(scoreOf({ ...none, valueUsd: VALUE_MIN_USD }).parts.value).toBe(0);
    expect(scoreOf({ ...none, valueUsd: 10_000.01 }).parts.value).toBe(20);
    expect(scoreOf({ ...none, valueUsd: 10_001 }).parts.value).toBe(20);
    expect(scoreOf({ ...none, valueUsd: 9_999 }).parts.value).toBe(0);
    expect(scoreOf({ ...none, valueUsd: null }).parts.value).toBe(0);
    expect(scoreOf({ ...none, valueUsd: Number.NaN }).parts.value).toBe(0);
    expect(scoreOf({ ...none, valueUsd: 2_000_000 }).parts.value).toBe(20);
  });
  it('fresh +20 only when under 48 hours old', () => {
    expect(scoreOf({ ...none, occurredAt: ago(1 * HOUR) }).parts.fresh).toBe(20);
    expect(scoreOf({ ...none, occurredAt: ago(47.9 * HOUR) }).parts.fresh).toBe(20);
    expect(scoreOf({ ...none, occurredAt: ago(FRESH_MS) }).parts.fresh).toBe(0);
    expect(scoreOf({ ...none, occurredAt: ago(49 * HOUR) }).parts.fresh).toBe(0);
    expect(scoreOf({ ...none, occurredAt: null }).parts.fresh).toBe(0);
    expect(scoreOf({ ...none, occurredAt: 'not a date' }).parts.fresh).toBe(0);
  });
  it('a record dated days ahead (an upcoming event) is not fresh; a few minutes of clock skew is', () => {
    expect(scoreOf({ ...none, occurredAt: ago(-3 * 24 * HOUR) }).parts.fresh).toBe(0);
    expect(scoreOf({ ...none, occurredAt: ago(-60_000) }).parts.fresh).toBe(20);
    expect(scoreOf({ ...none, occurredAt: ago(-10 * 60_000) }).parts.fresh).toBe(0);
  });
  it('trade fit +20', () => {
    expect(scoreOf({ ...none, tradeFit: true }).score).toBe(20);
  });
  it('low competition +10 only with fewer than 3 members of the trade, the member included; unknown is 0', () => {
    expect(LOW_COMPETITION_BELOW).toBe(3);
    expect(scoreOf({ ...none, competitors: 1 }).parts.lowCompetition).toBe(10);
    expect(scoreOf({ ...none, competitors: 2 }).parts.lowCompetition).toBe(10);
    expect(scoreOf({ ...none, competitors: 3 }).parts.lowCompetition).toBe(0);
    expect(scoreOf({ ...none, competitors: 40 }).parts.lowCompetition).toBe(0);
    expect(scoreOf({ ...none, competitors: null }).parts.lowCompetition).toBe(0);
    expect(scoreOf({ ...none, competitors: undefined }).parts.lowCompetition).toBe(0);
  });
  it('everything together is 100, and the parts add up', () => {
    const r = scoreOf({ hasContact: true, valueUsd: 50_000, occurredAt: ago(HOUR), nowMs, tradeFit: true, competitors: 1 });
    expect(r.score).toBe(100);
    expect(Object.values(r.parts).reduce((a, b) => a + b, 0)).toBe(r.score);
  });
  it('is deterministic: the same input twice gives the same score', () => {
    const i = { hasContact: true, valueUsd: 12_000, occurredAt: ago(30 * HOUR), nowMs, tradeFit: true, competitors: 2 };
    expect(scoreOf(i)).toEqual(scoreOf({ ...i }));
  });
});

describe('contact, value and trade fit helpers', () => {
  it('a named organisation counts; a bare job-site address does not', () => {
    expect(hasNamedContact([{ role: 'contractor', name: 'Acme Roofing LLC' }])).toBe(true);
    expect(hasNamedContact([{ role: 'site', name: '' }])).toBe(false);
    expect(hasNamedContact([{ role: 'site', name: '100 Main St' }])).toBe(false);
    expect(hasNamedContact([{ role: 'contractor', name: '  ' }])).toBe(false);
    expect(hasNamedContact([])).toBe(false);
    expect(hasNamedContact(null)).toBe(false);
  });
  it('valueUsdOf reads the job value a record publishes', () => {
    expect(valueUsdOf({ summary: 'Reroof | $42,791 job value | 100 Main St' })).toBe(42_791);
    expect(valueUsdOf({ summary: 'Reroof | $8500 job value' })).toBe(8_500);
    expect(valueUsdOf({ summary: 'Reroof | $1,250,000.50 job value' })).toBe(1_250_000);
    expect(valueUsdOf({ summary: 'no value here' })).toBeNull();
    expect(valueUsdOf({ summary: null })).toBeNull();
    expect(valueUsdOf({ summary: 'x', data: { valueUsd: 15_000 } })).toBe(15_000);
    expect(valueUsdOf({ summary: 'x', data: { jobValueUsd: 22_000 } })).toBe(22_000);
    expect(valueUsdOf({ summary: '$3,000 job value', data: { valueUsd: 'many' } })).toBe(3_000);
  });
  it('exact trade fit: own tag, and not a downstream route', () => {
    const roofPermit = { source: 'socrata-chicago-permits', kind: 'civic', subtype: 'permit', title: 'Roof permit in Chicago' };
    expect(isExactTradeFit(roofPermit, ['roofing'], 'roofing')).toBe(true);
    // a gutter company sees a roof permit through routing: downstream, not exact
    expect(isExactTradeFit(roofPermit, ['roofing', 'siding-gutters'], 'siding-gutters')).toBe(false);
    expect(isExactTradeFit(roofPermit, ['roofing'], 'plumbing')).toBe(false);
    expect(isExactTradeFit(roofPermit, ['roofing'], null)).toBe(false);
    expect(isExactTradeFit(roofPermit, null, 'roofing')).toBe(false);
  });
});

describe('ordering: label first, then score, then the order the surface already had', () => {
  type It = { id: string; label: 'act_now' | 'coming_soon' | 'market_insight' | 'context'; score?: number | null };
  const by = (xs: It[]) => orderByLabelScore(xs, (x) => x.label, (x) => x.score).map((x) => x.id);
  it('a higher label beats any score', () => {
    expect(by([{ id: 'mi100', label: 'market_insight', score: 100 }, { id: 'an0', label: 'act_now', score: 0 }, { id: 'cs50', label: 'coming_soon', score: 50 }])).toEqual(['an0', 'cs50', 'mi100']);
  });
  it('inside a label, the higher score goes first', () => {
    expect(by([{ id: 'a', label: 'coming_soon', score: 20 }, { id: 'b', label: 'coming_soon', score: 70 }, { id: 'c', label: 'coming_soon', score: 40 }])).toEqual(['b', 'c', 'a']);
  });
  it('ties keep the existing order (stable), and a missing score counts as 0', () => {
    expect(by([{ id: 'a', label: 'act_now', score: 40 }, { id: 'b', label: 'act_now', score: 40 }, { id: 'c', label: 'act_now', score: null }, { id: 'd', label: 'act_now' }])).toEqual(['a', 'b', 'c', 'd']);
  });
  it('does not mutate its input', () => {
    const xs: It[] = [{ id: 'a', label: 'market_insight', score: 1 }, { id: 'b', label: 'act_now', score: 1 }];
    by(xs);
    expect(xs.map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('uses the same label rank as the rest of the product', () => {
    expect(LABEL_RANK.act_now).toBeLessThan(LABEL_RANK.coming_soon);
    expect(LABEL_RANK.coming_soon).toBeLessThan(LABEL_RANK.market_insight);
  });
  it('feedScoreFor has a ceiling of 90 (no competition term on a feed path)', () => {
    const sig = { source: 'socrata-chicago-permits', kind: 'civic', subtype: 'permit', title: 'Roof permit in Chicago', summary: 'Reroof | $42,791 job value | 1 Main', occurred_at: ago(HOUR), categories: ['roofing'] };
    expect(feedScoreFor(sig, ['roofing'], { hasContact: true, nowMs })).toBe(90);
    expect(feedScoreFor(sig, ['roofing'], { nowMs })).toBe(60);
    expect(feedScoreFor(sig, ['plumbing'], { nowMs })).toBe(40);
  });
});

// ---- the competition count comes from the same pass over the profiles ---------------------------------------------------------------

const profile = (user_id: string, categories: string[], lat = 41.88, lon = -87.63): MatchProfile => ({ user_id, categories, lat, lon, state: 'IL', radius_mi: 25 });
const roofSig = (id: number, over: Partial<MatchSignal> = {}): MatchSignal => ({
  id, categories: ['roofing'], lat: 41.88, lon: -87.63, state: 'IL', severity: 1, occurred_at: ago(HOUR), subtype: 'permit', source: 'socrata-chicago-permits',
  kind: 'civic', title: 'Roof permit in Chicago', summary: 'Reroof | $42,791 job value | 1 Main St', ...over,
});

describe('matchOne carries a score without the competition term', () => {
  it('trade, score (contact + value + fresh + trade fit) for an exact roofing permit', () => {
    const r = matchOne(roofSig(1, { hasContact: true }), profile('u1', ['roofing']), true, nowMs)!;
    expect(r.trade).toBe('roofing');
    expect(r.score).toBe(30 + 20 + 20 + 20);
  });
  it('a downstream trade gets no trade-fit points: a gutter company sees the same re-roof permit at 70, not 90', () => {
    const r = matchOne(roofSig(1, { hasContact: true }), profile('u1', ['siding-gutters']), true, nowMs)!;
    expect(r.label).toBe('coming_soon');
    expect(r.trade).toBe('siding-gutters');
    expect(r.score).toBe(30 + 20 + 20);
  });
});

describe('matchSignals: low competition is counted in the same pass', () => {
  it('orders by label, then score: the signal with the fewer competitors wins inside a label', () => {
    // Two re-roof permits at two places: one in Chicago with 1 gutter company, one in Aurora with 3. All coming_soon for gutters.
    const chicago = roofSig(1, { lat: 41.88, lon: -87.63 });
    const aurora = roofSig(2, { lat: 41.76, lon: -88.32, state: 'IL' });
    const pAurora = (id: string) => profile(id, ['siding-gutters'], 41.76, -88.32);
    const profiles = [profile('chi-1', ['siding-gutters'], 41.88, -87.63), pAurora('a-1'), pAurora('a-2'), pAurora('a-3')];
    const rows = matchSignals([aurora, chicago], profiles, 25, NOW, true);
    const forChi = rows.filter((r) => r.user_id === 'chi-1').map((r) => r.signal_id);
    expect(forChi[0]).toBe(1);
    // an Aurora member: its own record has 3 members of the trade (no +10), the Chicago record is outside its radius (> 25 mi)
    expect(rows.filter((r) => r.user_id === 'a-1').map((r) => r.signal_id)).toEqual([2]);
  });
  it('membersOfTrade counts members in area, the member included, only for trades the record carries', () => {
    const sig = roofSig(1);
    const ps = [profile('a', ['roofing']), profile('b', ['roofing']), profile('c', ['roofing'], 33.7, -84.4), profile('d', ['plumbing'])];
    expect(membersOfTrade(sig, 'roofing', ps, true)).toBe(2);
    expect(membersOfTrade(sig, 'plumbing', ps, true)).toBe(0);
    // a gutter company sees a re-roof permit through routing (the title), so it counts as one member of its own trade
    expect(membersOfTrade(sig, 'siding-gutters', [profile('e', ['siding-gutters'])], true)).toBe(1);
  });
});

describe('feed order puts the higher score first inside a label (selection against the real pickHits)', () => {
  it('a fresh high-value permit with a contact ranks above an old low-value one, both coming_soon', () => {
    const hi = roofSig(1, { hasContact: true, occurred_at: ago(2 * HOUR) });
    const lo = roofSig(2, { hasContact: false, occurred_at: ago(60 * HOUR), summary: 'Reroof | $3,000 job value | 2 Main St', severity: 3 });
    const rows = matchSignals([lo, hi], [profile('u', ['siding-gutters'])], 25, NOW, true);
    expect(rows.map((r) => r.signal_id)).toEqual([1, 2]);
  });
});

// ---- no extra round trip per signal -------------------------------------------------------------------------------------------------

describe('no extra database round trip per signal', () => {
  it('matchSignals and matchOne are pure functions: no db handle in their signatures, no await, no import of a client', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../lib/signals/match.ts'), 'utf8');
    expect(src).not.toMatch(/\bawait\b/);
    expect(src).not.toMatch(/from '@\/lib\/supabase|createClient|\.from\(['"]holler_/);
    const score = fs.readFileSync(path.join(__dirname, '../../lib/signals/score.ts'), 'utf8');
    expect(score).not.toMatch(/\bawait\b|\.from\(['"]holler_|Date\.now\(/);
  });

  /** A minimal chainable fake that counts every table read. */
  function fakeDb(tables: Record<string, unknown[]>) {
    const log: string[] = [];
    const db = {
      from(table: string) {
        log.push(table);
        let rows = tables[table] ?? [];
        const q: Record<string, unknown> = {};
        const self = () => q;
        for (const m of ['select', 'neq', 'in', 'gte', 'order', 'limit', 'eq']) q[m] = self;
        q.range = (from: number, to: number) => {
          rows = rows.slice(from, to + 1);
          return q;
        };
        q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok, bad);
        return q;
      },
    };
    return { db: db as never, log };
  }

  async function reportFor(nSignals: number) {
    const matches = Array.from({ length: nSignals }, (_, i) => ({
      id: i + 1,
      user_id: i % 2 ? 'u2' : 'u1',
      signal: {
        id: 1000 + i, source: 'socrata-chicago-permits', kind: 'civic', title: 'Roof permit in Chicago', summary: 'Reroof | $42,791 job value | 1 Main St',
        occurred_at: ago(HOUR), expires_at: null, categories: ['roofing'], lat: 41.88, lon: -87.63, state: 'IL', severity: 1, subtype: 'permit',
      },
    }));
    const profiles = [
      { user_id: 'u1', categories: ['roofing'], lat: 41.88, lon: -87.63, state: 'IL', radius_mi: 25, plan: 'starter', subscription_status: 'trialing', trial_ends_at: '2026-12-01T00:00:00Z' },
      { user_id: 'u2', categories: ['siding-gutters'], lat: 41.88, lon: -87.63, state: 'IL', radius_mi: 25, plan: 'starter', subscription_status: 'trialing', trial_ends_at: '2026-12-01T00:00:00Z' },
    ];
    const contacts = [{ signal_id: 1000 }];
    const f = fakeDb({ holler_matches: matches, holler_profiles: profiles, holler_signal_contacts: contacts });
    const report = await buildScoreReport(f.db, NOW, { days: 14, limit: 500 });
    return { report, log: f.log };
  }

  it('the admin report makes the same reads for 4 signals and for 400 (matches, profiles, contacts in chunks of 200)', async () => {
    const small = await reportFor(4);
    const big = await reportFor(400);
    expect(small.report.rows).toHaveLength(4);
    expect(big.report.rows).toHaveLength(400);
    const count = (log: string[], t: string) => log.filter((x) => x === t).length;
    expect(count(small.log, 'holler_matches')).toBe(1);
    expect(count(big.log, 'holler_matches')).toBe(1);
    expect(count(small.log, 'holler_profiles')).toBe(count(big.log, 'holler_profiles'));
    expect(count(small.log, 'holler_signal_contacts')).toBe(1);
    expect(count(big.log, 'holler_signal_contacts')).toBe(2); // 400 distinct ids / 200 per read: grows with ids / 200, never with ids
    expect(big.log.length).toBeLessThanOrEqual(small.log.length + 1);
  });

  it('the report carries the parts, the competition count and no user id, e-mail or contact', async () => {
    const { report } = await reportFor(2);
    const roofer = report.rows.find((r) => r.trade === 'roofing')!;
    expect(roofer.parts).toEqual({ contact: 30, value: 20, fresh: 20, tradeFit: 20, lowCompetition: 10 });
    expect(roofer.score).toBe(100);
    expect(roofer.competitors).toBe(1);
    const gutters = report.rows.find((r) => r.trade === 'siding-gutters')!;
    expect(gutters.label).toBe('coming_soon');
    expect(gutters.parts.tradeFit).toBe(0);
    expect(JSON.stringify(report)).not.toMatch(/u1|u2|user_id|@/);
    expect(report.rows[0].label).toBe('coming_soon');
  });
});

describe('documentation', () => {
  it('the weights, the N = 3 threshold and the admin-only rule are documented in score.ts', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../lib/signals/score.ts'), 'utf8');
    for (const s of ['+30', '+20', '+10', '48 hours', '$10,000', 'fewer than 3', 'admin']) expect(src).toContain(s);
  });
  it('the score never reaches a member surface: no score field in the feed item, digest item or mobile card types', () => {
    for (const f of ['components/Feed.tsx', 'lib/mobile/feed.ts']) {
      const p = path.join(__dirname, '../..', f);
      if (!fs.existsSync(p)) continue;
      expect(fs.readFileSync(p, 'utf8'), f).not.toMatch(/\bscore\b\s*[:?]/);
    }
  });
});
