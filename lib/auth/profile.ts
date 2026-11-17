import 'server-only';
import { z } from 'zod';
import { lookupZip } from '@/lib/geo';
import { CATEGORIES } from '@/lib/signals/categories';
import { tradeComingSoon } from '@/lib/seo/signal-types';
import { createClient } from '@/lib/supabase/server';
import {
  cleanKeyword,
  effectiveTier,
  keywordProblem,
  KEYWORD_MAX_LENGTH,
  KEYWORD_MIN_LENGTH,
  MAX_EXTRA_AREAS,
  MAX_KEYWORDS,
  MAX_TRADES,
  PLAN_LIMITS,
  storableExtraAreas,
  type ExtraArea,
} from '@/lib/plan';
import type { ProfileFormState } from './profile-types';

const FIX = 'Fix the highlighted fields and try again.';

const schema = z.object({
  business_name: z
    .string()
    .trim()
    .min(2, 'Enter your business name.')
    .max(80, 'Keep the name under 80 characters.'),
  categories: z
    .array(z.string())
    .min(1, 'Pick at least one thing you do.')
    .max(MAX_TRADES, `Pick up to ${MAX_TRADES}.`),
  zip: z.string().trim().regex(/^\d{5}$/, 'Enter a 5-digit ZIP code.'),
  radius: z.coerce.number().int().min(5, 'Minimum is 5 miles.').max(100, 'Maximum is 100 miles.'),
});

interface Saved {
  plan?: string | null;
  subscription_status?: string | null;
  categories?: string[] | null;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;

/** Extra ZIPs from the form: blanks dropped, duplicates and the main ZIP removed. Each is checked and geocoded like the main ZIP. */
function readExtraZips(formData: FormData, mainZip: string): { areas: ExtraArea[]; error?: string } {
  const raw = formData
    .getAll('extra_zip')
    .map((v) => String(v).trim())
    .filter(Boolean);
  const zips = [...new Set(raw)].filter((z) => z !== mainZip);
  if (zips.length > MAX_EXTRA_AREAS) return { areas: [], error: `Add up to ${MAX_EXTRA_AREAS} more ZIP codes.` };
  const areas: ExtraArea[] = [];
  for (const z of zips) {
    if (!/^\d{5}$/.test(z)) return { areas: [], error: `${z.slice(0, 12)} is not a 5-digit ZIP code.` };
    const place = lookupZip(z);
    if (!place) return { areas: [], error: `We couldn't find ZIP ${z}. Check it and try again.` };
    areas.push({ zip: place.zip, city: place.city, state: place.state, lat: place.lat, lon: place.lon });
  }
  // Same shape rules as the database (migration 0004): exact keys, 5-digit zip, city up to 80 characters, 2-letter state, lat/lon in range.
  if (!storableExtraAreas(areas, MAX_EXTRA_AREAS)) return { areas: [], error: "We couldn't use one of those ZIP codes. Check them and try again." };
  return { areas };
}

function readKeywords(formData: FormData): { keywords: string[]; error?: string } {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of formData.getAll('keyword')) {
    const k = cleanKeyword(String(v));
    if (!k) continue;
    const problem = keywordProblem(k);
    if (problem === 'length') return { keywords: [], error: `Each keyword needs ${KEYWORD_MIN_LENGTH} to ${KEYWORD_MAX_LENGTH} characters.` };
    if (problem === 'chars') return { keywords: [], error: 'Use letters, numbers and spaces. You can also use these: \' & - /' };
    if (seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
  }
  if (out.length > MAX_KEYWORDS) return { keywords: [], error: `Watch up to ${MAX_KEYWORDS} keywords.` };
  return { keywords: out };
}

/**
 * Validates the shared onboarding/settings fields, geocodes the ZIPs and writes holler_profiles
 * through the user's own RLS-scoped client.
 * Plan limits (lib/plan/limits.ts) are enforced here with field errors, and again by the database (migration 0004):
 *  - Starter and the free trial: 1 area, up to 5 trades, no keyword watches. Pro: 2 extra ZIPs, up to 15 trades, 5 keywords.
 *  - Saved settings beyond the plan (after a downgrade) are kept: extra areas and keywords are only written on Pro, and an
 *    unchanged set of trades is written back exactly as saved, even when it is longer than the plan allows.
 * Pass `alertEmail` to also set the email toggle (settings only).
 */
export async function saveProfile(
  userId: string,
  formData: FormData,
  opts: { alertEmail?: boolean } = {},
): Promise<ProfileFormState> {
  const parsed = schema.safeParse({
    business_name: formData.get('business_name') ?? '',
    categories: formData.getAll('categories').map(String),
    zip: formData.get('zip') ?? '',
    radius: formData.get('radius') ?? 25,
  });
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error).fieldErrors;
    return {
      error: FIX,
      fieldErrors: {
        business_name: flat.business_name?.[0],
        categories: flat.categories?.[0],
        zip: flat.zip?.[0],
        radius: flat.radius?.[0],
      },
    };
  }

  const supabase = await createClient();
  // The current row decides which plan's limits apply. '*' so a database without migration 0004 still saves (Starter limits).
  const { data: savedRow, error: readErr } = await supabase.from('holler_profiles').select('*').eq('user_id', userId).maybeSingle();
  if (readErr) return { error: 'We could not save that. Try again in a moment.' };
  const saved = (savedRow ?? null) as Saved | null;
  const tier = effectiveTier(saved ? { plan: saved.plan ?? null, subscription_status: saved.subscription_status ?? null } : null);
  const limits = PLAN_LIMITS[tier];

  const valid = new Set<string>(CATEGORIES.map((c) => c.id));
  // Trades with no live data source in this configuration ("coming soon") are dropped from a submission, never saved.
  let categories = [...new Set(parsed.data.categories)].filter((c) => valid.has(c) && !tradeComingSoon(c));
  if (categories.length === 0) {
    return { error: FIX, fieldErrors: { categories: 'Pick at least one thing you do.' } };
  }
  const savedCats = Array.isArray(saved?.categories) ? saved.categories : [];
  if (savedCats.length && sameSet(categories, savedCats)) {
    categories = savedCats; // unchanged: keep the saved order (matching uses the first N) and never trip the plan check
  } else if (categories.length > limits.trades) {
    return {
      error: FIX,
      fieldErrors: {
        categories:
          tier === 'pro'
            ? `Pick up to ${limits.trades}.`
            : `Your plan covers up to ${limits.trades} trades. Pick ${limits.trades} or fewer, or move to Pro for up to ${PLAN_LIMITS.pro.trades}.`,
      },
    };
  }

  const place = lookupZip(parsed.data.zip);
  if (!place) {
    return { error: FIX, fieldErrors: { zip: "We couldn't find that ZIP code. Check it and try again." } };
  }

  const extra = readExtraZips(formData, place.zip);
  const kw = readKeywords(formData);
  const fieldErrors: ProfileFormState['fieldErrors'] = {};
  if (extra.error) fieldErrors.extra_zips = extra.error;
  else if (extra.areas.length > limits.extraAreas) {
    fieldErrors.extra_zips = tier === 'pro' ? `Add up to ${limits.extraAreas} more ZIP codes.` : 'More ZIP codes are part of Pro.';
  }
  if (kw.error) fieldErrors.keywords = kw.error;
  else if (kw.keywords.length > limits.keywords) {
    fieldErrors.keywords = tier === 'pro' ? `Watch up to ${limits.keywords} keywords.` : 'Keyword watches are part of Pro.';
  }
  if (fieldErrors.extra_zips || fieldErrors.keywords) return { error: FIX, fieldErrors };

  // Only columns granted to the `authenticated` role (see 0001_holler.sql, 0004_holler_plans.sql). updated_at is set by trigger.
  const row: Record<string, unknown> = {
    user_id: userId,
    business_name: parsed.data.business_name,
    categories,
    zip: place.zip,
    city: place.city,
    state: place.state,
    lat: place.lat,
    lon: place.lon,
    radius_mi: parsed.data.radius,
  };
  if (tier === 'pro') {
    // Pro owns these fields on the form, so an empty list clears them. On Starter they are left out: saved extras stay saved.
    row.extra_areas = extra.areas;
    row.keywords = kw.keywords;
  }
  if (typeof opts.alertEmail === 'boolean') row.alert_email = opts.alertEmail;

  const { error } = await supabase.from('holler_profiles').upsert(row, { onConflict: 'user_id' });
  if (error) {
    if (/holler_plan_limit/.test(error.message ?? '')) {
      return { error: 'That is more than your plan allows. Refresh the page and try again.' };
    }
    return { error: 'We could not save that. Try again in a moment.' };
  }
  return { ok: true, message: 'Saved.' };
}
