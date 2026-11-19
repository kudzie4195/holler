import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as profileLib from '@/lib/auth/profile';
import type { ProfileFormState } from '@/lib/auth/profile-types';
import { cleanKeyword, parseExtraAreas, parseKeywords } from '@/lib/plan';
import type { ProfileField, ProfileInput } from './types';

/**
 * Mobile onboarding and profile edits go through the web's own saveProfile (lib/auth/profile.ts): same validation, same plan limits,
 * same messages. The app's JSON is turned into the FormData the web form posts, so not one rule is copied here.
 *
 * saveProfile reads and writes with the cookie client today. The integration patch (mobile-api.md, "Patches for integration") adds
 * an optional `db` (the member's own RLS client, built from the bearer token) and the marker SAVE_PROFILE_ACCEPTS_DB. Until that patch
 * is in, profileSaver() returns null and the routes answer 503 not_configured instead of writing through the wrong client.
 */
type SaveWithDb = (userId: string, formData: FormData, opts: { alertEmail?: boolean; db?: Pick<SupabaseClient, 'from'> }) => Promise<ProfileFormState>;

export function profileSaver(): SaveWithDb | null {
  const mod = profileLib as unknown as Record<string, unknown>;
  return mod.SAVE_PROFILE_ACCEPTS_DB === true && typeof mod.saveProfile === 'function' ? (mod.saveProfile as SaveWithDb) : null;
}

/** The stored fields PATCH falls back on when the app leaves one out. */
export interface SavedProfileFields {
  business_name: string;
  categories: string[] | null;
  zip: string | null;
  radius_mi: number;
  extra_areas?: unknown;
  keywords?: unknown;
}

export type ParsedInput =
  | { ok: true; input: ProfileInput }
  | { ok: false; fieldErrors: Partial<Record<ProfileField, string>> };

const strList = (v: unknown, max: number): string[] | null =>
  Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string') ? (v as string[]).map((s) => s.slice(0, 80)) : null;

/** Type checks only (strings, numbers, lists). Content rules are saveProfile's. */
export function parseProfileInput(body: Record<string, unknown>, mode: 'onboarding' | 'patch'): ParsedInput {
  const fe: Partial<Record<ProfileField, string>> = {};
  const input: ProfileInput = {};
  const has = (k: string) => body[k] !== undefined;
  if (has('businessName')) {
    if (typeof body.businessName === 'string') input.businessName = body.businessName.slice(0, 200);
    else fe.businessName = 'Enter your business name.';
  } else if (mode === 'onboarding') fe.businessName = 'Enter your business name.';
  if (has('trades')) {
    const t = strList(body.trades, 60);
    if (t) input.trades = t;
    else fe.trades = 'Pick at least one thing you do.';
  } else if (mode === 'onboarding') fe.trades = 'Pick at least one thing you do.';
  if (has('zip')) {
    if (typeof body.zip === 'string') input.zip = body.zip.slice(0, 20);
    else fe.zip = 'Enter a 5-digit ZIP code.';
  } else if (mode === 'onboarding') fe.zip = 'Enter a 5-digit ZIP code.';
  if (has('radiusMi')) {
    if (typeof body.radiusMi === 'number' && Number.isInteger(body.radiusMi)) input.radiusMi = body.radiusMi;
    else if (typeof body.radiusMi === 'number' && Number.isFinite(body.radiusMi)) fe.radiusMi = 'Pick a whole number of miles.';
    else fe.radiusMi = 'Pick a distance between 5 and 100 miles.';
  } else if (mode === 'onboarding') input.radiusMi = 25;
  if (has('extraZips')) {
    const z = strList(body.extraZips, 10);
    if (z) input.extraZips = z;
    else fe.extraZips = 'Add up to 2 more ZIP codes.';
  }
  if (has('keywords')) {
    const k = strList(body.keywords, 20);
    if (k) input.keywords = k;
    else fe.keywords = 'Watch up to 5 keywords.';
  }
  if (mode === 'patch') {
    if (has('alertEmail')) {
      if (typeof body.alertEmail === 'boolean') input.alertEmail = body.alertEmail;
      else return { ok: false, fieldErrors: fe };
    }
    if (has('pushAlerts')) {
      if (typeof body.pushAlerts === 'boolean') input.pushAlerts = body.pushAlerts;
      else return { ok: false, fieldErrors: fe };
    }
  }
  return Object.keys(fe).length > 0 ? { ok: false, fieldErrors: fe } : { ok: true, input };
}

/**
 * The FormData the web form would post. Fields the app left out take the saved value, so a PATCH of one field never clears another
 * (on Pro, saveProfile treats a missing extra ZIP or keyword list as "clear them"). On Solo the web form has no extra ZIP or keyword
 * fields, so saved ones are not sent back (a downgraded member's saved extras would otherwise trip the plan check).
 */
export function toFormData(input: ProfileInput, saved: SavedProfileFields | null, tier: 'starter' | 'pro' = 'starter'): FormData {
  const fd = new FormData();
  fd.set('business_name', input.businessName ?? saved?.business_name ?? '');
  for (const c of input.trades ?? saved?.categories ?? []) fd.append('categories', c);
  fd.set('zip', input.zip ?? saved?.zip ?? '');
  fd.set('radius', String(input.radiusMi ?? saved?.radius_mi ?? 25));
  const pro = tier === 'pro';
  for (const z of input.extraZips ?? (pro ? parseExtraAreas(saved?.extra_areas).map((a) => a.zip) : [])) fd.append('extra_zip', z);
  for (const k of input.keywords ?? (pro ? parseKeywords(saved?.keywords) : [])) fd.append('keyword', k);
  // An explicit empty list is "clear them": the web form posts its empty inputs, which saveProfile drops as blanks.
  if (input.extraZips && input.extraZips.length === 0) fd.append('extra_zip', '');
  if (input.keywords && input.keywords.length === 0) fd.append('keyword', '');
  return fd;
}

const FIELD: Record<string, ProfileField> = {
  business_name: 'businessName',
  categories: 'trades',
  zip: 'zip',
  radius: 'radiusMi',
  extra_zips: 'extraZips',
  keywords: 'keywords',
};

/** Fixed wording per field, used when a message from the shared validator is not one of its own written sentences. */
const FALLBACK: Record<ProfileField, string> = {
  businessName: 'Enter your business name.',
  trades: 'Pick at least one thing you do.',
  zip: 'Enter a 5-digit ZIP code.',
  radiusMi: 'Pick a whole number of miles between 5 and 100.',
  extraZips: 'Check the extra ZIP codes and try again.',
  keywords: 'Check the keywords and try again.',
};
export const FIX_FIELDS = 'Fix the highlighted fields and try again.';

/** A validator's default text (zod: "Invalid input: expected int, received number", "Too small: ...") rather than a written message. */
export function isRawValidatorText(msg: string): boolean {
  return /^(invalid|too (small|big)|expected|unrecognized|required)\b/i.test(msg.trim()) || /\bexpected\b.*\breceived\b/i.test(msg);
}

/** saveProfile's field errors under the app's field names. A raw validator message is replaced with the field's fixed wording. */
export function mapFieldErrors(fe: ProfileFormState['fieldErrors']): Partial<Record<ProfileField, string>> {
  const out: Partial<Record<ProfileField, string>> = {};
  for (const [k, v] of Object.entries(fe ?? {})) {
    const f = FIELD[k];
    if (v && f) out[f] = typeof v === 'string' && !isRawValidatorText(v) ? v : FALLBACK[f];
  }
  return out;
}

/** saveProfile's form-level message, or the fixed one when it is missing or raw validator text. */
export function formMessage(msg: string | null | undefined): string {
  return msg && !isRawValidatorText(msg) ? msg : FIX_FIELDS;
}

/**
 * True when anything matching reads changed (trades, ZIP, radius, extra ZIPs, keywords) or there was no profile. The web settings
 * action applies the same test before its after-response backfill.
 */
export function targetingChanged(before: SavedProfileFields | null, fd: FormData): boolean {
  if (!before) return true;
  const set = (list: string[]) => [...new Set(list)].sort().join(',');
  return (
    set(fd.getAll('categories').map(String)) !== set(before.categories ?? []) ||
    String(fd.get('zip') ?? '').trim() !== (before.zip ?? '') ||
    Number(fd.get('radius') ?? 25) !== before.radius_mi ||
    // Extra ZIPs and keywords count only when the form carried them (Pro, or the app sent them), as on the web.
    (fd.has('extra_zip') &&
      set(fd.getAll('extra_zip').map((v) => String(v).trim()).filter(Boolean)) !== set(parseExtraAreas(before.extra_areas).map((a) => a.zip))) ||
    (fd.has('keyword') &&
      set(fd.getAll('keyword').map((v) => cleanKeyword(String(v)).toLowerCase()).filter(Boolean)) !==
        set(parseKeywords(before.keywords).map((k) => k.toLowerCase())))
  );
}
