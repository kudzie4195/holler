// Feed card for a resident request: "Reply" instead of the source link and the AI draft; other asks keep their actions.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/app/actions', () => ({ setMatchStatus: async () => ({ ok: true }), getRequestReplyStates: async () => ({}) }));

import { Feed, type FeedItem } from '@/components/feed';
import { RequestReply } from '@/components/request-reply';

const base: FeedItem = {
  id: 1,
  status: 'new',
  kind: 'ask',
  source: 'holler-request',
  title: 'Service request in Atlanta: Roofing',
  summary: 'Roof leak over the kitchen after the storm.',
  url: 'https://holler.test/request',
  distance: '3 mi away',
  place: 'Atlanta, GA',
  ago: '2 min ago',
  occurredAt: '2026-11-17T12:00:00.000Z',
  draft: null,
};

describe('feed: resident requests', () => {
  it('shows Reply, not "Open the source" or "Draft reply", and labels the source', () => {
    const html = renderToStaticMarkup(createElement(Feed, { items: [base], cityPage: null }));
    expect(html).toContain('>Reply<');
    expect(html).not.toContain('Open the source');
    expect(html).not.toContain('Draft reply');
    expect(html).toContain('Request made on Holler');
  });

  it('other people-asking items keep the source link and the draft button', () => {
    const html = renderToStaticMarkup(
      createElement(Feed, { items: [{ ...base, id: 2, source: 'websearch', url: 'https://example.com/post' }], cityPage: null }),
    );
    expect(html).toContain('Open the source');
    expect(html).toContain('Draft reply');
    expect(html).not.toContain('>Reply<');
  });

  it('a replied request shows "Replied"; a closed or full one says so', () => {
    const replied = renderToStaticMarkup(createElement(RequestReply, { matchId: 1, state: 'replied', onReplied: () => {} }));
    expect(replied).toContain('Replied');
    expect(replied).not.toContain('<button');
    expect(renderToStaticMarkup(createElement(RequestReply, { matchId: 1, state: 'closed', onReplied: () => {} }))).toContain('This request is closed.');
    expect(renderToStaticMarkup(createElement(RequestReply, { matchId: 1, state: 'full', onReplied: () => {} }))).toContain('enough replies');
  });
});
