/**
 * Writes the brief card pages that the screenshots are taken from, and the digest HTML snapshot. Skipped unless HOLLER_SHOTS_DIR is set:
 *   HOLLER_SHOTS_DIR=/tmp/shots npx vitest run tests/signals/brief-shots.test.ts
 * Writes <dir>/feed.html (the feed with the fixture cards, styled by the built stylesheet named in HOLLER_SHOTS_CSS, default
 * /_next/static/css/app.css) and <dir>/digest.html. The digest snapshot that IS checked on every run is
 * tests/signals/__snapshots__/digest-brief.html (toMatchFileSnapshot, written once on the first run).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/app/actions', () => ({
  setMatchStatus: async () => ({ ok: true }),
  getRequestReplyStates: async () => ({}),
  submitFeedback: async () => ({ ok: true }),
}));

import { Feed } from '@/components/feed';
import { renderDigest } from '@/lib/email/templates';
import { FIXTURES, NOW, digestItem, feedItem } from './brief-fixtures';

const digest = () =>
  renderDigest({ businessName: 'Acme Roofing', items: FIXTURES.map(digestItem), appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: NOW });

describe('digest HTML snapshot', () => {
  it('matches the checked-in snapshot (the brief in every item)', async () => {
    await expect(digest().html).toMatchFileSnapshot('./__snapshots__/digest-brief.html');
  });
});

describe.skipIf(!process.env.HOLLER_SHOTS_DIR)('write the pages for the screenshots', () => {
  it('feed.html and digest.html', () => {
    const dir = process.env.HOLLER_SHOTS_DIR!;
    mkdirSync(dir, { recursive: true });
    const css = process.env.HOLLER_SHOTS_CSS ?? '/_next/static/css/app.css';
    const feed = renderToStaticMarkup(createElement(Feed, { items: FIXTURES.map(feedItem), cityPage: null }));
    writeFileSync(
      join(dir, 'feed.html'),
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Feed with brief cards</title><link rel="stylesheet" href="${css}"></head><body class="bg-background text-ink antialiased"><main class="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 sm:px-6"><div class="max-w-3xl"><h1 class="text-5xl text-ink">Your matches</h1><p class="mt-2 text-muted">Acme Roofing, within 25 mi of Atlanta, GA.</p><div class="mt-6">${feed}</div></div></main></body></html>`,
    );
    writeFileSync(join(dir, 'digest.html'), digest().html);
    expect(feed).toContain('data-testid="brief"');
  });
});
