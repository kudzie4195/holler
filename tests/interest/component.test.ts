// The "Coming next" component: server render shows every button unpicked, copy rules, cookie helpers.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ComingNext } from '../../components/coming-next';
import { PICKED_COOKIE, parsePicked, pickedFromCookieString, pickedSetCookie } from '../../lib/interest/cookie';
import { COMING_NEXT, FEATURES, FEATURE_IDS } from '../../lib/interest/features';

const html = renderToStaticMarkup(createElement(ComingNext, { page: 'pricing' }));
const text = html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, ' ');

describe('feature list', () => {
  it('is exactly the four features, in order, with the agreed ids', () => {
    // Round 23: 'spanish' is gone from Coming next. Spanish is live at /es, so offering it as a future feature was wrong.
    expect(FEATURES.map((f) => f.id)).toEqual(['gov-bids', 'asking-online', 'city-weekly', 'more-areas']);
    expect(FEATURES.map((f) => f.label)).toEqual(['Local government bids', 'People asking online', 'Free weekly city email', 'More ZIP codes']);
    expect(FEATURE_IDS).toEqual(['gov-bids', 'asking-online', 'city-weekly', 'more-areas']);
  });
  it('the newest migration check constraint allows every id that is offered', () => {
    // 0031 (the other branch's 0021, renamed) widened the constraint 0008 created; the newest definition is the one in force.
    // Round 23 retired 'spanish' from the offered list, so the constraint is now a superset: it still ACCEPTS an id nobody can pick
    // (the rows collected before are still valid), and it must never REFUSE one that is offered. That is what this checks.
    const sql = readFileSync('supabase/migrations/0031_holler_zip_waitlist.sql', 'utf8');
    const m = sql.match(/check \(feature in \(([^)]*)\)\)/)!;
    const allowed = m[1].split(',').map((s) => s.trim().replace(/'/g, ''));
    for (const id of FEATURE_IDS) expect(allowed, id).toContain(id);
    expect(allowed.filter((id) => !(FEATURE_IDS as readonly string[]).includes(id))).toEqual(['spanish']);
  });
});

describe('server render', () => {
  it('shows every button as "I want this" and none disabled or picked', () => {
    expect(html.match(/<button/g)).toHaveLength(4);
    expect(html.match(/>I want this</g)).toHaveLength(4);
    expect(html).not.toContain('>Picked<');
    expect(html).not.toMatch(/<button[^>]*\sdisabled(="")?[\s>]/);
  });
  it('has the heading, the intro line, every label and description', () => {
    expect(text).toContain('Coming next');
    expect(text).toContain('We build what gets picked. Tell us what you want.');
    for (const f of FEATURES) {
      expect(text).toContain(f.label);
      expect(text).toContain(f.description);
    }
  });
  it('is accessible: real buttons with a name that holds the visible text, and a polite status region that starts empty', () => {
    expect(html).toContain('aria-label="I want this: Local government bids"');
    expect(html).toMatch(/<p role="status"[^>]*><\/p>/);
    expect(html).toMatch(/<section aria-labelledby=/);
    expect(html).toContain('min-h-11');
  });
  it('renders a member\'s earlier picks as Picked and disabled', () => {
    const m = renderToStaticMarkup(createElement(ComingNext, { page: 'app', initialPicked: ['asking-online'] }));
    expect(m.match(/>Picked</g)).toHaveLength(1);
    expect(m.match(/<button[^>]*\sdisabled(="")?[\s>]/g)).toHaveLength(1);
    expect(m).toContain('aria-label="Picked: People asking online"');
  });
  it('shows no counts or percentages', () => {
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(/people want|have picked|votes?|%/i);
  });
});

describe('copy rules', () => {
  const all = [text, ...Object.values(COMING_NEXT), ...FEATURES.flatMap((f) => [f.label, f.description])].join(' ');
  it('has no em dash or en dash', () => {
    expect(all).not.toMatch(/[–—]/);
    expect(html).not.toMatch(/&mdash;|&ndash;/);
  });
  it('has no banned words', () => {
    for (const w of ['delve', 'robust', 'seamless', 'elevate', 'unlock', 'empower', 'journey', 'landscape', 'leverage', 'not only', 'more than just']) {
      expect(all.toLowerCase()).not.toContain(w);
    }
  });
  it('promises no date and does not say a feature exists', () => {
    expect(all).not.toMatch(/\b(20\d\d|soon|shortly|next (week|month|quarter|year)|this (week|month|year)|q[1-4]|by (january|february|march|april|may|june|july|august|september|october|november|december))\b/i);
    expect(all).not.toMatch(/\b(available now|now live|is live|launched|we (have|offer))\b/i);
    expect(all).not.toMatch(/\b(will|going to) (launch|ship|arrive)\b/i);
  });
  it('asks for no email', () => {
    expect(html).not.toMatch(/<input|type="email"/i);
  });
});

describe('holler_picked cookie helpers', () => {
  it('holds only feature ids and no identifier', () => {
    const c = pickedSetCookie(['city-weekly', 'asking-online'], true);
    const value = decodeURIComponent(c.split(';')[0].split('=')[1]);
    expect(c.startsWith(`${PICKED_COOKIE}=`)).toBe(true);
    expect(value).toBe('asking-online,city-weekly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain(`Max-Age=${180 * 86400}`);
    expect(pickedSetCookie([], false)).not.toContain('Secure');
  });
  it('parses a document.cookie string, ignoring unknown values', () => {
    expect(pickedFromCookieString('a=1; holler_picked=gov-bids%2Cnope%2Casking-online; b=2')).toEqual(['gov-bids', 'asking-online']);
    expect(pickedFromCookieString('')).toEqual([]);
    expect(pickedFromCookieString('xholler_picked=asking-online')).toEqual([]);
    expect(parsePicked('asking-online,asking-online')).toEqual(['asking-online']);
  });
});
