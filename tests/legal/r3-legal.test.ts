// Review r3 (gates/r7/review-r3.md): the legal findings. Each sentence is pinned next to the code fact that makes it true.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderLegal, src } from './render-helper';
import { MODEL_PRICES } from '@/lib/ai/budget';
import { classifyModelId, runClassify, SKIP_SOURCES } from '@/lib/ai/classify';
import { DRAFT_MODEL } from '@/lib/ai/draft';
import { HOLLER_REQUEST_SOURCE } from '@/lib/signals/request-visibility';

vi.mock('@/components/doc-page', async () => (await import('./render-helper')).docPageMock());
afterEach(() => vi.unstubAllEnvs());

const MIG = (n: string) => src(`supabase/migrations/${n}`);

describe('r3 P0: account deletion and visit counts', () => {
  it('the code: browser counts carry no account number; only account steps are deleted with the account; a weekly 400-day prune', () => {
    // Browser events are built with a session id only (no userId), so user_id is null on them.
    const ingest = src('lib/analytics/ingest.ts');
    const call = ingest.slice(ingest.indexOf('buildEventRow(name as BrowserEvent'), ingest.indexOf('if (!row) return'));
    expect(call).toContain('sessionId: sid.sid');
    expect(call).not.toMatch(/userId|user_id/);
    expect(MIG('0017_holler_analytics.sql')).toContain('delete from public.holler_events where user_id = old.user_id');
    expect(MIG('0017_holler_analytics.sql')).toContain('delete from public.holler_attribution where user_id = old.user_id');
    // Weekly (Sundays) prune of rows older than 400 days: 400 to 407 days, about 13 months.
    expect(src('supabase/cron.sql')).toContain("select cron.schedule('holler-events-prune', '29 4 * * 0', $job$ select public.holler_events_prune(400); $job$);");
    expect(407 / (365.25 / 12)).toBeLessThan(13.5);
  });

  it('privacy never says visit counts go with the account, and says what does', async () => {
    const { text } = await renderLegal('privacy');
    expect(text).not.toMatch(/visit and step counts/i);
    expect(text).not.toContain('removed with your account.');
    expect(text).toContain('Only the four account steps also hold your account number.');
    expect(text).toContain('Visit and area check counts: about 13 months. They hold no account number, so deleting your account does not remove them.');
    expect(text).toContain('Account steps: about 13 months, and deleted with your account.');
    expect(text).toContain('Your source tag: until you delete your account.');
    expect(text).toContain(
      'It also deletes your feature picks, your feedback and answers, your alert log, your account steps, your source tag, your trial email record and your push tokens.',
    );
    expect(text).toContain('Visit counts stay until they age out, about 13 months after the visit.');
    expect(text).not.toMatch(/400 days/);
  });

  it('/delete-account says the same', async () => {
    const { text } = await renderLegal('delete-account');
    expect(text).not.toMatch(/visit and step counts/i);
    expect(text).toContain('We also delete your account steps (signup, trial start, first alert and first payment), your source tag');
    expect(text).toContain('Visit counts. They hold only a random ID from your browser, never your account number.');
    expect(text).toContain('They are deleted about 13 months after the visit.');
  });
});

describe('r3 P1: the short version is true about the AI', () => {
  it('sorting never sees the account; drafts send the business name, trades and city', async () => {
    const { text } = await renderLegal('privacy');
    expect(text).not.toContain('It never sees your account.');
    expect(text).toContain('An AI model sorts public records by trade. That sorting step never sees your account.');
    expect(text).toContain('Reply drafts, which you ask for, send your business name, trades and city.');
    const d = src('lib/ai/draft.ts');
    for (const k of ['Business: ${i.businessName}', "What the business does: ${i.categories.join(', ')", 'Business area: ${i.city}']) expect(d).toContain(k);
  });
});

describe('r3 P2: smaller legal gaps', () => {
  it('(a) outside search and event sources, with no member data', async () => {
    const { text } = await renderLegal('privacy');
    expect(text).toContain(
      'When their keys are set, we also use Brave Search, Serper, Bluesky and Ticketmaster to find public posts and events, and IndexNow to tell search engines about new pages, and we send none of them any member data.',
    );
    const ws = src('lib/signals/adapters/websearch.ts');
    expect(ws).toContain('api.search.brave.com');
    expect(ws).toContain('google.serper.dev');
    expect(src('lib/signals/adapters/bluesky.ts')).toMatch(/bsky/);
    expect(src('lib/signals/adapters/ticketmaster.ts')).toContain('https://app.ticketmaster.com/discovery/v2/events.json');
    expect(src('lib/seo/indexnow.ts')).toContain("'https://api.indexnow.org/indexnow'");
  });

  it('(b) the small notes the app keeps on the phone, besides the session', async () => {
    const { text } = await renderLegal('privacy');
    expect(text).toContain(
      "For each account that signs in, the app also keeps three small notes there, labeled with the account number: the phone's push token, whether it already asked about notifications, and whether you turned pushes on.",
    );
    expect(text).toContain('Signing out removes the token. Turning pushes off removes the token and the pushes note. The note about asking stays until you remove the app.');
    const push = src('mobile/src/push/push.ts');
    // The three per-account keys, and nothing else written with deps.store.set.
    expect(push).toContain('export const tokenKeyFor = (userId: string) => `holler-push-token:${userId}`;');
    expect(push).toContain('export const promptSeenKeyFor = (userId: string) => `holler-push-prompt-seen:${userId}`;');
    expect(push).toContain('export const consentKeyFor = (userId: string) => `holler-push-consent:${userId}`;');
    const sets = [...push.matchAll(/deps\.store\.set\((\w+)/g)].map((m) => m[1]).sort();
    expect([...new Set(sets)]).toEqual(['consentKeyFor', 'promptSeenKeyFor', 'tokenKeyFor']);
    // Sign-out (unregister) removes the token keys; disable removes the token and the consent; nothing removes the prompt note.
    const unreg = push.slice(push.indexOf('async unregister()'), push.indexOf('async disable()'));
    expect(unreg).toContain('tokenKeyFor(userId)');
    expect(unreg).toContain('await deps.store.remove(key)');
    const disable = push.slice(push.indexOf('async disable()'), push.indexOf('async isRegistered()'));
    expect(disable).toContain('remove(tokenKeyFor(owner))');
    expect(disable).toContain('remove(consentKeyFor(owner))');
    expect(push).not.toMatch(/remove\(promptSeenKeyFor/);
  });

  it('(c) the model is from Anthropic, and only Anthropic models can run', async () => {
    const priv = (await renderLegal('privacy')).text;
    const terms = (await renderLegal('terms')).text;
    expect(priv).toContain("We use an AI model from Anthropic, through Vercel's AI Gateway, to sort new public records by trade");
    expect(priv).not.toMatch(/Claude/);
    expect(terms).not.toMatch(/Claude/);
    expect(terms).toContain('An AI model from Anthropic sorts records, writes alert notes and drafts replies.');
    // Every model that can run has a price, every priced model is Anthropic's, and so is the id this environment would use.
    // Setting AI_CLASSIFY_MODEL to a non-Anthropic id here fails this test; set only in production it has no price and never runs.
    expect(Object.keys(MODEL_PRICES).length).toBeGreaterThan(0);
    for (const id of Object.keys(MODEL_PRICES)) expect(id.startsWith('anthropic/'), id).toBe(true);
    expect(DRAFT_MODEL.startsWith('anthropic/')).toBe(true);
    expect(classifyModelId(process.env).startsWith('anthropic/')).toBe(true);
    const s = await runClassify({ db: {} as never, deadline: Date.now() + 1000, env: { AI_CLASSIFY_MODEL: 'openai/gpt-5' }, rematch: async () => ({ created: 0 }) });
    expect(s.reason).toBe('unknown_model_price');
  });

  it('(d) the resident request sentence: requests are skipped entirely', async () => {
    const { text } = await renderLegal('privacy');
    expect(text).not.toContain('For a resident request, nothing goes in beyond its public line');
    expect(text).toContain('Resident requests are not sent either. Nothing from a request reaches the model.');
    expect(SKIP_SOURCES.has(HOLLER_REQUEST_SOURCE)).toBe(true);
  });

  it('(e) drafts: what is sent when the call fails, the access rule and the budget', async () => {
    const { text } = await renderLegal('privacy');
    expect(text).not.toContain('If the AI is not available, we fill in a fixed template and send nothing');
    expect(text).toContain('When the AI is switched off, you get a fixed template and nothing is sent.');
    expect(text).toContain('If the AI call fails or its draft breaks our rules, you get the same template, but the details above may already have been sent.');
    expect(text).toContain('Drafts are not offered for resident requests, and they need an active trial or plan.');
    expect(text).toContain('Drafts count toward a monthly AI budget. When it runs out, drafts pause until the next month.');
    const route = src('app/api/draft/route.ts');
    expect(route).toContain('computeAccess(profile).locked');
    expect(route).toContain("error: 'ai_paused'");
  });

  it('(f) no claim about counting the app opening', async () => {
    const { text } = await renderLegal('privacy');
    expect(text).not.toMatch(/app opening/);
    expect(text).toContain('We count one visit a day for each browser. We also count an area check.');
  });
});
