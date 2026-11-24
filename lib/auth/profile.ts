import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { lookupZip } from '@/lib/geo';
import { CATEGORIES } from '@/lib/signals/categories';
import { tradeComingSoon } from '@/lib/seo/signal-types';
import { tradeNoLiveSource } from '@/lib/signals/lead-rules';
import { tradeSignupClosed } from '@/lib/check/cells';
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
import { t, type Lang } from '@/lib/i18n';
import { planNameEs } from '@/lib/plan/price-copy-es';

const FIX = 'Fix the highlighted fields and try again.';

/**
 * A message of the save in the form's words (round 18 ES). `lang` 'en' (the default) gives the English literal the code always used, so
 * English answers are unchanged; Spanish comes from the dictionary (pf.err.* keys) with the same numbers.
 */
function msg(lang: Lang, key: Parameters<typeof t>[1], en: string, vars?: Record<string, string | number>): string {
  return lang === 'en' ? en : t(lang, key, { pro: planNameEs('pro'), ...vars });
}

/** The field rules with their messages in Spanish (or English: `schema` itself). */
function schemaFor(lang: Lang) {
  if (lang === 'en') return schema;
  return z.object({
    business_name: z.string().trim().min(2, t(lang, 'pf.err.name')).max(80, t(lang, 'pf.err.name_long')),
    categories: z.array(z.string()).min(1, t(lang, 'pf.err.pick_one')).max(MAX_TRADES, t(lang, 'pf.err.pick_up_to', { n: MAX_TRADES })),
    zip: z.string().trim().regex(/^\d{5}$/, t(lang, 'pf.err.zip')),
    radius: z.coerce.number().int().min(5, t(lang, 'pf.err.radius_min')).max(100, t(lang, 'pf.err.radius_max')),
  });
}

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
  /** Migration 0020 (absent before it): a lapsed store plan keeps Solo limits. */
  plan_source?: string | null;
  store_expires_at?: string | null;
  categories?: string[] | null;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;

/** Extra ZIPs from the form: blanks dropped, duplicates and the main ZIP removed. Each is checked and geocoded like the main ZIP. */
function readExtraZips(formData: FormData, mainZip: string, lang: Lang = 'en'): { areas: ExtraArea[]; error?: string } {
  const raw = formData
    .getAll('extra_zip')
    .map((v) => String(v).trim())
    .filter(Boolean);
  const zips = [...new Set(raw)].filter((z) => z !== mainZip);
  if (zips.length > MAX_EXTRA_AREAS) return { areas: [], error: msg(lang, 'pf.err.extra_up_to', `Add up to ${MAX_EXTRA_AREAS} more ZIP codes.`, { n: MAX_EXTRA_AREAS }) };
  const areas: ExtraArea[] = [];
  for (const z of zips) {
    if (!/^\d{5}$/.test(z)) return { areas: [], error: msg(lang, 'pf.err.extra_bad', `${z.slice(0, 12)} is not a 5-digit ZIP code.`, { zip: z.slice(0, 12) }) };
    const place = lookupZip(z);
    if (!place) return { areas: [], error: msg(lang, 'pf.err.extra_unknown', `We couldn't find ZIP ${z}. Check it and try again.`, { zip: z }) };
    areas.push({ zip: place.zip, city: place.city, state: place.state, lat: place.lat, lon: place.lon });
  }
  // Same shape rules as the database (migration 0004): exact keys, 5-digit zip, city up to 80 characters, 2-letter state, lat/lon in range.
  if (!storableExtraAreas(areas, MAX_EXTRA_AREAS)) return { areas: [], error: msg(lang, 'pf.err.extra_unusable', "We couldn't use one of those ZIP codes. Check them and try again.") };
  return { areas };
}

function readKeywords(formData: FormData, lang: Lang = 'en'): { keywords: string[]; error?: string } {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of formData.getAll('keyword')) {
    const k = cleanKeyword(String(v));
    if (!k) continue;
    const problem = keywordProblem(k);
    if (problem === 'length') return { keywords: [], error: msg(lang, 'pf.err.kw_length', `Each keyword needs ${KEYWORD_MIN_LENGTH} to ${KEYWORD_MAX_LENGTH} characters.`, { min: KEYWORD_MIN_LENGTH, max: KEYWORD_MAX_LENGTH }) };
    if (problem === 'chars') return { keywords: [], error: msg(lang, 'pf.err.kw_chars', 'Use letters, numbers and spaces. You can also use these: \' & - /') };
    if (seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
  }
  if (out.length > MAX_KEYWORDS) return { keywords: [], error: msg(lang, 'pf.err.kw_up_to', `Watch up to ${MAX_KEYWORDS} keywords.`, { n: MAX_KEYWORDS }) };
  return { keywords: out };
}

/** The mobile API (lib/mobile/profile.ts) checks this before passing `db`. */
export const SAVE_PROFILE_ACCEPTS_DB = true;

/**
 * Validates the shared onboarding/settings fields, geocodes the ZIPs and writes holler_profiles
 * through the user's own RLS-scoped client.
 * Plan limits (lib/plan/limits.ts) are enforced here with field errors, and again by the database (migration 0004):
 *  - Solo (`starter`) and the free trial: 1 area, up to 5 trades, no keyword watches. Pro: 2 extra ZIPs, up to 15 trades, 5 keywords.
 *  - Saved settings beyond the plan (after a downgrade) are kept: extra areas and keywords are only written on Pro, and an
 *    unchanged set of trades is written back exactly as saved, even when it is longer than the plan allows.
 * Pass `alertEmail` to also set the email toggle (settings only).
 * Pass `db` to read and write with that client instead of the cookie client: the mobile API passes the member's own RLS client built
 * from their bearer token, so RLS and the column grants apply exactly as on the web.
 */
export async function saveProfile(
  userId: string,
  formData: FormData,
  opts: { alertEmail?: boolean; db?: Pick<SupabaseClient, 'from'>; lang?: Lang } = {},
): Promise<ProfileFormState> {
  // The words of the answers only (round 18 ES): what is checked and saved is the same for every member.
  const lang: Lang = opts.lang ?? 'en';
  const fix = msg(lang, 'pf.err.fix', FIX);
  const parsed = schemaFor(lang).safeParse({
    business_name: formData.get('business_name') ?? '',
    categories: formData.getAll('categories').map(String),
    zip: formData.get('zip') ?? '',
    radius: formData.get('radius') ?? 25,
  });
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error).fieldErrors;
    return {
      error: fix,
      fieldErrors: {
        business_name: flat.business_name?.[0],
        categories: flat.categories?.[0],
        zip: flat.zip?.[0],
        radius: flat.radius?.[0],
      },
    };
  }

  const supabase = opts.db ?? (await createClient());
  // The current row decides which plan's limits apply. '*' so a database without migration 0004 still saves (Solo limits).
  const { data: savedRow, error: readErr } = await supabase.from('holler_profiles').select('*').eq('user_id', userId).maybeSingle();
  if (readErr) return { error: msg(lang, 'pf.err.save', 'We could not save that. Try again in a moment.') };
  const saved = (savedRow ?? null) as Saved | null;
  const tier = effectiveTier(
    saved
      ? {
          plan: saved.plan ?? null,
          subscription_status: saved.subscription_status ?? null,
          plan_source: saved.plan_source ?? null,
          store_expires_at: saved.store_expires_at ?? null,
        }
      : null,
  );
  const limits = PLAN_LIMITS[tier];

  const valid = new Set<string>(CATEGORIES.map((c) => c.id));
  // Trades with no live data source in this configuration ("coming soon", or no source yet: locksmith, business-services) are dropped from a submission, never saved.
  // Round 24 (decision d): so is a trade sign-up no longer takes (lib/check/cells.ts tradeSignupClosed: live in no measured centre and no
  // storm cells), UNLESS this member already has it saved: an existing member keeps it, and nothing changes for them. A new profile
  // (sign-up, onboarding, the mobile onboarding route) has nothing saved, so it can never submit one.
  const savedCats = Array.isArray(saved?.categories) ? saved.categories : [];
  let categories = [...new Set(parsed.data.categories)].filter(
    (c) => valid.has(c) && !tradeComingSoon(c) && !tradeNoLiveSource(c) && (!tradeSignupClosed(c) || savedCats.includes(c)),
  );
  if (categories.length === 0) {
    return { error: fix, fieldErrors: { categories: msg(lang, 'pf.err.pick_one', 'Pick at least one thing you do.') } };
  }
  if (savedCats.length && sameSet(categories, savedCats)) {
    categories = savedCats; // unchanged: keep the saved order (matching uses the first N) and never trip the plan check
  } else if (categories.length > limits.trades) {
    return {
      error: fix,
      fieldErrors: {
        categories:
          tier === 'pro'
            ? msg(lang, 'pf.err.pick_up_to', `Pick up to ${limits.trades}.`, { n: limits.trades })
            : msg(lang, 'pf.err.plan_trades', `Your plan covers up to ${limits.trades} trades. Pick ${limits.trades} or fewer, or move to Pro for up to ${PLAN_LIMITS.pro.trades}.`, { n: limits.trades, max: PLAN_LIMITS.pro.trades }),
      },
    };
  }

  const place = lookupZip(parsed.data.zip);
  if (!place) {
    return { error: fix, fieldErrors: { zip: msg(lang, 'pf.err.zip_unknown', "We couldn't find that ZIP code. Check it and try again.") } };
  }

  const extra = readExtraZips(formData, place.zip, lang);
  const kw = readKeywords(formData, lang);
  const fieldErrors: ProfileFormState['fieldErrors'] = {};
  if (extra.error) fieldErrors.extra_zips = extra.error;
  else if (extra.areas.length > limits.extraAreas) {
    fieldErrors.extra_zips = tier === 'pro' ? msg(lang, 'pf.err.extra_up_to', `Add up to ${limits.extraAreas} more ZIP codes.`, { n: limits.extraAreas }) : msg(lang, 'pf.err.extra_pro', 'More ZIP codes are part of Pro.');
  }
  if (kw.error) fieldErrors.keywords = kw.error;
  else if (kw.keywords.length > limits.keywords) {
    fieldErrors.keywords = tier === 'pro' ? msg(lang, 'pf.err.kw_up_to', `Watch up to ${limits.keywords} keywords.`, { n: limits.keywords }) : msg(lang, 'pf.err.kw_pro', 'Keyword watches are part of Pro.');
  }
  if (fieldErrors.extra_zips || fieldErrors.keywords) return { error: fix, fieldErrors };

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
    // Pro owns these fields on the form, so an empty list clears them. On Solo they are left out: saved extras stay saved.
    row.extra_areas = extra.areas;
    row.keywords = kw.keywords;
  }
  if (typeof opts.alertEmail === 'boolean') row.alert_email = opts.alertEmail;

  const { error } = await supabase.from('holler_profiles').upsert(row, { onConflict: 'user_id' });
  if (error) {
    if (/holler_plan_limit/.test(error.message ?? '')) {
      return { error: msg(lang, 'pf.err.plan_limit', 'That is more than your plan allows. Refresh the page and try again.') };
    }
    return { error: msg(lang, 'pf.err.save', 'We could not save that. Try again in a moment.') };
  }
  return { ok: true, message: msg(lang, 'pf.saved', 'Saved.') };
}
