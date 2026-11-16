import { generateText } from 'ai';
import { fallbackDraft, violatesDraftRules, BANNED_WORDS, type DraftInput } from './fallback';

export * from './fallback';

export const DRAFT_MODEL = 'anthropic/claude-haiku-5.5';

function gatewayAuthAvailable(): boolean {
  // AI Gateway: API key, or OIDC token on Vercel (assumed from SPEC; the gateway provider reads these itself).
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL);
}

const INSTRUCTIONS = `You write short reply drafts for a local business owner who found a public post where someone asked for a recommendation.
Rules: 2 to 3 sentences. Neighborly, plain, helpful. Mention the business name exactly once. No links, no phone numbers, no emojis, no em dashes. Do not use hype words (${BANNED_WORDS.join(', ')}). Do not invent prices, licenses, reviews or years in business. Answer what the person asked, then offer to help. Output only the reply text.`;

export async function generateDraft(i: DraftInput): Promise<{ draft: string; source: 'ai' | 'fallback' }> {
  if (!gatewayAuthAvailable()) return { draft: fallbackDraft(i), source: 'fallback' };
  try {
    const { text } = await generateText({
      model: DRAFT_MODEL,
      instructions: INSTRUCTIONS,
      prompt: [
        `Business: ${i.businessName}`,
        `What the business does: ${i.categories.join(', ') || 'local services'}`,
        i.city ? `Business area: ${i.city}` : '',
        `Post title: ${i.title}`,
        i.summary ? `Post text: ${i.summary}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      maxOutputTokens: 200,
      abortSignal: AbortSignal.timeout(12_000),
    });
    const draft = text.trim();
    const mentions = draft.split(i.businessName).length - 1;
    if (!draft || violatesDraftRules(draft) || mentions !== 1) {
      return { draft: fallbackDraft(i), source: 'fallback' };
    }
    return { draft, source: 'ai' };
  } catch (e) {
    console.error('[draft] AI failed, using fallback:', e instanceof Error ? e.message : e);
    return { draft: fallbackDraft(i), source: 'fallback' };
  }
}
