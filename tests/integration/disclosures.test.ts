// Integration round 3, item 5: consent and disclosure wording from legal.md, each kept to one sentence.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { planChangeNote, priceLabel, renewalNote } from '@/lib/stripe/plans';
import { BillingButton, PlanChangeButton } from '@/components/billing-button';
import { Footer } from '@/components/footer';
import { RequestForm } from '@/components/request-form';

const root = path.resolve(__dirname, '../..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const oneSentence = (s: string) => s.split(/(?<=[.!?])\s+(?=[A-Z])/).length === 1;
const plainText = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, ' ').trim();

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(f) ? [p] : [];
  });
}

afterEach(() => vi.unstubAllEnvs());

describe('(a) auto-renewal sentence next to every subscribe and change-plan button', () => {
  it('amounts come from the price table; one sentence; trial and no-trial forms', () => {
    expect(renewalNote('starter', 'monthly', { inTrial: true })).toBe(
      `${priceLabel('starter', 'monthly')} per month after your free trial ends, and it renews automatically until you cancel in Settings.`,
    );
    expect(renewalNote('starter', 'annual', { inTrial: true })).toContain('$48 per year after your free trial ends');
    expect(renewalNote('pro', 'monthly', { inTrial: true })).toContain('$9.99 per month after your free trial ends');
    expect(renewalNote('pro', 'annual', { inTrial: false })).toBe('$96 per year starting today, and it renews automatically until you cancel in Settings.');
    expect(planChangeNote('pro')).toBe('Pro is $9.99 per month or $96 per year on your current billing period, and it renews automatically until you cancel in Settings.');
    for (const s of [renewalNote('pro', 'annual', { inTrial: true }), planChangeNote('starter')]) expect(oneSentence(s)).toBe(true);
  });

  it('the buttons render the note under them', () => {
    const b = renderToStaticMarkup(createElement(BillingButton, { endpoint: '/api/stripe/checkout', tier: 'pro', plan: 'annual', note: renewalNote('pro', 'annual', { inTrial: true }), children: 'Go' })); // eslint-disable-line react/no-children-prop
    expect(plainText(b)).toContain('$96 per year after your free trial ends, and it renews automatically until you cancel in Settings.');
    const c = renderToStaticMarkup(createElement(PlanChangeButton, { tier: 'pro', note: planChangeNote('pro'), children: 'Move to Pro' })); // eslint-disable-line react/no-children-prop
    expect(plainText(c)).toContain(planChangeNote('pro'));
  });

  it('every checkout and plan-change button in app/ and components/ passes a note built from the helpers', () => {
    const files = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'components'))];
    let checkout = 0;
    let change = 0;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/<BillingButton[\s\S]*?>/g)) {
        if (!m[0].includes('/api/stripe/checkout')) continue;
        checkout++;
        expect(m[0], f).toMatch(/note=\{renewalNote\(/);
      }
      for (const m of src.matchAll(/<PlanChangeButton[\s\S]*?>/g)) {
        change++;
        expect(m[0], f).toMatch(/note=\{planChangeNote\(/);
      }
    }
    expect(checkout).toBeGreaterThanOrEqual(3);
    expect(change).toBe(2);
  });

  it('the plan cards have no subscribe button (they link to sign-up, no card), so they need no renewal sentence', () => {
    expect(read('components/pricing.tsx')).not.toMatch(/BillingButton|api\/stripe\/checkout/);
  });
});

describe('(b) /request consent checkbox label', () => {
  it('is one sentence with age, Terms and Privacy links, what is public (service and city only), no vetting, not for emergencies', () => {
    const html = renderToStaticMarkup(createElement(RequestForm, { groups: [] }));
    const label = html.match(/<label[^>]*>(?:(?!<\/label>)[\s\S])*name="consent"[\s\S]*?<\/label>/)?.[0] ?? '';
    const t = plainText(label);
    expect(t).toContain('I am 18 or older and agree to the Terms and Privacy Policy');
    // Round 3 P1-1: the description is never public, so the label says public pages show only the service and the city.
    expect(t).toContain('Holler may send my request to local businesses and show only the service and my city on public pages');
    expect(t).not.toContain('without my email on public pages');
    expect(t).toContain('does not check or vouch for any business and this is not for emergencies');
    expect(oneSentence(t)).toBe(true);
    expect(label).toContain('href="/terms"');
    expect(label).toContain('href="/privacy"');
  });
});

describe('(c) footer line', () => {
  it('says the data can be late or wrong and Holler is not affiliated with any agency', () => {
    const t = plainText(renderToStaticMarkup(createElement(Footer)));
    expect(t).toContain('Data comes from public government records and can be late or wrong, and Holler is not affiliated with or endorsed by any government agency.');
  });
});

describe('(d) public-records note on city, weekly and trade pages', () => {
  it('renders one sentence with the Terms link, and the support address when set', async () => {
    vi.stubEnv('SUPPORT_EMAIL', 'support@localholler.com');
    vi.resetModules();
    const withSupport = (await import('@/app/local/_components/ui')).PublicRecordsNote;
    const a = renderToStaticMarkup(createElement(withSupport));
    expect(a).toContain('href="/terms"');
    expect(a).toContain('mailto:support@localholler.com');
    expect(oneSentence(plainText(a))).toBe(true);
    expect(plainText(a)).toContain('not affiliated with any agency');
    vi.stubEnv('SUPPORT_EMAIL', '');
    vi.resetModules();
    const without = (await import('@/app/local/_components/ui')).PublicRecordsNote;
    const b = renderToStaticMarkup(createElement(without));
    expect(b).not.toContain('mailto:');
    expect(b).toContain('href="/terms"');
  });
  it('is placed on the city, weekly and trade pages', () => {
    for (const p of ['app/local/[state]/[city]/page.tsx', 'app/local/[state]/[city]/week/[week]/page.tsx', 'app/for/[trade]/page.tsx']) {
      expect(read(p), p).toContain('<PublicRecordsNote />');
    }
  });
});
