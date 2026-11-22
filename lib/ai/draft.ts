import { generateText, type LanguageModel } from 'ai';
import { monthKey, monthlyCapUsd, priceFor, reserve, settle, type Db } from './budget';
import { fallbackDraft, violatesDraftRules, BANNED_WORDS, type DraftInput } from './fallback';
import { failedBeforeResponse } from './errors';
import { hasKey, t, type Lang } from '@/lib/i18n';
import { ES_BANNED_DRAFT_WORDS } from '@/lib/i18n/rules';

export * from './fallback';

/**
 * Reply drafts. Classification runs only from cron; reply drafts run only when a signed-in member with access asks for one
 * (app/api/draft/route.ts checks the session, the match owner and computeAccess), under the same monthly cap as the cron step:
 * each draft reserves its worst case in holler_ai_spend, calls the model once (no retries) and settles as kind 'draft'.
 * - Cap reached, or spend that cannot be read: refused, no model call.
 * - Migration 0014 not applied (no spend table): the draft still runs, bounded only by the per-user hourly limit in the route.
 * - No gateway auth: the fixed template, nothing sent.
 * The model must be in MODEL_PRICES (lib/ai/budget.ts), which holds only Anthropic models: the legal pages name Anthropic.
 */
export const DRAFT_MODEL = 'anthropic/claude-haiku-5.5';
export const DRAFT_MAX_OUTPUT_TOKENS = 200;
export const DRAFT_TIMEOUT_MS = 12_000;

function gatewayAuthAvailable(env: Record<string, string | undefined>): boolean {
  // AI Gateway: API key, or OIDC token on Vercel (assumed from SPEC; the gateway provider reads these itself).
  return Boolean(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN || env.VERCEL);
}

const INSTRUCTIONS = `You write short reply drafts for a local business owner who found a public post where someone asked for a recommendation.
Rules: 2 to 3 sentences. Neighborly, plain, helpful. Mention the business name exactly once. No links, no phone numbers, no emojis, no em dashes. Do not use hype words (${BANNED_WORDS.join(', ')}). Do not invent prices, licenses, reviews or years in business. Answer what the person asked, then offer to help. Output only the reply text.`;

/** The model instructions in the member's language. English is the literal above (unchanged); Spanish comes from the dictionary. */
export function instructionsFor(lang: Lang): string {
  return lang === 'es' ? t(lang, 'draft.instructions', { banned: ES_BANNED_DRAFT_WORDS.join(', ') }) : INSTRUCTIONS;
}

/** The prompt (the facts about the business and the post) with labels in the member's language. English is unchanged. */
export function promptFor(i: DraftInput, lang: Lang): string {
  if (lang === 'es') {
    const trades = i.categories.map((c) => (hasKey(`trade.${c}`) ? t(lang, `trade.${c}` as 'trade.roofing') : c.replace(/-/g, ' '))).join(', ');
    return [
      t(lang, 'draft.p.business', { value: i.businessName }),
      t(lang, 'draft.p.does', { value: trades || t(lang, 'draft.p.local_services') }),
      i.city ? t(lang, 'draft.p.area', { value: i.city }) : '',
      t(lang, 'draft.p.title', { value: i.title }),
      i.summary ? t(lang, 'draft.p.text', { value: i.summary }) : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
  return [
    `Business: ${i.businessName}`,
    `What the business does: ${i.categories.join(', ') || 'local services'}`,
    i.city ? `Business area: ${i.city}` : '',
    `Post title: ${i.title}`,
    i.summary ? `Post text: ${i.summary}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export type DraftOutcome =
  | { ok: true; draft: string; source: 'ai' | 'fallback' }
  /** cap_reached: the month's AI budget is used up. spend_unavailable: the spend books could not be written or read. */
  | { ok: false; reason: 'cap_reached' | 'spend_unavailable' };

export interface DraftDeps {
  /** Service-role client: holler_ai_spend is service role only. */
  db: Db;
  now?: Date;
  env?: Record<string, string | undefined>;
  /** Tests pass a mock. Defaults to DRAFT_MODEL on the AI Gateway. */
  model?: LanguageModel;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

function gatewayCost(providerMetadata: unknown): number | null {
  const g = (providerMetadata as { gateway?: { cost?: unknown } } | undefined)?.gateway?.cost;
  return num(typeof g === 'string' ? Number(g) : g);
}

export async function generateDraft(i: DraftInput, deps: DraftDeps): Promise<DraftOutcome> {
  const env = deps.env ?? process.env;
  const price = priceFor(DRAFT_MODEL);
  if ((!deps.model && !gatewayAuthAvailable(env)) || !price) return { ok: true, draft: fallbackDraft(i), source: 'fallback' };
  const lang: Lang = i.lang === 'es' ? 'es' : 'en';
  const instructions = instructionsFor(lang);
  const prompt = promptFor(i, lang);

  const res = await reserve(deps.db, {
    month: monthKey(deps.now ?? new Date()),
    capUsd: monthlyCapUsd(env),
    signals: 0,
    inputChars: instructions.length + prompt.length,
    maxOutputTokens: DRAFT_MAX_OUTPUT_TOKENS,
    price,
    cacheMisses: 0,
  });
  let id: number | string | null = null;
  let estimateUsd = 0;
  if (res.ok) {
    id = res.id;
    estimateUsd = res.estimateUsd;
  } else if (res.reason === 'cap_reached') {
    return { ok: false, reason: 'cap_reached' };
  } else if (!res.missing) {
    return { ok: false, reason: 'spend_unavailable' };
  }
  // else: 0014 is not applied. Fail soft: the route's per-user hourly limit is the only bound.

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('timeout')), DRAFT_TIMEOUT_MS);
  try {
    const r = await generateText({
      model: deps.model ?? DRAFT_MODEL,
      instructions,
      prompt,
      maxOutputTokens: DRAFT_MAX_OUTPUT_TOKENS,
      maxRetries: 0,
      abortSignal: ac.signal,
    });
    if (id !== null) {
      await settle(deps.db, id, {
        kind: 'draft',
        inputTokens: num(r.totalUsage?.inputTokens),
        outputTokens: num(r.totalUsage?.outputTokens),
        gatewayCostUsd: gatewayCost(r.providerMetadata),
        price,
        estimateUsd,
      });
    }
    const draft = r.text.trim();
    const mentions = draft.split(i.businessName).length - 1;
    if (!draft || violatesDraftRules(draft, lang) || mentions !== 1) {
      return { ok: true, draft: fallbackDraft(i), source: 'fallback' };
    }
    return { ok: true, draft, source: 'ai' };
  } catch (e) {
    console.error('[draft] AI failed, using fallback:', e instanceof Error ? e.message : e);
    // Only an error status or a connection error failed before any response (nothing billed, settled at 0). A timeout, or any other
    // error (it may come after the provider answered, such as an invalid body), keeps the reserved worst case (verify-v1 decision 5).
    if (id !== null) await settle(deps.db, id, !ac.signal.aborted && failedBeforeResponse(e) ? { kind: 'no_response' } : { kind: 'unknown' });
    return { ok: true, draft: fallbackDraft(i), source: 'fallback' };
  } finally {
    clearTimeout(timer);
  }
}
