// P2-9: the `page` value is stored only when it is an allowed page id.
import { describe, expect, it } from 'vitest';
import { cleanPage, INTEREST_PAGES } from '@/lib/interest/features';
import { recordInterest } from '@/lib/interest/service';
import { fakeInterest } from './helpers';

describe('cleanPage', () => {
  it('keeps every allowed page id', () => {
    for (const id of INTEREST_PAGES) expect(cleanPage(id)).toBe(id);
    expect(cleanPage(' pricing ')).toBe('pricing');
  });
  it('anything else is null', () => {
    for (const v of ['other', 'Pricing', 'pricing/x', 'abcdefghij', 'a'.repeat(40), 'a'.repeat(300), '', ' ', '<script>', 42, null, undefined, {}, ['app']]) {
      expect(cleanPage(v), String(v)).toBeNull();
    }
  });
});

describe('recordInterest stores the page only when allowed', () => {
  it('a signed-out pick with an unknown page is stored with page null', async () => {
    const f = fakeInterest();
    const r = await recordInterest(f.deps, { feature: 'spanish', page: 'x'.repeat(40), userId: null, ip: '203.0.113.1', cookiePicked: [] });
    expect(r.code).toBe('ok');
    expect(f.writes[0].row).toEqual({ feature: 'spanish', page: null, user_id: null });
  });
  it('a signed-in pick with an unknown page is stored with page null; a known page is kept', async () => {
    const f = fakeInterest();
    await recordInterest(f.deps, { feature: 'spanish', page: 'free-text-tag', userId: 'u-1', ip: '203.0.113.1', cookiePicked: [] });
    await recordInterest(f.deps, { feature: 'gov-bids', page: 'app', userId: 'u-1', ip: '203.0.113.1', cookiePicked: [] });
    expect(f.writes[0].row).toEqual({ feature: 'spanish', user_id: 'u-1', page: null });
    expect(f.writes[1].row).toEqual({ feature: 'gov-bids', user_id: 'u-1', page: 'app' });
  });
});
