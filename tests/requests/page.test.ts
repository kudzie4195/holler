// Criterion 8: /request is server-rendered with its metadata, the form works as a plain POST, inputs are phone-sized with tied labels and
// announced errors, and the copy follows CONTEXT.md (sentence-length mix, no em dashes, no banned words, the facts the brief asks for).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RequestPage, { metadata } from '../../app/request/page';
import RequestSentPage, { metadata as sentMetadata } from '../../app/request/sent/page';
import { RequestForm } from '../../components/request-form';
import { requestTradeGroups } from '../../lib/requests/trades';

const html = renderToStaticMarkup(createElement(RequestPage));
const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));

function decode(s: string): string {
  return s.replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
/** Prose blocks (headings, paragraphs, list items, labels), as a reader meets them. Trade names in the dropdown are not prose. */
function prose(fragment: string): string[] {
  const noSelect = fragment.replace(/<select[\s\S]*?<\/select>/g, ' ');
  const blocks = noSelect.match(/<(h1|h2|p|li|label)\b[^>]*>[\s\S]*?<\/\1>/g) ?? [];
  return blocks.map((b) => decode(b.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()).filter(Boolean);
}
function sentences(blocks: string[]): string[] {
  return blocks.flatMap((b) => b.split(/(?<=[.!?])\s+(?=[A-Z0-9])/)).map((s) => s.trim()).filter((s) => /[A-Za-z]/.test(s));
}
function stats(list: string[]) {
  const lens = list.map((s) => s.split(/\s+/).filter(Boolean).length);
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
  return { n: lens.length, mean, short: lens.filter((l) => l < 8).length / lens.length, cv: sd / mean };
}

const BANNED = [
  'delve', 'seamless', 'robust', 'comprehensive', 'holistic', 'elevate', 'unlock', 'unleash', 'empower', 'journey', 'landscape',
  'realm', 'game-changer', 'leverage', 'utilize', 'moreover', 'furthermore', 'effortless', 'supercharge', 'revolutionize',
];

describe('/request page', () => {
  it('has a title, a description and the canonical /request, and is indexable', () => {
    expect(metadata.title).toBe('Ask local businesses for a quote');
    expect(typeof metadata.description).toBe('string');
    expect((metadata.description as string).length).toBeGreaterThan(50);
    expect(metadata.alternates?.canonical).toBe('/request');
    expect(metadata.robots).toMatchObject({ index: true });
    expect(sentMetadata.robots).toMatchObject({ index: false });
  });

  it('is complete server-rendered HTML with the page shell and one h1', () => {
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(html).toContain('<main id="main"');
    expect(html).toContain('<footer');
  });

  it('the form is a plain POST to /api/requests, so it works without JavaScript', () => {
    expect(main).toMatch(/<form[^>]*action="\/api\/requests"[^>]*method="post"/);
    expect(main).not.toMatch(/<form[^>]*novalidate/i); // the browser checks fields when there is no script
    for (const name of ['trade', 'zip', 'description', 'email', 'consent', 'leave_blank']) expect(main).toContain(`name="${name}"`);
    expect(main).toMatch(/<button[^>]*type="submit"/);
  });

  it('every visible control has a label tied to it, is required, and is at least 44px tall', () => {
    const controls = [...main.matchAll(/<(input|select|textarea)\b([^>]*)>/g)]
      .map((m) => ({ tag: m[1], attrs: m[2] }))
      .filter((c) => !/name="leave_blank"/.test(c.attrs));
    expect(controls.map((c) => c.attrs.match(/name="([^"]+)"/)?.[1])).toEqual(['trade', 'zip', 'description', 'email', 'consent']);
    for (const c of controls) {
      const id = c.attrs.match(/id="([^"]+)"/)?.[1];
      expect(id, c.tag).toBeTruthy();
      expect(main).toContain(`for="${id}"`);
      expect(c.attrs).toContain('required');
      if (!/type="checkbox"/.test(c.attrs)) expect(c.attrs).toContain('min-h-11');
    }
    // The checkbox's label is the 44px touch target.
    expect(main).toMatch(/<label[^>]*class="[^"]*min-h-11[^"]*"[^>]*>\s*<input[^>]*type="checkbox"/);
  });

  it('errors are announced: a role="alert" message region, and field errors render with role="alert"', () => {
    expect(main).toMatch(/id="request-form-message" role="alert"/);
    const withErrors = renderToStaticMarkup(createElement(RequestForm, { groups: requestTradeGroups(() => false) }));
    expect(withErrors).toContain('role="alert"');
  });

  it('the honeypot is hidden from people and screen readers and is not in the tab order', () => {
    const pot = main.match(/<div aria-hidden="true" class="absolute -left-\[10000px\][^"]*">([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect(pot).toMatch(/<input[^>]*tabindex="-1"[^>]*name="leave_blank"|<input[^>]*name="leave_blank"[^>]*tabindex="-1"/);
  });

  it('lists only real service trades (no rideshare driving)', () => {
    expect(main).toContain('value="roofing"');
    expect(main).not.toContain('value="rideshare-delivery"');
  });

  it('says exactly what happens, in plain words', () => {
    const text = prose(main).join(' ');
    for (const fact of [
      'We email you a link',
      'Nothing is posted until you press it',
      'press the button on the page',
      'A request you never confirm is deleted after 7 days',
      // Round 3 P1-1: public pages carry only the service and the city; the description goes to matching businesses only.
      "Holler's public pages show only the service and your city",
      'Your description is never on a public page',
      'Matching businesses near you get your description',
      'phone numbers, emails, links, street addresses and names',
      'It can miss things',
      'They reply by email through Holler',
      'You see the business name, its city and its reply',
      'Businesses never see your email address unless you answer them',
      'Then they get your address and what you write back. Nothing else.',
      'stays open for 14 days',
      'within about 15 minutes',
      "a copy of each confirmed request to Holler's support inbox",
      'Our email provider keeps its own delivery records',
      'we delete your email address and your description right away',
      'we delete them 30 days later',
      'We keep only the service, ZIP code, city and dates',
      'Holler is new',
      'Some areas have no businesses on it yet',
      'It is free',
    ]) {
      expect(text).toContain(fact);
    }
    // The old promise that the description is public is gone, and so is the consent wording about public pages showing the request.
    expect(text).not.toContain('your city and your description');
    expect(text).not.toContain('without my email on public pages');
  });

  it('consent label matches the design: businesses get the request, public pages get the service and city only', () => {
    const text = prose(main).join(' ');
    expect(text).toContain('Holler may send my request to local businesses and show only the service and my city on public pages');
  });

  it('honeypot uses a field name no autofill maps, with autocomplete off; the old "website" field is gone', () => {
    expect(main).not.toMatch(/name="website"/);
    const input = main.match(/<input[^>]*name="leave_blank"[^>]*>/)?.[0] ?? '';
    expect(input).toMatch(/autocomplete="off"/i);
    expect(input).toMatch(/tabindex="-1"/);
  });

  it('follows the copy rules: sentence mix, no em dashes, no banned words, no invented claims', () => {
    const s = stats(sentences(prose(main)));
    expect(s.mean).toBeLessThanOrEqual(22);
    expect(s.short).toBeGreaterThanOrEqual(0.12);
    expect(s.cv).toBeGreaterThanOrEqual(0.55);
    expect(html).not.toContain('—');
    const lower = decode(main.replace(/<[^>]+>/g, ' ')).toLowerCase();
    for (const w of BANNED) expect(lower, w).not.toMatch(new RegExp(`\\b${w}\\b`));
    expect(lower).not.toMatch(/whether you're|not just|testimonial|bluesky|sam\.gov|ticketmaster/);
  });

  it('/request/sent follows the same rules', () => {
    const sent = renderToStaticMarkup(createElement(RequestSentPage));
    const m = sent.slice(sent.indexOf('<main'), sent.indexOf('</main>'));
    const s = stats(sentences(prose(m)));
    expect(s.mean).toBeLessThanOrEqual(22);
    expect(s.short).toBeGreaterThanOrEqual(0.12);
    expect(s.cv).toBeGreaterThanOrEqual(0.55);
    expect(sent).not.toContain('—');
  });
});

