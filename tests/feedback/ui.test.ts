import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/app/actions', () => ({
  setMatchStatus: async () => ({ ok: true }),
  getRequestReplyStates: async () => ({}),
  submitFeedback: async () => ({ ok: true }),
}));

import { Feed, LockedFeed, type FeedItem } from '@/components/feed';
import { loadFeedback } from '@/lib/feedback/service';
import { parseJobValue } from '@/lib/feedback/types';

const base: FeedItem = {
  id: 7,
  signalId: 70,
  status: 'new',
  kind: 'civic',
  subtype: 'business',
  source: 'socrata-sf-business',
  title: 'New business licence',
  summary: null,
  url: null,
  distance: '2 mi away',
  place: 'San Francisco, CA',
  ago: '1 hr ago',
  occurredAt: '2026-11-17T12:00:00.000Z',
  draft: null,
};
const render = (items: FeedItem[]) => renderToStaticMarkup(createElement(Feed, { items, cityPage: null }));

describe('feed card: intent and feedback', () => {
  it('shows the intent label, its line, and the three buttons', () => {
    const html = render([base]);
    expect(html).toContain('Spending activity');
    expect(html).toContain('A new business registered here. It may need services as it opens.');
    for (const label of ['Useful', 'Not relevant', 'Led to work']) expect(html).toContain(`>${label}</button>`);
    expect(html).not.toContain('About how much was the job?');
    expect(html).not.toContain('aria-pressed="true">Useful');
  });

  it('marks the saved answer as selected and only that one', () => {
    const html = render([{ ...base, feedback: { verdict: 'not_relevant', jobValueUsd: null } }]);
    const pressed = [...html.matchAll(/aria-pressed="true"[^>]*>([^<]+)</g)].map((m) => m[1]);
    // the filter tab "All" is also a pressed button; the feedback group has exactly one
    expect(pressed.filter((t) => ['Useful', 'Not relevant', 'Led to work'].includes(t))).toEqual(['Not relevant']);
  });

  it('opens the optional job value field for "Led to work", with the saved amount', () => {
    const html = render([{ ...base, feedback: { verdict: 'led_to_work', jobValueUsd: 2400 } }]);
    expect(html).toContain('About how much was the job? (optional)');
    expect(html).toContain('type="number"');
    expect(html).toContain('min="0"');
    expect(html).toContain('max="1000000"');
    expect(html).toContain('step="1"');
    expect(html).toContain('value="2400"');
  });

  it('is shown for every kind of alert, including resident requests', () => {
    const html = render([
      { ...base, id: 1, signalId: 1, kind: 'ask', source: 'holler-request', subtype: null },
      { ...base, id: 2, signalId: 2, kind: 'alert', source: 'nws', subtype: null },
    ]);
    expect(html.match(/Feedback on this alert/g)).toHaveLength(2);
    expect(html).toContain('A resident asked for this service.');
    expect(html).toContain('Demand sign');
  });

  it('hides the buttons when the item has no signal id, and never shows them on the locked feed', () => {
    expect(render([{ ...base, signalId: undefined }])).not.toContain('Feedback on this alert');
    const locked = renderToStaticMarkup(createElement(LockedFeed, { items: [base] } as never, null));
    expect(locked).not.toContain('Feedback on this alert');
  });
});

describe('parseJobValue', () => {
  it('accepts whole dollars and blank, rejects the rest', () => {
    expect(parseJobValue('')).toBeNull();
    expect(parseJobValue(' 0 ')).toBe(0);
    expect(parseJobValue('2,400')).toBe(2400);
    expect(parseJobValue('$1000000')).toBe(1_000_000);
    for (const bad of ['1000001', '-5', '12.5', 'abc', '1e3', '99999999']) expect(parseJobValue(bad), bad).toBeUndefined();
  });
});

describe('loadFeedback', () => {
  const dbWith = (result: unknown | Error) => ({
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) q[m] = () => q;
      q.in = async () => {
        if (result instanceof Error) throw result;
        return result;
      };
      return q;
    },
  });

  it('maps the member rows by signal id', async () => {
    const m = await loadFeedback(
      dbWith({ data: [{ signal_id: 1, verdict: 'led_to_work', job_value_usd: 900 }, { signal_id: 2, verdict: 'useful', job_value_usd: null }, { signal_id: 3, verdict: 'bogus' }] }) as never,
      'u1',
      [1, 2, 3],
    );
    expect(m.get(1)).toEqual({ verdict: 'led_to_work', jobValueUsd: 900 });
    expect(m.get(2)).toEqual({ verdict: 'useful', jobValueUsd: null });
    expect(m.has(3)).toBe(false);
  });

  it('treats an error, a missing table or a throw as no answers', async () => {
    expect((await loadFeedback(dbWith({ data: null, error: { code: '42P01' } }) as never, 'u1', [1])).size).toBe(0);
    expect((await loadFeedback(dbWith(new Error('boom')) as never, 'u1', [1])).size).toBe(0);
    expect((await loadFeedback(dbWith({ data: [] }) as never, 'u1', [])).size).toBe(0);
  });
});
