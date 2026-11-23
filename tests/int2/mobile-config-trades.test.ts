/**
 * Round 24 INT2: /api/m/config offers the same trades a new web profile can pick. The site has no app, but the route is public, so its
 * list must not offer a trade the web shows as "coming soon" (and the server refuses for a new profile).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { signupClosedTrades } from '@/lib/check/cells';
import { configBody } from '@/lib/mobile/config';
import { PRESSURE_WASHING_ID, profileCategories, tradeSignupPickable } from '@/lib/plan/profile-categories';
import { CATEGORIES } from '@/lib/signals/categories';

describe('the mobile config trade list is the web sign-up list', () => {
  const ids = configBody('https://localholler.com', null).trades.map((t) => t.id);
  it('no coming-soon trade is offered', () => {
    expect(signupClosedTrades().length).toBeGreaterThan(0);
    for (const t of signupClosedTrades()) expect(ids, t).not.toContain(t);
  });
  it('equals the pickable chips of a new web profile, in category order', () => {
    const web = profileCategories('en').filter((c) => !c.comingSoon && c.id !== PRESSURE_WASHING_ID).map((c) => c.id);
    expect([...ids].sort()).toEqual([...new Set(web)].sort());
    expect(ids).toEqual(CATEGORIES.map((c) => c.id).filter(tradeSignupPickable));
    for (const t of ['landscaping', 'lawn-care', 'siding-gutters', 'cleaning']) expect(ids).toContain(t);
  });
});
