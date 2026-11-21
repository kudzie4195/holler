// Round 13 unit A (PLAN-2.0 item 0.3): Act Now sorts first in the feed and the digest, and an Act Now card shows its deadline or
// "No deadline published". Context is never alerted (match, push, digest, feed, mobile).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('server-only', () => ({}));
vi.mock('@/app/app/actions', () => ({ setMatchStatus: async () => ({ ok: true }), getRequestReplyStates: async () => ({}) }));
vi.mock('@/components/feed/feedback-buttons', () => ({ FeedbackButtons: () => null }));

import {
  NO_DEADLINE_TEXT,
  deadlineLine,
  deadlineOf,
  formatDeadlineDate,
  orderByLabel,
  type OpportunityLabel,
} from '@/lib/signals/lead-rules';
import { matchOne, matchSignals, pickHits, type Hit, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { renderDigest, type DigestItem } from '@/lib/email/templates';
import { pushEntriesFromMatches } from '@/lib/push/notify';
import { buildAlerts, type MatchRow, type SignalRow } from '@/lib/mobile/feed';
import { Feed, type FeedItem } from '@/components/feed';
import { OpportunityChip } from '@/components/feed/opportunity-chip';
import { IntentNote } from '@/components/feed/intent-note';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const T = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

// ---- the ordering function -------------------------------------------------------------------------------------------------------
describe('orderByLabel (acceptance 3)', () => {
  const items = [
    { n: 'ctx', l: 'context' },
    { n: 'mi', l: 'market_insight' },
    { n: 'cs1', l: 'coming_soon' },
    { n: 'an1', l: 'act_now' },
    { n: 'cs2', l: 'coming_soon' },
    { n: 'an2', l: 'act_now' },
  ] as { n: string; l: OpportunityLabel }[];

  it('puts act_now first, then coming_soon, market_insight, context', () => {
    expect(orderByLabel(items, (i) => i.l).map((i) => i.n)).toEqual(['an1', 'an2', 'cs1', 'cs2', 'mi', 'ctx']);
  });
  it('is stable inside a label and does not mutate its input', () => {
    const before = items.map((i) => i.n).join();
    const out = orderByLabel(items, (i) => i.l);
    expect(items.map((i) => i.n).join()).toBe(before);
    expect(out.filter((i) => i.l === 'coming_soon').map((i) => i.n)).toEqual(['cs1', 'cs2']);
  });
  it('handles empty and single lists', () => {
    expect(orderByLabel([], () => 'act_now')).toEqual([]);
    expect(orderByLabel([1], () => 'context')).toEqual([1]);
  });
});

const sig = (id: number, over: Partial<MatchSignal> = {}): MatchSignal => ({
  id,
  categories: ['plumbing'],
  lat: 40.7,
  lon: -74,
  state: 'NY',
  severity: 1,
  occurred_at: T(1),
  source: 'nws',
  kind: 'alert',
  title: 'Flood Advisory',
  ...over,
});
const profile = (over: Partial<MatchProfile> = {}): MatchProfile => ({ user_id: 'u1', categories: ['plumbing'], lat: 40.7, lon: -74, state: 'NY', radius_mi: 25, ...over });

describe('pickHits and matchSignals: Act Now first in the feed order', () => {
  it('an act_now hit of low severity and age sorts before a newer, more severe coming_soon hit', () => {
    const hits: Hit[] = [
      { s: sig(1, { severity: 3, occurred_at: T(1) }), distance_mi: 1, label: 'coming_soon' },
      { s: sig(2, { severity: 1, occurred_at: T(70) }), distance_mi: 1, label: 'act_now' },
      { s: sig(3, { severity: 2, occurred_at: T(2) }), distance_mi: 1, label: 'coming_soon' },
    ];
    expect(pickHits(hits, NOW).map((h) => h.s.id)).toEqual([2, 1, 3]);
  });

  it('act_now rows are the last to be cut when a member has more rows than the cap', () => {
    const hits: Hit[] = [
      ...Array.from({ length: 5 }, (_, i): Hit => ({ s: sig(10 + i, { severity: 3 }), distance_mi: 1, label: 'coming_soon' })),
      { s: sig(99, { severity: 1, occurred_at: T(90) }), distance_mi: 1, label: 'act_now' },
    ];
    const kept = pickHits(hits, NOW, 3).map((h) => h.s.id);
    expect(kept[0]).toBe(99);
    expect(kept).toHaveLength(3);
  });

  it('a hit with no label counts as coming_soon (older callers)', () => {
    const hits: Hit[] = [{ s: sig(1, { severity: 3 }), distance_mi: 1 }, { s: sig(2), distance_mi: 1, label: 'act_now' }];
    expect(pickHits(hits, NOW).map((h) => h.s.id)).toEqual([2, 1]);
  });

  it('matchSignals returns Act Now first and leaves out context and market_insight', () => {
    const signals: MatchSignal[] = [
      sig(1, { severity: 3 }), // NWS flood advisory: coming_soon
      sig(2, { source: 'socrata-nyc-311', kind: 'civic', data: { subtype: '311' }, title: '311 request in X: HEAT/HOT WATER / ENTIRE BUILDING', severity: 1 }), // act_now
      sig(3, { source: 'socrata-nyc-311', kind: 'civic', data: { subtype: '311' }, title: '311 request in X: Sewer Maintenance / Catch Basin Clogged' }), // context
      sig(4, { source: 'socrata-chicago-permits', kind: 'permit', data: { subtype: 'permit' }, title: 'Plumbing permit in X' }), // own trade: market_insight
    ];
    const out = matchSignals(signals, [profile()], 25, new Date(NOW));
    expect(out.map((m) => m.signal_id)).toEqual([2, 1]);
  });

  it('matchOne reports the label and the deadline, and returns null for context', () => {
    const heat = matchOne(sig(2, { source: 'socrata-nyc-311', kind: 'civic', data: { subtype: '311' }, title: '311 request in X: HEAT/HOT WATER / APARTMENT ONLY' }), profile());
    expect(heat?.label).toBe('act_now');
    expect(heat?.deadline).toBeNull();
    const ctx = matchOne(sig(3, { source: 'socrata-chicago-311', kind: 'civic', data: { subtype: '311' }, title: '311 request in X: Tree Trim Request' }), profile({ categories: ['tree-service'] }));
    expect(ctx).toBeNull();
  });
});

// ---- the digest ------------------------------------------------------------------------------------------------------------------
describe('renderDigest: Act Now first, with its deadline line', () => {
  const items: DigestItem[] = [
    { kind: 'alert', source: 'nws', title: 'Flood Advisory', occurredAt: T(1), label: 'coming_soon' },
    { kind: 'civic', source: 'socrata-nyc-311', subtype: '311', title: 'No heat in a building', occurredAt: T(5), label: 'act_now', deadline: null },
    { kind: 'contract', source: 'sam-gov', title: 'Janitorial services bid', occurredAt: T(9), label: 'act_now', deadline: '2026-12-05T17:00:00Z' },
  ];
  const out = renderDigest({ businessName: 'Acme Plumbing', items, appUrl: 'https://holler.example/app', unsubscribeUrl: 'https://holler.example/u', now: new Date(NOW) });

  it('lists the act_now items before the coming_soon item, in html and text', () => {
    const at = (s: string, t: string) => s.indexOf(t);
    for (const body of [out.html, out.text]) {
      expect(at(body, 'No heat in a building')).toBeGreaterThan(-1);
      expect(at(body, 'No heat in a building')).toBeLessThan(at(body, 'Flood Advisory'));
      expect(at(body, 'Janitorial services bid')).toBeLessThan(at(body, 'Flood Advisory'));
    }
  });
  it('keeps the caller order inside a label', () => {
    expect(out.text.indexOf('No heat in a building')).toBeLessThan(out.text.indexOf('Janitorial services bid'));
  });
  it('shows the published deadline or "No deadline published" on Act Now, and nothing on Coming soon', () => {
    expect(out.text).toContain('Act now. Deadline: Dec 5, 2026');
    expect(out.text).toContain('Act now. No deadline published');
    expect(out.text).toContain('Coming soon');
    const coming = out.text.split('\n\n').find((b) => b.includes('Flood Advisory'))!;
    expect(coming).not.toContain('Deadline');
    expect(coming).not.toContain(NO_DEADLINE_TEXT);
    expect(out.html).toContain('No deadline published');
  });
  it('an item with no label (older caller) shows no chip', () => {
    const o = renderDigest({ businessName: 'A', items: [{ kind: 'alert', title: 'X', occurredAt: T(1) }], appUrl: 'https://x.example', unsubscribeUrl: 'https://x.example/u', now: new Date(NOW) });
    expect(o.text).not.toMatch(/Act now|Coming soon|Market insight/);
  });
  it('the cron orders by label, filters non-alert matches and marks them notified without a mail', () => {
    const src = readFileSync('app/api/cron/notify/route.ts', 'utf8');
    expect(src).toMatch(/orderByLabel\(ranked, \(r\) => labelOf\(r\.s\)\)/);
    expect(src).toMatch(/const rows = live\.filter\(\(r\) => isAlertLabel\(labelOf\(r\.s\)\)\)/);
    expect(src).toMatch(/const silent = live\.filter\(\(r\) => !isAlertLabel\(labelOf\(r\.s\)\)\)/);
  });
});

// ---- push ------------------------------------------------------------------------------------------------------------------------
describe('pushEntriesFromMatches: only alert labels are pushed', () => {
  const m = (id: number, s: Record<string, unknown>) => ({ id, user_id: 'u1', created_at: T(0.5), signal: { id, city: 'X', occurred_at: T(1), ...s } as any });
  const matches = [
    m(1, { title: 'Catch basin clogged', source: 'socrata-nyc-311', kind: 'civic', subtype: '311', categories: ['plumbing'] }),
    m(2, { title: 'Plumbing permit in X', source: 'socrata-chicago-permits', kind: 'permit', subtype: 'permit', categories: ['plumbing'] }),
    m(3, { title: 'Sewer / sewage_back-up_discharge', source: 'socrata-sf-311', kind: 'civic', subtype: '311', categories: ['plumbing'] }),
  ];
  it('drops context and market_insight, keeps act_now, when the member trades are known', () => {
    const out = pushEntriesFromMatches(matches, NOW, new Map([['u1', ['plumbing']]]));
    expect(out.get('u1')?.matchIds).toEqual([3]);
  });
  it('without trades the older behaviour is kept', () => {
    expect(pushEntriesFromMatches(matches, NOW).get('u1')?.matchIds).toEqual([1, 2, 3]);
  });
});

// ---- mobile ----------------------------------------------------------------------------------------------------------------------
describe('buildAlerts (mobile): context is not shown, label and deadline are carried', () => {
  const row = (id: number, s: Partial<SignalRow>): MatchRow => ({
    id,
    status: 'new',
    distance_mi: 1,
    draft: null,
    created_at: T(1),
    signal: { id, source: 'nws', kind: 'alert', title: 'T', summary: null, url: null, city: 'X', state: 'NY', county: null, zip: null, occurred_at: T(2), expires_at: null, categories: ['plumbing'], ...s },
  });
  it('drops a stored context match and labels the rest', async () => {
    const rows = [
      row(1, { source: 'socrata-chicago-311', kind: 'civic', subtype: '311', title: '311 request in X: Tree Trim Request', categories: ['tree-service'] }),
      row(2, { source: 'socrata-nyc-311', kind: 'civic', subtype: '311', title: '311 request in X: HEAT/HOT WATER / ENTIRE BUILDING' }),
      row(3, { source: 'sam-gov', kind: 'contract', title: 'Bid', expires_at: '2026-12-05T17:00:00Z', categories: ['plumbing'] }),
    ];
    const out = await buildAlerts(rows, { userId: 'u1', locked: true, db: {} as any, admin: null, siteUrl: 'https://holler.example', now: NOW, trades: ['plumbing', 'tree-service'] });
    expect(out.map((a) => a.signalId)).toEqual([2, 3]);
    expect(out.map((a) => a.label)).toEqual(['act_now', 'act_now']);
    expect(out.map((a) => a.deadline)).toEqual([null, '2026-12-05T17:00:00.000Z']);
  });
});

// ---- deadline helpers ------------------------------------------------------------------------------------------------------------
describe('deadline: published date or "No deadline published"', () => {
  it('reads the data keys an adapter may write', () => {
    expect(deadlineOf({ source: 'x', data: { fixBy: '2026-12-01' } })).toBe('2026-12-01T00:00:00.000Z');
    expect(deadlineOf({ source: 'x', data: { dueDate: '2026-12-02T10:00:00Z' } })).toBe('2026-12-02T10:00:00.000Z');
    expect(deadlineOf({ source: 'x', data: { deadline: 'not a date' } })).toBeNull();
  });
  it('uses expires_at as the deadline for an open federal bid only', () => {
    expect(deadlineOf({ source: 'sam-gov', expires_at: '2026-12-05T17:00:00Z' })).toBe('2026-12-05T17:00:00.000Z');
    expect(deadlineOf({ source: 'nws', expires_at: '2026-12-05T17:00:00Z' })).toBeNull(); // an advisory end is not a deadline
    expect(deadlineOf({ source: 'socrata-chicago-violations', expires_at: null })).toBeNull();
  });
  it('formats in UTC with a fixed pattern, and says so when there is none', () => {
    expect(formatDeadlineDate('2026-12-05T23:59:00Z')).toBe('Dec 5, 2026');
    expect(formatDeadlineDate('garbage')).toBeNull();
    expect(deadlineLine('2026-12-05T17:00:00Z')).toBe('Deadline: Dec 5, 2026');
    expect(deadlineLine(null)).toBe('No deadline published');
    expect(deadlineLine(undefined)).toBe(NO_DEADLINE_TEXT);
    expect(deadlineLine('garbage')).toBe(NO_DEADLINE_TEXT);
  });
});

// ---- render ----------------------------------------------------------------------------------------------------------------------
describe('Act Now cards render the deadline or "No deadline published" (acceptance 4)', () => {
  const html = (label: OpportunityLabel | null, deadline?: string | null) => renderToStaticMarkup(createElement(OpportunityChip, { label, deadline }));

  it('Act Now with a deadline', () => {
    const h = html('act_now', '2026-12-05T17:00:00Z');
    expect(h).toContain('Act now');
    expect(h).toContain('Deadline: Dec 5, 2026');
    expect(h).not.toContain('No deadline published');
  });
  it('Act Now without one says "No deadline published"', () => {
    for (const d of [null, undefined, 'garbage']) {
      const h = html('act_now', d);
      expect(h).toContain('Act now');
      expect(h).toContain('No deadline published');
    }
  });
  it('Coming soon and Market insight show a chip and no deadline line', () => {
    expect(html('coming_soon', null)).toContain('Coming soon');
    expect(html('coming_soon', null)).not.toMatch(/deadline/i);
    expect(html('market_insight', null)).toContain('Market insight');
  });
  it('context and an unlabelled card render nothing', () => {
    expect(html('context')).toBe('');
    expect(html(null)).toBe('');
  });

  const item = (id: number, label: OpportunityLabel | undefined, deadline?: string | null): FeedItem => ({
    id, status: 'new', kind: 'civic', source: 'socrata-nyc-311', subtype: '311', title: `Card ${id}`, summary: null, url: null, distance: '1 mi', place: 'New York, NY',
    ago: '1h', occurredAt: T(1), draft: null, label, deadline,
  });
  it('the Feed shows the chip and deadline on an Act Now card', () => {
    const h = renderToStaticMarkup(createElement(Feed, { items: [item(1, 'act_now', null), item(2, 'act_now', '2026-12-05T17:00:00Z'), item(3, 'coming_soon')], cityPage: null }));
    expect((h.match(/data-testid="opportunity-chip"/g) ?? []).length).toBe(3);
    expect((h.match(/No deadline published/g) ?? []).length).toBe(1);
    expect(h).toContain('Deadline: Dec 5, 2026');
  });
  it('IntentNote carries the chip with the intent line', () => {
    const h = renderToStaticMarkup(createElement(IntentNote, { item: { kind: 'civic', source: 'socrata-nyc-311', subtype: '311', label: 'act_now', deadline: null } }));
    expect(h).toContain('Act now');
    expect(h).toContain('No deadline published');
  });
  it('the feed page orders by label and hides context', () => {
    const page = readFileSync('app/app/page.tsx', 'utf8');
    expect(page).toMatch(/orderByLabel\(ranked,/);
    expect(page).toMatch(/labelOf\(s\) !== 'context'/);
    expect(page).toMatch(/deadline: deadlineOf\(/);
  });
});

describe('wording', () => {
  it('rendered chips and the digest never say lead, guaranteed, or official record', () => {
    const chips = (['act_now', 'coming_soon', 'market_insight'] as const).map((l) => renderToStaticMarkup(createElement(OpportunityChip, { label: l, deadline: null }))).join(' ');
    const digest = renderDigest({ businessName: 'A', items: [{ kind: 'alert', title: 'X', occurredAt: T(1), label: 'act_now' }], appUrl: 'https://x.example', unsubscribeUrl: 'https://x.example/u', now: new Date(NOW) });
    for (const t of [chips, digest.text, digest.html]) expect(t).not.toMatch(/\blead(s)?\b|guaranteed|official record|you will win|they need you/i);
  });
});
