// The waitlist card: server render, accessibility hooks, copy rules.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AreaWaitlist } from '../../components/area-waitlist';
import { checkTradeGroups } from '../../components/check-form';
import { WAITLIST } from '../../lib/waitlist/copy';

// Round 23: the trade options come from the server, from the same builder the check form uses (so the two lists cannot drift apart).
const groups = checkTradeGroups('roofing');
const html = renderToStaticMarkup(createElement(AreaWaitlist, { zip: '59001', trade: 'roofing', placeLabel: 'Absarokee, MT', groups }));
const text = html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, ' ');

describe('server render', () => {
  it('has one section named by its heading, one required email input, one submit button', () => {
    expect(html).toMatch(/<section aria-labelledby="[^"]+"/);
    expect(html.match(/<h2/g)).toHaveLength(1);
    expect(html).toMatch(/<input[^>]*name="email"[^>]*type="email"|<input[^>]*type="email"[^>]*name="email"/);
    expect(html).toMatch(/<input[^>]*\srequired=""[^>]*name="email"/);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('type="submit"');
  });
  it('labels every visible control and keeps a 44 px target', () => {
    expect(html).toContain('>Your email<');
    expect(html).toContain('>What you do<');
    expect(html).toContain('min-h-11');
  });
  it('the status region is always in the layout and starts empty', () => {
    expect(html).toMatch(/<p id="[^"]+" role="status"[^>]*><\/p>/);
  });
  it('the honeypot is hidden from people and screen readers and cannot be tabbed to', () => {
    expect(html).toMatch(/aria-hidden="true"[^>]*><label[^>]*>Leave this empty<\/label><input[^>]*tabindex="-1"[^>]*autoComplete="off"[^>]*name="leave_blank"/);
    expect(html).toContain('-left-[10000px]');
  });
  it('shows no counts or percentages', () => {
    expect(text.replace('59001', '')).not.toMatch(/\d/);
    expect(text).not.toMatch(/people (are )?waiting|have joined|%/i);
  });
});

describe('copy rules', () => {
  const all = [text, ...Object.values(WAITLIST).filter((v) => typeof v === 'string'), WAITLIST.thanks('Absarokee, MT'), ...Object.values(WAITLIST.errors)].join(' ');
  it('never says lead, they need you, you will win or guaranteed', () => {
    expect(all).not.toMatch(/\blead(s)?\b|they need you|you will win|guarantee|official record/i);
  });
  it('promises no date and no number of people', () => {
    expect(all).not.toMatch(/soon|by (next|january|february|march|spring|summer)|within \d|this week|this month/i);
  });
  it('uses no em or en dashes (the site copy rule)', () => {
    expect(all).not.toMatch(/[—–]/);
  });
  it('the brief wording is exact', () => {
    expect(WAITLIST.heading('Absarokee, MT')).toBe("Holler isn't covering Absarokee, MT yet.");
    expect(WAITLIST.intro).toBe("Leave your email and we'll tell you when it does.");
  });
  it('the weather note matches what the app does: hazards are national, permits and city requests need a local feed', () => {
    // INT2: "warnings", not "alerts": a zone-only advisory is not placed by county (lib/signals/adapters/nws.ts COUNTY_MIN_SEVERITY).
    expect(WAITLIST.note).toMatch(/Storm reports and weather warnings reach every ZIP/);
    expect(WAITLIST.note).toMatch(/Permits and city requests need a local source/);
  });
});
