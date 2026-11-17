// The signup form says, right under the submit button, that creating an account means agreeing to the Terms and Privacy Policy.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SignupForm } from '@/components/auth-forms';

describe('SignupForm consent line', () => {
  const html = renderToStaticMarkup(createElement(SignupForm, {}));
  const text = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');

  it('shows the sentence with links to both pages', () => {
    expect(text).toContain('By creating an account you agree to the Terms and Privacy Policy.');
    expect(html).toMatch(/<a [^>]*href="\/terms"[^>]*>Terms<\/a>/);
    expect(html).toMatch(/<a [^>]*href="\/privacy"[^>]*>Privacy Policy<\/a>/);
  });

  it('puts it right after the submit button, with no checkbox', () => {
    const button = html.indexOf('type="submit"');
    const consent = html.indexOf('By creating an account');
    expect(button).toBeGreaterThan(-1);
    expect(consent).toBeGreaterThan(button);
    expect(html.slice(button, consent)).not.toContain('<input');
    expect(html).not.toContain('type="checkbox"');
  });
});
