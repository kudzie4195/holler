// Integration round 3, item 7: every statement the Terms and Privacy pages make about resident requests and billing matches what the
// code does (lib/requests constants, the purge, checkout, change-plan). Each check names the code fact it rests on.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONFIRM_DAYS, MAX_REPLIES_PER_REQUEST, OPEN_DAYS, PURGE_AFTER_DAYS } from '@/lib/requests/constants';
import { DOWNGRADE_NOTE } from '@/lib/plan/copy';

vi.mock('@/components/doc-page', () => ({
  DocPage: ({ title, children }: { title: string; children: ReactNode }) => createElement('main', null, createElement('h1', null, title), children),
  DocSection: ({ title, children }: { title: string; children: ReactNode }) => createElement('section', null, createElement('h2', null, title), children),
}));

async function text(page: 'terms' | 'privacy') {
  vi.resetModules();
  vi.stubEnv('SUPPORT_EMAIL', 'support@localholler.com');
  const mod = page === 'terms' ? await import('@/app/terms/page') : await import('@/app/privacy/page');
  return renderToStaticMarkup(createElement(mod.default))
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&apos;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}
const src = (p: string) => readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

afterEach(() => vi.unstubAllEnvs());

describe('Terms: resident requests and billing match the build', () => {
  it('two-step confirm and close, 7-day unconfirmed deletion, 140 characters, street addresses filtered, ending takes it off pages', async () => {
    const t = await text('terms');
    expect(t).toContain('Open it and press the button to confirm. Nothing is public before that.');
    expect(t).toContain(`A request you never confirm is deleted after ${CONFIRM_DAYS} days.`);
    expect(t).toContain('up to 140 characters of your description');
    expect(t).toContain('street addresses and names');
    expect(t).toContain('Open the close link in the email we send when it goes live, or in any reply we forward, and press the button.');
    expect(t).toContain(`Up to ${MAX_REPLIES_PER_REQUEST} businesses can reply. A request stays open for ${OPEN_DAYS} days.`);
    expect(t).toContain('it leaves public pages within about 15 minutes');
    // Round 3 P1-1: public pages carry only the trade and the city; the description goes to matching businesses only.
    expect(t).toContain('public Holler pages show only the trade and your city');
    expect(t).toContain('Your description is never on a public page');
    expect(t).toContain('We email a copy of each confirmed request to our support inbox');
    expect(t).toContain('They see your address and what you write, and nothing else.');
    expect(t).toContain('with the business name, its city and its reply');
    expect(t).not.toMatch(/description on public Holler\s+pages/);
    // The public row is built with summary null (lib/requests/signal.ts) and migration 0005 forbids text on it.
    expect(src('lib/requests/signal.ts')).toContain('summary: null,');
    expect(src('supabase/migrations/0005_holler_requests.sql')).toContain("check (source <> 'holler-request' or summary is null)");
    // The 140 comes from the scrubber's own limit.
    expect(src('lib/requests/scrub.ts')).toMatch(/140/);
  });

  it('no tax promise while checkout sets no tax', async () => {
    const checkout = src('app/api/stripe/checkout/route.ts');
    const t = await text('terms');
    if (!/automatic_tax|tax_rates/.test(checkout)) expect(t).not.toMatch(/plus any tax/i);
  });

  it('plan switch: prorated by Stripe, interval kept, downgrade keeps saved extras unused (same as the Settings note)', async () => {
    const t = await text('terms');
    expect(t).toContain('Stripe prorates the change.');
    expect(t).toContain('Your billing period stays monthly or yearly, as it was.');
    expect(t).toContain('stop being used. They stay saved.');
    expect(DOWNGRADE_NOTE).toMatch(/stay saved/);
    // billing-fix P1-1: an upgrade is paid now (or fails and changes nothing); a downgrade is a credit on the next bill.
    expect(t).toContain('Moving up to Pro, you pay that difference right away.');
    expect(t).toContain('the difference becomes a credit on your next bill.');
    expect(src('lib/stripe/plans.ts')).toContain("proration_behavior: 'always_invoice', payment_behavior: 'error_if_incomplete'");
    expect(src('lib/stripe/plans.ts')).toContain("proration_behavior: 'create_prorations'");
    expect(src('app/api/stripe/change-plan/route.ts')).toContain('...prorationFor(upgrade)');
  });
});

describe('Privacy: resident requests match lib/requests', () => {
  it('names what is collected and stored, as the code stores it', async () => {
    const p = await text('privacy');
    expect(p).toContain('the time you agreed to our terms');
    expect(src('lib/requests/service.ts')).toContain('consent_at: now.toISOString()');
    expect(p).toContain('only as one-way hashes');
    expect(p).toContain('The links themselves are in the emails we send you.');
    expect(p).toContain('street addresses and names');
    expect(p).toContain('We do not keep the message.');
    expect(p).toContain("We email a copy of each confirmed request, with your full description, to Holler's support inbox.");
    expect(p).toContain('keeps its own delivery records of every email');
    // Round 3 P1-1: what is public and who sees the description.
    expect(p).toContain('public pages show only the service and your city');
    expect(p).toContain('It never holds your description or your email.');
    expect(p).toContain('Your description is shown only to businesses whose alerts match your request');
    // Round 3 P1-3: no resident text to the AI model (app/api/draft/route.ts refuses source holler-request). Round 7: the AI sorting
    // step (lib/ai/classify.ts toRecord) can see a request's public row, which has no summary (0005 check), so the line now names
    // exactly what never goes: the description and the email.
    expect(p).toContain('We never send your description or your email to an AI model.');
    expect(p).not.toContain('We never send your request to an AI model.');
    expect(src('app/api/draft/route.ts')).toContain('signal.source === HOLLER_REQUEST_SOURCE');
    // What the resident sees of a business, and what a business sees of the resident.
    expect(p).toContain('You see the business name, its city and its reply.');
    expect(p).toContain('If you answer, the business gets your email address and what you write back. Nothing else.');
    expect(p).toContain('the resident sees your business name, your city, your reply and your email address');
  });

  it('retention matches the purge: public record on end, email right away on close, 30 days after expiry, 7 days unconfirmed', async () => {
    const p = await text('privacy');
    expect(p).toContain('delete its public record within about 15 minutes');
    expect(p).toContain('Closing or removal deletes your email address, your full description and the filtered text right away.');
    expect(p).toContain(`we delete them ${PURGE_AFTER_DAYS} days after it ended`);
    expect(p).toContain('After that we keep only the trade, the ZIP code, the city and the dates.');
    expect(p).toContain('we delete the record of which requests you replied to');
    // The code: close and the purge empty the same columns; migration 0005 deletes reply rows with the profile.
    expect(src('lib/requests/service.ts')).toContain('ENDED_WIPE = { email: null, description: null, public_summary: null, lat: null, lon: null }');
    expect(src('supabase/migrations/0005_holler_requests.sql')).toContain('delete from public.holler_request_replies where user_id = old.user_id');
    // "within about 15 minutes" rests on the 15-minute expire of request-bearing cache entries.
    expect(src('lib/signals/request-visibility.ts')).toContain('expire: 900');
    expect(p).toContain(`A request you never confirm is deleted after ${CONFIRM_DAYS} days.`);
    expect(p).not.toMatch(/request text, without the email, is deleted with other records after about 120 days/);
  });

  it('abuse counters are described as keyed hashes (lib/auth/limits.ts rateDigest is an HMAC)', async () => {
    const p = await text('privacy');
    expect(p).toContain('keyed hash');
    expect(src('lib/auth/limits.ts')).toContain("createHmac('sha256', secret)");
  });
});
