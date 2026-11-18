// Legal pages: render the real page functions (DocPage is replaced by a plain shell, so the design unit's restyle cannot break this test)
// and check the facts the owner asked for are present, come from COMPANY, and follow the house copy rules.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { COMPANY } from '@/lib/legal/company';

vi.mock('@/components/doc-page', () => ({
  DocPage: ({ title, intro, updated, children }: { title: string; intro?: string; updated?: string; children: ReactNode }) =>
    createElement('main', null, createElement('h1', null, title), intro ? createElement('p', null, intro) : null, updated ? createElement('p', null, `Last updated ${updated}`) : null, children),
  DocSection: ({ title, children }: { title: string; children: ReactNode }) =>
    createElement('section', null, createElement('h2', null, title), children),
}));

const BANNED = [
  'delve', 'seamless', 'robust', 'comprehensive', 'holistic', 'elevate', 'unlock', 'unleash', 'empower', 'journey', 'landscape', 'realm',
  'game-changer', 'leverage', 'utilize', 'moreover', 'furthermore', 'effortless', 'supercharge', 'revolutionize',
];

async function render(page: 'terms' | 'privacy', support: string) {
  vi.resetModules();
  vi.stubEnv('SUPPORT_EMAIL', support);
  const mod = page === 'terms' ? await import('@/app/terms/page') : await import('@/app/privacy/page');
  const html = renderToStaticMarkup(createElement(mod.default));
  const text = html
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<\/(p|li|h1|h2|address)>/g, '.\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim();
  return { html, text, metadata: mod.metadata };
}

/** Sentence stats as the copy script measures them: split on . ! ? followed by space; words are whitespace tokens. */
function stats(text: string) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => /[A-Za-z]/.test(s));
  const lens = sentences.map((s) => s.split(/\s+/).length);
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
  return { mean, short: lens.filter((n) => n < 8).length / lens.length, cv: sd / mean, n: lens.length };
}

afterEach(() => vi.unstubAllEnvs());

describe.each(['terms', 'privacy'] as const)('%s page', (page) => {
  it('keeps title, canonical and the new date', async () => {
    const { html, metadata } = await render(page, 'support@localholler.com');
    expect(metadata.title).toBe(page === 'terms' ? 'Terms' : 'Privacy');
    expect(metadata.alternates?.canonical).toBe(`/${page}`);
    expect(html).toContain(page === 'privacy' ? 'Last updated November 18, 2026' : 'Last updated November 17, 2026');
  });

  it('names the operator and postal address from COMPANY', async () => {
    const { text } = await render(page, 'support@localholler.com');
    expect(text).toContain(COMPANY.legalName);
    expect(text).toContain(COMPANY.entity);
    expect(text).toContain(COMPANY.addressLine);
    for (const line of COMPANY.addressLines) expect(text).toContain(line);
  });

  it('links the support address when set, and falls back to the email contact link when unset', async () => {
    const withSupport = await render(page, 'support@localholler.com');
    expect(withSupport.html).toContain('href="mailto:support@localholler.com"');
    const without = await render(page, '');
    expect(without.html).not.toContain('mailto:');
    expect(without.text).toContain('the contact link in any Holler email');
  });

  it('follows the copy rules: no em dash, no banned words, sentence rhythm', async () => {
    const { html, text } = await render(page, 'support@localholler.com');
    expect(html).not.toContain('—');
    expect(html).not.toContain('&mdash;');
    for (const w of BANNED) expect(text.toLowerCase()).not.toMatch(new RegExp(`\\b${w}\\b`));
    expect(text).not.toMatch(/whether you're|not just/i);
    const s = stats(text);
    expect(s.mean).toBeLessThanOrEqual(22);
    expect(s.short).toBeGreaterThanOrEqual(0.12);
    expect(s.cv).toBeGreaterThanOrEqual(0.55);
  });
});

describe('terms content', () => {
  it('states both plan prices and automatic renewal conspicuously', async () => {
    const { html, text } = await render('terms', 'support@localholler.com');
    expect(text).toContain('Starter: $5 a month, or $48 a year');
    expect(text).toContain('Pro: $9.99 a month, or $96 a year');
    expect(text).toContain('7-day free trial');
    expect(html).toContain('<strong>Your plan renews automatically until you cancel.</strong>');
    expect(text).toMatch(/renews automatically/);
    expect(text).toContain('Settings and choose Manage billing');
    expect(text).toContain('at least 30 days before the new price');
    expect(text).toContain('Stripe prorates the change');
  });

  it('has the Fair Credit Reporting Act statement', async () => {
    const { text } = await render('terms', 'x@y.z');
    expect(text).toContain('Holler is not a consumer reporting agency under the Fair Credit Reporting Act');
    expect(text).toMatch(/credit, insurance, employment, housing/);
  });

  it('has the disclaimer, the liability cap, the venue and governing law from COMPANY', async () => {
    const { html, text } = await render('terms', 'x@y.z');
    expect(html).toMatch(/<strong>Holler is provided &quot;as is&quot; and &quot;as available\.&quot;<\/strong>/);
    expect(text).toContain('the greater of what you paid Holler in the 12 months before the claim, or $100');
    expect(text).toContain('Some states do not allow some of these limits');
    expect(text).toContain('Cobb County, Georgia');
    expect(text).toContain('Northern District of Georgia');
    expect(text).toContain(`laws of the State of ${COMPANY.governingLaw}`);
    expect(text).toContain('Give us 30 days');
    expect(text).toMatch(/not\s+brought as a class action/);
    expect(text).toContain('within one year');
    expect(text.toLowerCase()).not.toContain('arbitration');
  });

  it('covers resident requests and the removal route for public records', async () => {
    const { html, text } = await render('terms', 'support@localholler.com');
    expect(text).toContain('We do not check businesses');
    expect(text).toContain('Up to 5 businesses can reply. A request stays open for 14 days');
    expect(text).toContain('call 911');
    expect(text).toMatch(/not affiliated with or endorsed by any government agency/);
    expect(text).toMatch(/Corrections and removal\. .*write to support@localholler\.com with the link to the page/);
    expect(html).toContain('href="/request"');
    expect(html).toContain('href="/privacy"');
  });
});

describe('privacy content', () => {
  it('names every processor verified in code and says no sale and no trackers', async () => {
    const { text } = await render('privacy', 'support@localholler.com');
    for (const p of ['Supabase', 'Vercel', 'Stripe', 'Resend', 'Anthropic']) expect(text).toContain(p);
    expect(text).toContain('We do not sell personal information');
    expect(text).toContain('cross-context behavioral advertising');
    expect(text).toContain('There are no advertising or analytics trackers on Holler');
    expect(text).toContain('We never see or store card numbers');
  });

  it('gives the removal route for people named in public records and the 30 day answer', async () => {
    const { text } = await render('privacy', 'support@localholler.com');
    expect(text).toMatch(/Named in a record\? Write to support@localholler\.com with the link to the page/);
    expect(text).toContain('We answer within 30 days');
    expect(text).toContain('whatever state you live in');
  });

  it('describes deletion as the code does it: shared sign-in kept, trial notes kept', async () => {
    const { text } = await render('privacy', 'x@y.z');
    expect(text).toContain('deletes your profile, your matched alerts, your drafts and the record of which requests you replied to');
    expect(text).toContain('It keeps the shared sign-in');
    expect(text).toContain('These counters are deleted after about two days');
  });

  it('does not claim sources that are not live without keys', async () => {
    const { text } = await render('privacy', 'x@y.z');
    expect(text).not.toMatch(/bluesky|ticketmaster|sam\.gov|web search|licensed search/i);
  });
});
