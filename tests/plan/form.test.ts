// Pure helpers behind the profile form's plan limits, plus the locked Pro section as rendered HTML. Inputs are hand-written.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { toggleTrade, tradeLimitView } from '@/components/profile-form-groups';
import { ProfileForm } from '@/components/profile-form';
import { DOWNGRADE_NOTE, planLimitsLine } from '@/lib/plan';

describe('trade chips by plan', () => {
  it('stops adding at the plan limit, always allows removing', () => {
    const five = ['a', 'b', 'c', 'd', 'e'];
    expect(toggleTrade(five, 'f', 5)).toEqual(five);
    expect(toggleTrade(five, 'f', 15)).toEqual([...five, 'f']);
    expect(toggleTrade(five, 'c', 5)).toEqual(['a', 'b', 'd', 'e']);
  });
  it('after a downgrade, splits saved picks into used and kept-but-unused', () => {
    const v = tradeLimitView(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 5);
    expect(v.used).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(v.unused).toEqual(['f', 'g']);
    expect(v.full).toBe(true);
  });
});

describe('ProfileForm Pro fields', () => {
  const cats = [{ id: 'roofing', label: 'Roofing' }];
  const action = async () => ({});
  const render = (tier: 'starter' | 'pro', extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      createElement(ProfileForm, {
        action,
        categories: cats,
        defaults: { business_name: 'A', categories: ['roofing'], zip: '30303', radius: 25, alert_email: true, ...extra },
        submitLabel: 'Save',
        tier,
      }),
    );
  it('starter and trial: extra ZIP and keyword inputs are disabled, with a short upgrade prompt', () => {
    const html = render('starter', { extra_zips: ['30601'], keywords: ['tree removal'] });
    expect(html.match(/name="extra_zip"[^>]*disabled|disabled[^>]*name="extra_zip"/g)?.length).toBe(2);
    expect(html.match(/name="keyword"[^>]*disabled|disabled[^>]*name="keyword"/g)?.length).toBe(5);
    expect(html).toContain('Pro adds 2 more ZIP codes, up to 15 trades and 5 keyword watches.');
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('They are not used on your current plan.');
    expect(html).toContain('Pick up to 5.');
  });
  it('pro: inputs are enabled and the trade limit is 15', () => {
    const html = render('pro', { extra_zips: ['30601'], keywords: ['tree removal'] });
    expect(html).not.toMatch(/name="extra_zip"[^>]*disabled/);
    expect(html).toContain('value="30601"');
    expect(html).toContain('value="tree removal"');
    expect(html).toContain('Pick up to 15.');
  });
});

describe('plan copy', () => {
  it('downgrade note says extras stop being used and stay saved', () => {
    expect(DOWNGRADE_NOTE).toMatch(/extra areas, trades beyond 5 and keyword watches stop being used/);
    expect(DOWNGRADE_NOTE).toMatch(/stay saved/);
    expect(DOWNGRADE_NOTE).not.toContain('—');
  });
  it('limits lines', () => {
    expect(planLimitsLine('starter')).toBe('1 ZIP code, up to 5 trades');
    expect(planLimitsLine('pro')).toBe('3 ZIP codes, up to 15 trades, 5 keyword watches');
  });
});
