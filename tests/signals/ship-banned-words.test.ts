/**
 * Round 15 integration (unit I): the banned-words scan over every member-facing string the merged branches add or touch.
 * Rules (CONTEXT.md): never "lead", "they need you", "you will win", "guaranteed", "official record"; no free-month offer (the trial is 14 days).
 * Two reads: (1) every string literal and JSX text in the member-facing modules, (2) every string of the rendered surfaces (web feed, digest
 * html and text, mobile DTO) for the integration fixtures, plus every routed sentence and every brief sentence.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { stringLiterals } from './wording-no-lead.test';

vi.mock('@/app/app/actions', () => ({ setMatchStatus: async () => ({ ok: true }), getRequestReplyStates: async () => ({}), submitFeedback: async () => ({ ok: true }) }));
vi.mock('server-only', () => ({}));

import { Feed } from '@/components/feed';
import { renderDigest } from '@/lib/email/templates';
import { allBriefStrings } from '@/lib/signals/brief';
import { ROUTE_WHY } from '@/lib/signals/permit-routing';
import { managedByLine } from '@/lib/signals/managed-by';
import { NOW } from './brief-fixtures';
import { shipCases, shipDigestItem, shipFeedItem } from './ship-fixtures';

export const BANNED: [string, RegExp][] = [
  ['lead', /\bleads?\b/i],
  ['they need you', /they need you/i],
  ['you will win', /you(?:'ll| will) win/i],
  ['guaranteed', /guarantee[ds]?\b/i],
  ['official record', /official records?\b/i],
  ['free months', /\b(?:free months?|months? free|2[- ]months?|two[- ]months?)\b/i],
  ['proves damage', /\bproves?\b[^.]*\b(?:damage|hir)/i],
];

const ROOT = process.cwd();
const walk = (p: string): string[] => (statSync(join(ROOT, p)).isFile() ? [p] : readdirSync(join(ROOT, p)).flatMap((f) => walk(join(p, f))));
const isSlug = (t: string) => /^\/[a-z0-9/_-]*$/i.test(t) || /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(t);

const MODULES = [
  'lib/outreach', 'lib/signals/brief.ts', 'lib/signals/permit-routing.ts', 'lib/signals/permit-value.ts', 'lib/signals/managed-by.ts', 'lib/signals/approx-location.ts',
  'lib/check/coverage-notice.ts', 'lib/email/templates.ts', 'lib/mobile/feed.ts', 'lib/push', 'lib/moat/email.ts', 'lib/lifecycle/templates.ts',
  'components/feed.tsx', 'components/feed', 'components/coverage-notice.tsx', 'app/app',
];

describe('banned words: member-facing source strings', () => {
  const files = MODULES.flatMap(walk).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
  it('reads the new modules too', () => {
    for (const must of ['lib/signals/permit-routing.ts', 'lib/signals/managed-by.ts', 'lib/signals/permit-value.ts', 'lib/check/coverage-notice.ts']) expect(files).toContain(must);
  });
  for (const [name, re] of BANNED) {
    it(`no "${name}" in any string literal`, () => {
      const hits: string[] = [];
      for (const f of files) for (const t of stringLiterals(readFileSync(join(ROOT, f), 'utf8'))) if (!isSlug(t) && re.test(t)) hits.push(`${f}: ${t.slice(0, 90)}`);
      expect(hits).toEqual([]);
    });
  }
});

describe('banned words: rendered surfaces for the integration fixtures', () => {
  it('web feed, digest html and text, every routed sentence, every brief sentence, the manager line', async () => {
    const cases = await shipCases();
    const web = renderToStaticMarkup(createElement(Feed, { items: cases.map(shipFeedItem), cityPage: null }));
    const dig = renderDigest({ businessName: 'Fixture members', items: cases.map(shipDigestItem), appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: NOW });
    // text of the card chrome only: record titles and summaries are the city's words (a 311 or violation can say "lead paint"), so they are removed before the scan
    const own = (s: string) => {
      let out = s;
      for (const c of cases) for (const v of [c.signal.title, c.signal.summary ?? '']) if (v) out = out.split(v).join(' ').split(v.replace(/&/g, '&amp;')).join(' ');
      return out.replace(/<[^>]+>/g, ' ');
    };
    const surfaces: [string, string][] = [['web', own(web)], ['digest html', own(dig.html)], ['digest text', own(dig.text)], ['routed', Object.values(ROUTE_WHY).join('\n')], ['brief', allBriefStrings().join('\n')], ['managed', managedByLine({ name: 'ACME PROPERTY LLC', role: 'agent' })]];
    const hits: string[] = [];
    for (const [where, text] of surfaces) for (const [name, re] of BANNED) if (re.test(text)) hits.push(`${where}: ${name}: ${(text.match(re) ?? [''])[0]}`);
    expect(hits).toEqual([]);
  });
});
