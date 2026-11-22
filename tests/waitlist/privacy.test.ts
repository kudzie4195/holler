// The privacy page says what the waitlist collects, in the same places it lists the Coming next picks.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('app/privacy/page.tsx', 'utf8').replace(/&apos;/g, "'").replace(/\s+/g, ' ');

describe('privacy page', () => {
  it('says what is collected and for what, next to the Coming next paragraph', () => {
    const i = page.indexOf('holler_picked, that remembers');
    const j = page.indexOf('Coming to your area card lets you leave your email');
    expect(j).toBeGreaterThan(i);
    expect(j - i).toBeLessThan(400);
    expect(page).toContain('We save your email, that ZIP code, the trade you picked and the page you were on, with no account and no name.');
    expect(page).toContain('We use the email only to tell you when we cover that area.');
  });
  it('says how long it is kept and how to have it deleted, in "How long we keep it"', () => {
    const keep = page.slice(page.indexOf('How long we keep it'));
    expect(keep).toContain('Coming to your area emails: until we tell you the area is covered, or until you ask us to delete it.');
    expect(keep).toContain('Write to us and we will delete it.');
  });
});
