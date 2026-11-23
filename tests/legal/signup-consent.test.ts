// The signup form says, right under the submit button, that creating an account means agreeing to the Terms and Privacy Policy.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SignupForm } from '@/components/auth-forms';
import { STATS_CONSENT_TEXT } from '@/lib/auth/stats-consent';

describe('SignupForm consent line', () => {
  const html = renderToStaticMarkup(createElement(SignupForm, {}));
  const text = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');

  it('shows the sentence with links to both pages', () => {
    expect(text).toContain('By creating an account you agree to the Terms and Privacy Policy.');
    expect(html).toMatch(/<a [^>]*href="\/terms"[^>]*>Terms<\/a>/);
    expect(html).toMatch(/<a [^>]*href="\/privacy"[^>]*>Privacy Policy<\/a>/);
  });

  it('puts it right after the submit button, and the terms sentence itself is never a tick box', () => {
    const button = html.indexOf('type="submit"');
    const consent = html.indexOf('By creating an account');
    expect(button).toBeGreaterThan(-1);
    expect(consent).toBeGreaterThan(button);
    expect(html.slice(button, consent)).not.toContain('<input');
  });

  // Round 23: the ONE tick box on the form is the optional data-use consent (lib/auth/stats-consent.ts). It is unticked, it is above the
  // button, and nothing about creating the account depends on it. Agreeing to the Terms is still a sentence, never a box.
  it('has exactly one checkbox: the optional data-use box, unticked, above the button, with the owner wording', () => {
    const boxes = html.match(/type="checkbox"/g) ?? [];
    expect(boxes).toHaveLength(1);
    expect(html).toContain('name="stats_consent"');
    expect(html).not.toMatch(/name="stats_consent"[^>]*checked/);
    expect(html).not.toMatch(/checked[^>]*name="stats_consent"/);
    expect(html.indexOf('name="stats_consent"')).toBeLessThan(html.indexOf('type="submit"'));
    expect(text.replace(/&#x27;|&#39;/g, "'")).toContain(STATS_CONSENT_TEXT);
    expect(STATS_CONSENT_TEXT.startsWith("Count my alert taps and job results in Holler's combined statistics.")).toBe(true);
    expect(STATS_CONSENT_TEXT).toContain('I can turn this off in Settings.');
    // The button says nothing about it, so nobody reads the box as a condition of signing up.
    expect(text).toContain('Create account');
  });
});
