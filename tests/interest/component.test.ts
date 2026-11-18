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
    expect(FEATURES.map((f) => f.id)).toEqual(['gov-bids', 'spanish', 'asking-online', 'city-weekly']);
    expect(FEATURES.map((f) => f.label)).toEqual(['Local government bids', 'Holler in Spanish', 'People asking online', 'Free weekly city email']);
    expect(FEATURE_IDS).toEqual(['gov-bids', 'spanish', 'asking-online', 'city-weekly']);
  });
  it('the migration check constraint lists the same ids', () => {
    const sql = readFileSync('supabase/migrations/0008_holler_feature_interest.sql', 'utf8');
    const m = sql.match(/check \(feature in \(([^)]*)\)\)/)!;
    expect(m[1].split(',').map((s) => s.trim().replace(/'/g, ''))).toEqual([...FEATURE_IDS]);
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
    const m = renderToStaticMarkup(createElement(ComingNext, { page: 'app', initialPicked: ['spanish'] }));
    expect(m.match(/>Picked</g)).toHaveLength(1);
    expect(m.match(/<button[^>]*\sdisabled(="")?[\s>]/g)).toHaveLength(1);
    expect(m).toContain('aria-label="Picked: Holler in Spanish"');
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
    const c = pickedSetCookie(['city-weekly', 'spanish'], true);
    const value = decodeURIComponent(c.split(';')[0].split('=')[1]);
    expect(c.startsWith(`${PICKED_COOKIE}=`)).toBe(true);
    expect(value).toBe('spanish,city-weekly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain(`Max-Age=${180 * 86400}`);
    expect(pickedSetCookie([], false)).not.toContain('Secure');
  });
  it('parses a document.cookie string, ignoring unknown values', () => {
    expect(pickedFromCookieString('a=1; holler_picked=gov-bids%2Cnope%2Cspanish; b=2')).toEqual(['gov-bids', 'spanish']);
    expect(pickedFromCookieString('')).toEqual([]);
    expect(pickedFromCookieString('xholler_picked=spanish')).toEqual([]);
    expect(parsePicked('spanish,spanish')).toEqual(['spanish']);
  });
});
