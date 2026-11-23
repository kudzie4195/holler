// Fixtures: all inputs are hand-written (assumed); no external API shapes are asserted here.
import { describe, expect, it } from 'vitest';
import { signUnsubscribeToken, verifyUnsubscribeToken } from '../../lib/email/token';
import { renderDigest, renderPasswordReset, renderWelcome } from '../../lib/email/templates';
import { decideNotify } from '../../lib/email/notify-logic';
import { fallbackDraft, violatesDraftRules, BANNED_WORDS } from '../../lib/ai/fallback';
import { mapStripeStatus } from '../../lib/stripe/status';

const SECRET = 'test-secret';
const UID = '3f2c9d1e-0000-4000-8000-123456789abc';

describe('unsubscribe token', () => {
  it('round-trips', () => {
    expect(verifyUnsubscribeToken(signUnsubscribeToken(UID, SECRET), SECRET)).toBe(UID);
  });
  it('rejects tampered payload, tampered signature, wrong secret, garbage', () => {
    const t = signUnsubscribeToken(UID, SECRET);
    const [p, s] = t.split('.');
    const other = signUnsubscribeToken('someone-else', SECRET).split('.')[0];
    expect(verifyUnsubscribeToken(`${other}.${s}`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(`${p}.${s.slice(0, -2)}AA`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(t, 'other-secret')).toBeNull();
    expect(verifyUnsubscribeToken('nope', SECRET)).toBeNull();
    expect(verifyUnsubscribeToken('', SECRET)).toBeNull();
  });
});

describe('templates', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  const digest = renderDigest({
    businessName: 'Ace <Roofing> — Co',
    items: [
      { kind: 'alert', title: 'Hail <script>alert(1)</script> warning — Marietta', place: 'Marietta, GA', occurredAt: '2026-06-01T11:00:00Z', sourceUrl: 'https://alerts.weather.gov/x?a=1&b=2' },
      { kind: 'ask', title: 'Anyone recommend a roofer?', occurredAt: '2026-06-01T10:00:00Z', sourceUrl: 'javascript:alert(1)' },
    ],
    totalCount: 5,
    appUrl: 'https://holler.example/app',
    unsubscribeUrl: 'https://holler.example/api/cron/notify/unsubscribe?t=abc',
    now,
  });
  it('has no em dashes anywhere', () => {
    for (const r of [digest, renderPasswordReset({ resetUrl: 'https://x.test/r' }), renderWelcome({ businessName: 'A — B', appUrl: 'https://x.test/app' })]) {
      expect(r.subject + r.html + r.text).not.toContain('—');
    }
  });
  it('escapes HTML in titles and business name, and drops unsafe urls', () => {
    expect(digest.html).not.toContain('<script>');
    expect(digest.html).toContain('&lt;script&gt;');
    expect(digest.html).not.toContain('Ace <Roofing>');
    expect(digest.html).not.toContain('javascript:');
    expect(digest.html).toContain('a=1&amp;b=2');
  });
  it('lists links, unsubscribe and overflow count', () => {
    expect(digest.html).toContain('https://holler.example/app');
    expect(digest.html).toContain('unsubscribe?t=abc');
    expect(digest.text).toContain('Plus 3 more');
    expect(digest.subject).toBe('Weather alert at Marietta, GA (+4 more)');
  });
});

describe('draft fallback', () => {
  const d = fallbackDraft({ businessName: 'Ace Roofing', categories: ['roofing'], title: 'Need a roofer', city: 'Marietta' });
  it('obeys banned words, no urls, no em dash', () => {
    const lower = d.toLowerCase();
    for (const w of BANNED_WORDS) expect(lower).not.toContain(w);
    expect(d).not.toMatch(/https?:|www\./i);
    expect(d).not.toContain('—');
    expect(violatesDraftRules(d)).toBe(false);
    expect(d.split('Ace Roofing').length - 1).toBe(1);
  });
  it('rule checker catches violations', () => {
    expect(violatesDraftRules('Check https://x.com now.')).toBe(true);
    expect(violatesDraftRules('We offer a seamless fix.')).toBe(true);
    expect(violatesDraftRules('Call us — now.')).toBe(true);
    expect(violatesDraftRules('Great work \u{1F600}.')).toBe(true);
  });
});

describe('notify gating', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  const base = { alert_email: true, subscription_status: 'trialing', trial_ends_at: '2026-06-03T00:00:00Z', last_notified_at: null, email_verified_at: '2026-05-30T00:00:00Z' };
  it('allows trialing inside trial and active', () => {
    expect(decideNotify(base, now).ok).toBe(true);
    expect(decideNotify({ ...base, subscription_status: 'active', trial_ends_at: '2020-01-01T00:00:00Z' }, now).ok).toBe(true);
  });
  it('blocks expired trial, past_due, canceled, alerts off', () => {
    expect(decideNotify({ ...base, trial_ends_at: '2026-05-31T00:00:00Z' }, now)).toEqual({ ok: false, reason: 'not_entitled' });
    expect(decideNotify({ ...base, subscription_status: 'past_due' }, now)).toEqual({ ok: false, reason: 'not_entitled' });
    expect(decideNotify({ ...base, subscription_status: 'canceled' }, now)).toEqual({ ok: false, reason: 'not_entitled' });
    expect(decideNotify({ ...base, alert_email: false }, now)).toEqual({ ok: false, reason: 'alerts_off' });
  });
  it('only emails verified addresses', () => {
    expect(decideNotify({ ...base, email_verified_at: null }, now)).toEqual({ ok: false, reason: 'unverified' });
    expect(decideNotify({ ...base, subscription_status: 'active', email_verified_at: null }, now)).toEqual({ ok: false, reason: 'unverified' });
  });
  it('honors the 60 minute rule at the boundary', () => {
    expect(decideNotify({ ...base, last_notified_at: '2026-06-01T11:01:00Z' }, now)).toEqual({ ok: false, reason: 'throttled' });
    expect(decideNotify({ ...base, last_notified_at: '2026-06-01T11:00:00Z' }, now).ok).toBe(true);
    expect(decideNotify({ ...base, last_notified_at: '2026-06-01T09:00:00Z' }, now).ok).toBe(true);
  });
});

describe('stripe status mapping', () => {
  it('maps', () => {
    expect(mapStripeStatus('active')).toBe('active');
    expect(mapStripeStatus('trialing')).toBe('active');
    expect(mapStripeStatus('past_due')).toBe('past_due');
    // Owner decision (billing-fix 7): unpaid and paused are not paid. Stored as canceled: no paid access, no Pro limits, nothing deleted.
    expect(mapStripeStatus('unpaid')).toBe('canceled');
    expect(mapStripeStatus('paused')).toBe('canceled');
    expect(mapStripeStatus('canceled')).toBe('canceled');
    expect(mapStripeStatus('incomplete_expired')).toBe('canceled');
    expect(mapStripeStatus('incomplete')).toBeNull();
    expect(mapStripeStatus('whatever')).toBeNull();
  });
});
