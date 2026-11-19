// Round 7 integration: the AI note on the feed card (AI patch) next to the outcome prompt (MOAT). Server render only.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/app/actions', () => ({ setMatchStatus: async () => ({ ok: true }), getRequestReplyStates: async () => ({}) }));

import { Feed, LockedFeed, type FeedItem } from '@/components/feed';

const base: FeedItem = {
  id: 1,
  status: 'new',
  kind: 'report',
  source: 'spc',
  title: 'Hail report near Marietta',
  summary: null,
  url: null,
  distance: '4 mi away',
  place: 'Marietta, GA',
  ago: '1 hr ago',
  occurredAt: '2026-11-19T11:00:00.000Z',
  draft: null,
  city: 'Marietta',
  state: 'GA',
  county: 'Cobb County',
  zip: null,
  signalId: 7,
  feedback: null,
};
const NOTE = 'A roof inspection may follow this hail report.';
const render = (items: FeedItem[]) => renderToStaticMarkup(createElement(Feed, { items, cityPage: null }));

describe('feed card: AI note', () => {
  it('shows "Why it may matter" with the note, wrapping on narrow screens, between the intent line and the title', () => {
    const html = render([{ ...base, aiNote: NOTE }]);
    expect(html).toContain(`<span class="font-semibold">Why it may matter: </span>${NOTE}`);
    expect(html).toMatch(/<p class="mt-1 break-words text-sm text-ink">/);
    expect(html.indexOf('Why it may matter')).toBeLessThan(html.indexOf('Hail report near Marietta'));
    expect(html).not.toMatch(/whitespace-nowrap[^"]*"[^>]*>[^<]*Why it may matter/);
  });
  it('renders nothing for a missing or empty note', () => {
    for (const aiNote of [undefined, null, '']) expect(render([{ ...base, aiNote }])).not.toContain('Why it may matter');
  });
  it('a locked feed never shows a note even if one is passed', () => {
    const html = renderToStaticMarkup(createElement(LockedFeed, { items: [{ ...base, aiNote: NOTE }] } as never, null));
    expect(html).not.toContain(NOTE);
  });
});
