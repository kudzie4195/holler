// The public /delete-account page (Google Play's account deletion URL): readable without sign-in, indexable, not in the main nav,
// and every step matches the web and app code it describes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderLegal, src } from './render-helper';
import { COMPANY } from '@/lib/legal/company';

vi.mock('@/components/doc-page', async () => (await import('./render-helper')).docPageMock());
afterEach(() => vi.unstubAllEnvs());

describe('/delete-account', () => {
  it('has its own title and canonical, and is not noindex', async () => {
    const { metadata, html } = await renderLegal('delete-account');
    expect(metadata.title).toBe('Delete your account');
    expect(metadata.alternates?.canonical).toBe('/delete-account');
    expect(metadata.robots).toBeUndefined();
    // Round 18 integration: the page's text did not change in round 18, so it keeps its own date (terms and privacy moved to November 22).
    // Round 24 (review P1-5): the app steps and the app-plan section came out, so the page reads November 23, 2026.
    expect(html).toContain('Last updated November 23, 2026');
    expect(src('app/delete-account/page.tsx')).not.toMatch(/robots\s*:|index:\s*false/);
  });

  it('needs no sign-in: no session read, not behind the proxy, not disallowed in robots', () => {
    const page = src('app/delete-account/page.tsx');
    expect(page).not.toMatch(/cookies\(|headers\(|createClient|getUser|redirect\(|connection\(/);
    expect(src('proxy.ts')).not.toContain('delete-account');
    expect(src('app/robots.ts')).toContain("disallow: ['/app/', '/api/']");
  });

  it('stays out of the main nav', () => {
    expect(src('components/top-nav.tsx')).not.toContain('delete-account');
  });

  it('round 24 (review P1-5): website steps only; no app, no store, no push', async () => {
    const { text, metadata } = await renderLegal('delete-account');
    expect(text).toContain('You can delete your Holler account yourself, on the website.');
    expect(String(metadata.description)).not.toMatch(/\bapp\b/);
    for (const gone of ['Open the Holler app and sign in.', 'Tap Delete account', 'A plan bought in the app', 'push tokens', 'app store billing events']) expect(text).not.toContain(gone);
    expect(text).not.toMatch(/iPhone|Android|App Store|Google Play|push notification/i);
  });

  it('web steps match the Settings page', async () => {
    const { text, html } = await renderLegal('delete-account');
    expect(text).toMatch(new RegExp(`Sign in at ${COMPANY.site.replace('.', '\\.')} ?\\.`));
    expect(html).toContain('href="/login"');
    expect(text).toContain('Under Delete account, press Delete my account.');
    expect(text).toContain('Press Yes, delete everything.');
    expect(src('app/app/settings/page.tsx')).toContain('>Delete account</h3>');
    const comp = src('components/delete-account.tsx');
    expect(comp).toContain('Delete my account');
    expect(comp).toContain("'Yes, delete everything'");
  });

  it('says what is deleted, what is kept, store plans, timing and the support route', async () => {
    const { text, html } = await renderLegal('delete-account');
    expect(text).toContain('Your business profile and your matched alerts go, with any reply drafts.');
    expect(text).toContain('A plan you bought on our website is canceled at once.');
    expect(text).toContain('Your sign-in. It is shared with other apps we run, so it stays.');
    expect(text).toContain('A note of when your free trial started. It stops a second free trial.');
    expect(text).toContain('Trend counts made from old public records. They never held your name or account.');
    expect(text).toContain('Stripe keeps its own records for website payments.');
    expect(text).not.toContain('a plan you bought in the app');
    expect(text).toContain('Deletion starts the moment you confirm.');
    expect(text).toContain('If we cannot cancel a website plan, we delete nothing.');
    expect(src('lib/mobile/account.ts')).toContain("return { ok: false, error: 'billing_cancel_failed' };");
    expect(text).toContain('Write to support@localholler.com from the email on your account and ask us to delete it.');
    expect(html).toContain('href="mailto:support@localholler.com"');
    expect(html).toContain('href="/privacy"');
    const without = await renderLegal('delete-account', '');
    expect(without.html).not.toContain('mailto:');
    expect(without.text).toContain('the contact link in any Holler email');
  });

  it('privacy and terms link to it', async () => {
    expect((await renderLegal('privacy')).html).toContain('href="/delete-account"');
    expect((await renderLegal('terms')).html).toContain('href="/delete-account"');
  });
});
