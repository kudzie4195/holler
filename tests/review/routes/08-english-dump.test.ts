/* eslint-disable @typescript-eslint/no-explicit-any */
// Round 18 ROUTES review probe (logs/REV-ROUTES-probe-tests), kept as a permanent regression test (redo 1). With REV_OUT set it also
// writes its table to that path; without it it writes nothing.
/**
 * REV-ROUTES probe 08 (run on BOTH commits; outputs diffed): English output of a sample of cards and digests.
 *  - 243 real stored rows (brief-live-rows.json) and 156 real stored permit/civic rows with summaries (review-f-sample-156.json), one member
 *    per trade tag, matched by the real matcher; each shown card rendered by the real web Feed, renderDigest (subject, html, text) and
 *    the mobile buildAlerts DTO; the push notification text; the label chip alone; the quality page without the new argument.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { FakeDb } from '../../ops/fakedb';

vi.mock('server-only', () => ({}));
vi.mock('@/app/app/actions', () => ({ setMatchStatus: async () => ({ ok: true }), getRequestReplyStates: async () => ({}), submitFeedback: async () => ({ ok: true }) }));

import { Feed, type FeedItem } from '@/components/feed';
import { OpportunityChip } from '@/components/feed/opportunity-chip';
import { renderDigest, digestSubject, type DigestItem } from '@/lib/email/templates';
import { buildAlerts, type MatchRow } from '@/lib/mobile/feed';
import { buildNotification } from '@/lib/push/notify';
import { tradeForRecord } from '@/lib/signals/brief';
import { matchOne, matchSignals } from '@/lib/signals/match';
import { matchScope } from '@/lib/plan/scope';
import { deadlineOf, demoteExpired, labelForMember } from '@/lib/signals/lead-rules';
import { jobValueOf } from '@/lib/signals/permit-value';
import { en } from '@/lib/i18n/en';

const NOW = new Date('2026-11-21T22:00:00Z');
type Row = { id: number; source: string; kind: string; sub: string | null; title: string; summary: string | null; url: string | null; categories: string[]; lat: number | null; lon: number | null; state: string | null; severity: number; occurred_at: string; expires_at: string | null; deadline: string | null; fixBy: string | null; responseDeadline: string | null };
const live: Row[] = (JSON.parse(readFileSync('tests/signals/__data__/brief-live-rows.json', 'utf8')) as any[]).map((r) => ({ ...r, summary: null }));
const SUB: Record<string, [string, string | null]> = { permits: ['permit', 'permit'], violations: ['civic', 'violation'], '311': ['civic', '311'], inspections: ['civic', 'inspection'], business: ['civic', 'business'] };
const sample: Row[] = (JSON.parse(readFileSync('tests/signals/__data__/review-f-sample-156.json', 'utf8')) as any[]).map((r) => {
  const tail = String(r[1]).split('-').pop() as string;
  const [kind, sub] = SUB[tail] ?? ['civic', null];
  return { id: r[0], source: r[1], kind, sub, title: r[2], summary: r[3], url: 'https://example.org/source', categories: r[5], lat: 33.75, lon: -84.39, state: 'GA', severity: 1, occurred_at: '2026-11-20T12:00:00+00:00', expires_at: null, deadline: null, fixBy: null, responseDeadline: null };
});

it('dumps English output', async () => {
  const out: Record<string, string> = {};
  let shown = 0;
  const matchRows: string[] = [];
  for (const [set, rows] of [['live', live], ['sample', sample]] as const) {
    for (const r of rows) {
      const data: Record<string, unknown> = { subtype: r.sub, deadline: r.deadline, fixBy: r.fixBy, responseDeadline: r.responseDeadline };
      const sig = { id: r.id, categories: r.categories ?? [], lat: r.lat, lon: r.lon, state: r.state, severity: r.severity ?? 1, occurred_at: r.occurred_at, source: r.source, title: r.title, summary: r.summary, kind: r.kind, subtype: r.sub, data };
      for (const cat of r.categories ?? []) {
        const profile = { user_id: 'u', categories: [cat], lat: r.lat ?? 33.75, lon: r.lon ?? -84.39, state: r.state, radius_mi: 25, plan: 'pro', subscription_status: 'active' };
        const m = matchOne(sig as never, profile as never, true, NOW.getTime());
        const key = `${set}|${r.id}|${r.source}|${cat}|${r.title}`;
        // the scan's own row for this pair (what is written to holler_matches)
        matchRows.push(`${key} => matchOne ${m ? `${m.label}${(m as any).hold ? ` hold=${(m as any).hold}` : ''}` : 'none'}; row ${JSON.stringify(matchSignals([sig as never], [profile as never], undefined, NOW, true))}`);
        if (!m) continue;
        shown++;
        const trades = matchScope(profile as never).categories;
        const deadline = deadlineOf({ source: r.source, expires_at: r.expires_at, data });
        const label = demoteExpired(labelForMember({ source: r.source, kind: r.kind, subtype: r.sub, title: r.title, summary: r.summary, categories: r.categories }, trades), deadline, NOW.getTime());
        const trade = tradeForRecord({ source: r.source, kind: r.kind, subtype: r.sub, title: r.title, summary: r.summary }, r.categories, trades);
        const item: FeedItem = { id: 1, signalId: r.id, status: 'new', kind: r.kind, source: r.source, subtype: r.sub, title: r.title, summary: r.summary, url: r.url, distance: null, place: r.state, ago: '1d', occurredAt: r.occurred_at, draft: null, label: label as never, trade, deadline, bidLine: null, jobValue: jobValueOf({ summary: r.summary }) } as FeedItem;
        out[`card|${key}`] = renderToStaticMarkup(createElement(Feed, { items: [item], canDraft: true } as never));
        const d: DigestItem = { kind: r.kind, source: r.source, subtype: r.sub, title: r.title, summary: r.summary, place: r.state, occurredAt: r.occurred_at, sourceUrl: r.url, label: label as never, trade, deadline, bidLine: null, jobValue: jobValueOf({ summary: r.summary }) } as DigestItem;
        const mail = renderDigest({ businessName: 'Acme Co', items: [d], totalCount: 1, appUrl: 'https://x.test/app', unsubscribeUrl: 'https://x.test/u', now: NOW } as never);
        out[`digest.subject|${key}`] = mail.subject;
        out[`digest.html|${key}`] = mail.html;
        out[`digest.text|${key}`] = mail.text;
        const mr = { id: 1, status: 'new', distance_mi: 1, draft: null, created_at: NOW.toISOString(), signal: { id: r.id, source: r.source, kind: r.kind, subtype: r.sub, title: r.title, summary: r.summary, url: r.url, city: null, state: r.state, county: null, zip: null, severity: r.severity, categories: r.categories, occurred_at: r.occurred_at, expires_at: r.expires_at, deadline: r.deadline, fixBy: r.fixBy, responseDeadline: r.responseDeadline, dueDate: null, bidBuyer: null } } as unknown as MatchRow;
        const db = new FakeDb({ holler_signal_contacts: [], holler_signal_feedback: [], holler_signal_ai: [] });
        try {
          const alerts = await buildAlerts([mr], { db: db as never, userId: 'u', trades, now: NOW.getTime(), canDraft: true, lang: 'en' } as never);
          out[`mobile|${key}`] = JSON.stringify(alerts);
        } catch (e) {
          out[`mobile|${key}`] = `ERR ${(e as Error).message}`;
        }
        out[`push|${key}`] = JSON.stringify(buildNotification({ count: 1, top: { signalId: r.id, title: r.title, city: 'Atlanta', source: r.source } } as never, 'Atlanta'));
      }
    }
  }
  // a multi-item digest and its subject
  const multi: DigestItem[] = sample.slice(0, 12).map((r) => ({ kind: r.kind, source: r.source, subtype: r.sub, title: r.title, summary: r.summary, place: 'Atlanta, GA', occurredAt: r.occurred_at, sourceUrl: r.url, label: 'coming_soon', trade: r.categories[0] ?? null, deadline: null, bidLine: null }) as DigestItem);
  const mm = renderDigest({ businessName: 'Acme Co', items: multi, totalCount: 30, appUrl: 'https://x.test/app', unsubscribeUrl: 'https://x.test/u', now: NOW } as never);
  out['digest.multi.subject'] = mm.subject; out['digest.multi.html'] = mm.html; out['digest.multi.text'] = mm.text;
  out['digest.subject.fn'] = [1, 2, 11].map((n) => digestSubject(multi.slice(0, Math.min(n, multi.length)) as never, n)).join(' / ');
  for (const l of ['act_now', 'coming_soon', 'market_insight', 'context'] as const) out[`chip|${l}`] = renderToStaticMarkup(createElement(OpportunityChip, { label: l, deadline: null }));
  out['push.many'] = JSON.stringify(buildNotification({ count: 3, top: { signalId: 1, title: 'Roof permit in Atlanta', city: 'Atlanta' } } as never, 'Atlanta'));
  // every English dictionary string present on this commit
  const dict: Record<string, string> = {};
  for (const [k, v] of Object.entries(en)) dict[k] = String(v);
  if (process.env.REV_OUT) writeFileSync(process.env.REV_OUT as string, JSON.stringify({ shown, out, dict, matchRows }, null, 0));
  expect(shown).toBeGreaterThan(300);
  // Redo 1: pinned. Round 18 ROUTES changed none of these 3,171 outputs against the base commit 8bee203 (reviewer's diff, and a re-run of
  // this probe on 3d01b54 and on the redo: 0 differ). A change here is a change of English output: check it, then update the snapshot.
  // Round 18 integration: snapshot regenerated once. 163 card renders changed only in React useId values (aria-labelledby "_R_4s_" ->
  // "_R_5c_"), because the lists unit added an optional listLink slot before WhoToContact in components/feed.tsx; with the ids normalised
  // all 3,171 outputs and the match rows are identical to r18-routes fe723dc.
  const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
  expect({ shown, outputs: Object.keys(out).length, out: sha(out), matchRows: sha(matchRows) }).toMatchSnapshot();
});
