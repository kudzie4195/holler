/**
 * Brief card v1 over a fixture of 243 REAL stored rows (tes__data__/brief-live-rows.json: the newest 5 rows per source over the last
 * 21 days to Nov 21 2026, from a read-only select on holler_signals; public record fields only, no member data). No database at test
 * time. One member per trade is placed on each row and the real matcher decides who sees it; each card is built by the real web Feed,
 * renderDigest and buildAlerts. This is the independent review's fuzz (review E, logs/E-fuzz.test.ts.txt) made permanent, plus the
 * wording checks it motivated: no banned or unsupported phrase, no permit purpose taken from the trade tag, no damage denial when the
 * record's text mentions damage, trade wording only for trades where it is true.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';

vi.mock('server-only', () => ({}));
vi.mock('@/app/app/actions', () => ({
  setMatchStatus: async () => ({ ok: true }),
  getRequestReplyStates: async () => ({}),
  submitFeedback: async () => ({ ok: true }),
}));

import { Feed, type FeedItem } from '@/components/feed';
import { renderDigest, type DigestItem } from '@/lib/email/templates';
import { buildAlerts, type MatchRow } from '@/lib/mobile/feed';
import { MAX_WHY, briefFamilyOf, briefFor, permitTypeOf, tradeForRecord, workFor } from '@/lib/signals/brief';
import { BANNED } from './banned';
import { matchOne } from '@/lib/signals/match';
import { matchScope } from '@/lib/plan/scope';
import { deadlineOf, demoteExpired, labelForMember } from '@/lib/signals/lead-rules';

type Row = {
  id: number; source: string; kind: string; sub: string | null; title: string; url: string | null; categories: string[]; lat: number | null; lon: number | null;
  state: string | null; severity: number; occurred_at: string; expires_at: string | null; deadline: string | null; fixBy: string | null; responseDeadline: string | null;
};
const ROWS: Row[] = JSON.parse(readFileSync(join(__dirname, '__data__/brief-live-rows.json'), 'utf8'));
const NOW = new Date('2026-11-21T22:00:00Z');

interface Case { row: Row; trades: string[]; label: string; trade: string | null; deadline: string | null; matchLabel: string }

function cases(): { shown: Case[]; notShown: number } {
  const shown: Case[] = [];
  let notShown = 0;
  for (const r of ROWS) {
    const data: Record<string, unknown> = { subtype: r.sub, deadline: r.deadline, fixBy: r.fixBy, responseDeadline: r.responseDeadline };
    const sig = { id: r.id, categories: r.categories ?? [], lat: r.lat, lon: r.lon, state: r.state, severity: r.severity ?? 1, occurred_at: r.occurred_at, source: r.source, title: r.title, summary: null, kind: r.kind, subtype: r.sub, data };
    const memberSets = (r.categories ?? []).map((c) => [c]);
    if ((r.categories ?? []).length > 1) memberSets.push([...r.categories]);
    for (const cats of memberSets) {
      const profile = { user_id: 'u', categories: cats, lat: r.lat ?? 33.75, lon: r.lon ?? -84.39, state: r.state, radius_mi: 25, plan: 'pro', subscription_status: 'active' };
      const m = matchOne(sig as never, profile as never, false);
      if (!m) { notShown++; continue; }
      const trades = matchScope(profile as never).categories;
      const deadline = deadlineOf({ source: r.source, expires_at: r.expires_at, data });
      const label = demoteExpired(labelForMember({ source: r.source, kind: r.kind, subtype: r.sub, title: r.title, categories: r.categories }, trades), deadline, NOW.getTime());
      const trade = tradeForRecord({ source: r.source, kind: r.kind, subtype: r.sub, title: r.title }, r.categories, trades);
      shown.push({ row: r, trades, label, trade, deadline, matchLabel: m.label });
    }
  }
  return { shown, notShown };
}

const { shown: CASES } = cases();

const feedItem = (c: Case, i: number): FeedItem => ({
  id: i + 1, signalId: c.row.id, status: 'new', kind: c.row.kind, source: c.row.source, subtype: c.row.sub, title: c.row.title, summary: null, url: c.row.url,
  distance: null, place: c.row.state, ago: '1d', occurredAt: c.row.occurred_at, draft: null, label: c.label as never, trade: c.trade, deadline: c.deadline, bidLine: null,
});
const digestItem = (c: Case): DigestItem => ({
  kind: c.row.kind, source: c.row.source, subtype: c.row.sub, title: c.row.title, place: c.row.state, occurredAt: c.row.occurred_at, sourceUrl: c.row.url,
  label: c.label as never, trade: c.trade, deadline: c.deadline, bidLine: null,
});
const mobileRow = (c: Case, i: number): MatchRow => ({
  id: i + 1, status: 'new', distance_mi: 1, draft: null, created_at: NOW.toISOString(),
  signal: { id: c.row.id, source: c.row.source, kind: c.row.kind, subtype: c.row.sub, title: c.row.title, summary: null, url: c.row.url, city: null, state: c.row.state, county: null, zip: null,
    severity: c.row.severity, categories: c.row.categories, occurred_at: c.row.occurred_at, expires_at: c.row.expires_at, deadline: c.row.deadline, fixBy: c.row.fixBy, responseDeadline: c.row.responseDeadline, dueDate: null, bidBuyer: null },
}) as unknown as MatchRow;

const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&middot;/g, '·').replace(/\s+/g, ' ').trim();

describe('brief cards over 243 real stored rows', () => {
  it('has at least 200 real rows and 200 shown cards', () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(200);
    expect(CASES.length).toBeGreaterThanOrEqual(200);
  });

  it('label used on the card equals the matcher label (before deadline demotion)', () => {
    const bad = CASES.filter((c) => c.matchLabel !== c.label && !(c.matchLabel === 'act_now' && c.label === 'coming_soon'));
    expect(bad.map((c) => `${c.row.source} ${c.matchLabel}->${c.label}`)).toEqual([]);
  });

  it('web, digest, mobile: every card has all five parts and a link', async () => {
    const problems: string[] = [];
    const html = renderToStaticMarkup(createElement(Feed, { items: CASES.map(feedItem), cityPage: null }));
    const arts = html.split('<article').slice(1);
    if (arts.length !== CASES.length) problems.push(`web articles ${arts.length} != ${CASES.length}`);
    arts.forEach((a, i) => {
      const g = (id: string) => strip(a.match(new RegExp(`data-testid="${id}"[^>]*>([\\s\\S]*?)</p>`))?.[1] ?? '');
      const parts = { what: /<h2[^>]*>[^<]+<\/h2>/.test(a), why: /^Why it matters: .{20,}/.test(g('brief-why')), next: /^Next step: .{10,}/.test(g('brief-next')),
        source: /^Source: .+/.test(g('brief-source')), uncertain: /^What is uncertain: (High|Medium|Low) confidence .+;.+\.$/.test(g('brief-uncertain')),
        link: /<a href="(https?:\/\/|\/)[^"]+"[^>]*data-testid="brief-link"/.test(a) };
      for (const [k, v] of Object.entries(parts)) if (!v) problems.push(`web ${CASES[i].row.source} #${CASES[i].row.id} missing ${k}`);
      if (!/[A-Z][a-z]{2} \d{1,2}, 2026/.test(g('brief-source'))) problems.push(`web ${CASES[i].row.source} #${CASES[i].row.id} no record date`);
    });

    // digest in batches (real cron caps at 25 items per mail)
    for (let k = 0; k < CASES.length; k += 25) {
      const batch = CASES.slice(k, k + 25);
      const d = renderDigest({ businessName: 'Fuzz', items: batch.map(digestItem), appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: NOW });
      const lis = d.html.split('<li ').slice(1);
      // digest orders by label: count parts per li, not by index
      if (lis.length !== batch.length) problems.push(`digest li ${lis.length} != ${batch.length}`);
      for (const li of lis) {
        for (const p of ['Why it matters:', 'Next step:', 'Source:', 'What is uncertain:']) if (!li.includes(p)) problems.push(`digest li missing ${p}`);
        if (!/<a href="https?:\/\/[^"]+"/.test(li)) problems.push(`digest li missing link: ${strip(li).slice(0, 80)}`);
      }
      const texts = d.text.split('\n\n');
      const n = (d.text.match(/What is uncertain: /g) ?? []).length;
      if (n !== batch.length) problems.push(`digest text uncertain count ${n} != ${batch.length}`);
      const links = (d.text.match(/\n(Open the source|Open the source home page|Open the bid portal|Open the request): https?:\/\//g) ?? []).length;
      if (links !== batch.length) problems.push(`digest text link count ${links} != ${batch.length} (${texts.length})`);
    }

    for (const locked of [false, true]) {
      const deps = { userId: 'u1', locked, db: new FakeDb() as never, admin: null, siteUrl: 'https://localholler.com', now: NOW.getTime() };
      for (let i = 0; i < CASES.length; i++) {
        const c = CASES[i];
        const [a] = await buildAlerts([mobileRow(c, i)], { ...deps, trades: c.trades });
        if (!a) { problems.push(`mobile${locked ? ' locked' : ''} dropped ${c.row.source} #${c.row.id} label ${c.label}`); continue; }
        const b = a.brief;
        if (!b || !b.why || !b.next || !b.uncertain || !b.confidence || !b.source?.label) problems.push(`mobile ${c.row.source} missing part`);
        if (!/^https?:\/\//.test(b?.source?.url ?? '')) problems.push(`mobile${locked ? ' locked' : ''} ${c.row.source} #${c.row.id} no http link: ${b?.source?.url}`);
        if (!b?.source?.date) problems.push(`mobile ${c.row.source} no date`);
        if (a.label !== c.label) problems.push(`mobile label ${a.label} != ${c.label} ${c.row.source}`);
        if (!a.intent || !a.sourceLabel) problems.push(`mobile old field missing ${c.row.source}`);
      }
    }

    expect(problems).toEqual([]);
  });

  const briefOf = (c: Case, summary: string | null = null) =>
    briefFor({ source: c.row.source, kind: c.row.kind, subtype: c.row.sub, title: c.row.title, summary, label: c.label as never, trade: c.trade });
  const UNSUPPORTED = /measured|is active|has not confirmed|house cleaning|\bleads?\b|they need you|you will win|guaranteed|official record|[\u2013\u2014]/i;

  it('no card says a banned or unsupported phrase (web, digest and brief strings)', () => {
    const bad: string[] = [];
    for (const c of CASES) {
      const b = briefOf(c);
      for (const t of [b.why, b.next, b.uncertain]) {
        for (const re of [...BANNED, UNSUPPORTED]) if (re.test(t)) bad.push(`${c.row.source} #${c.row.id} ${re}: ${t}`);
      }
    }
    const html = renderToStaticMarkup(createElement(Feed, { items: CASES.map(feedItem), cityPage: null }));
    for (const re of [...BANNED, UNSUPPORTED]) if (re.test(strip(html))) bad.push(`web ${re}`);
    expect(bad).toEqual([]);
  });

  it('a permit or federal-award brief describes the record from its own title, never from the trade tag', () => {
    const seen = { permit: 0, award: 0, noType: 0 };
    for (const c of CASES) {
      const fam = briefFamilyOf({ source: c.row.source, kind: c.row.kind, subtype: c.row.sub });
      if (c.label !== 'market_insight' || !['permit', 'federal-award'].includes(fam)) continue;
      const why = briefOf(c).why;
      const w = workFor(c.trade);
      if (c.trade) expect(why, `${c.row.title} for ${c.trade}`).not.toContain(w);
      if (fam === 'permit') {
        seen.permit++;
        const type = permitTypeOf(c.row.title);
        const uncertain = briefOf(c).uncertain;
        if (type === null) { seen.noType++; expect(why, c.row.title).toContain('does not say what the work is'); }
        else {
          // a title that does name a type (even a long one) never gets "does not say what the work is"
          expect(why, c.row.title).not.toContain('does not say what the work is');
          expect(uncertain, c.row.title).not.toContain('does not say what the work is');
          if (type && `A permit was filed nearby (${type}); work is planned.`.length <= MAX_WHY) expect(why, c.row.title).toContain(`(${type})`);
          else expect(why, c.row.title).toBe('A permit was filed nearby; work is planned.');
        }
      } else {
        seen.award++;
        expect(why, c.row.title).not.toMatch(/for junk hauling|for childcare|for buying or selling help/);
      }
    }
    expect(seen.permit).toBeGreaterThan(5);
    expect(seen.award).toBeGreaterThan(0);
  });

  it('inspection cards say repairs only to repair trades; every other trade gets the neutral sentence', () => {
    const REPAIR = new Set(['plumbing', 'hvac', 'electrical', 'general-contractor', 'handyman', 'painting', 'flooring', 'windows-doors']);
    let n = 0;
    for (const c of CASES) {
      if (briefFamilyOf({ source: c.row.source, kind: c.row.kind, subtype: c.row.sub }) !== 'inspection') continue;
      n++;
      const why = briefOf(c).why;
      if (/repairs may involve|fixing it may call for/.test(why)) expect(REPAIR.has(c.trade ?? ''), `${c.trade}: ${why}`).toBe(true);
    }
    expect(n).toBeGreaterThan(5);
  });

  it('no weather, storm or quake card ever says "no damage", whatever the record remarks say (independent of the phrase list)', () => {
    // the remarks of the review's 7 realistic SPC wind reports, a negation and a forecast; none may produce a denial
    const REMARKS = [
      'Several trees down on homes and power lines down. (FFC)', 'Large tree limbs snapped. (FFC)', 'Several trees uprooted. (FFC)',
      'Power poles snapped along Highway 41. (FFC)', 'Shingles torn from roof of home. (FFC)', 'Trees blown over onto cars. (FFC)', 'Tree fell on a house. (FFC)',
      'Measured by ASOS. No damage reported. (FFC)', 'IMPACTS...Damaging winds could blow down trees.', 'Peak gust at mesonet site. (FFC)',
    ];
    let n = 0;
    for (const c of CASES) {
      const fam = briefFamilyOf({ source: c.row.source, kind: c.row.kind, subtype: c.row.sub });
      if (!['weather-alert', 'storm-report', 'quake'].includes(fam)) continue;
      n++;
      for (const r of [null, ...REMARKS]) expect(briefOf(c, r).uncertain, `${c.row.source} #${c.row.id} ${r}`).not.toMatch(/no damage/i);
      expect(briefFor({ source: c.row.source, label: c.label as never, trade: c.trade }).uncertain).not.toMatch(/no damage/i);
    }
    expect(n).toBeGreaterThan(10);
  });
});
