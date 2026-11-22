import type { SupabaseClient } from '@supabase/supabase-js';
import { t, type Lang } from '@/lib/i18n';
import {
  isPropertyFocus,
  isWorkType,
  MAX_MIN_JOB_VALUE,
  WORK_PROFILE_COLUMNS,
  workSettingsOf,
  type PropertyFocus,
  type WorkColumns,
  type WorkProfile,
  type WorkType,
} from '@/lib/signals/work-profile';

export interface WorkProfileState {
  ok?: boolean;
  /** True when nothing was written because the database has no work columns yet (migration 0027 not applied). Never an error. */
  skipped?: boolean;
  message?: string;
  error?: string;
}

export interface WorkProfileInput {
  work_property: PropertyFocus;
  work_min_value: number | null;
  work_type: WorkType;
}

/**
 * Migration 0027 is not applied: Postgres 42P01 (undefined table) or 42703 (undefined column), PostgREST PGRST205 (table not in the schema
 * cache) or PGRST204 (column not in the schema cache), or the same in words.
 */
export function workProfilesMissing(e: { code?: string | null; message?: string | null } | null): boolean {
  if (!e) return false;
  if (e.code === '42P01' || e.code === 'PGRST205' || e.code === '42703' || e.code === 'PGRST204') return true;
  const m = e.message ?? '';
  return /holler_work_profiles|work_(?:property|min_value|type)/i.test(m) && /does not exist|could not find|schema cache/i.test(m);
}

/**
 * The member's saved work settings, read with their own client (RLS: own row only). `available` is false when migration 0027 is not
 * applied (or the read fails): Settings then hides the section. No row yet means the defaults.
 */
export async function readWorkProfile(supabase: Pick<SupabaseClient, 'from'>, userId: string): Promise<{ available: boolean; settings: WorkProfile }> {
  const defaults = workSettingsOf(null);
  try {
    const { data, error } = await supabase.from('holler_work_profiles').select(WORK_PROFILE_COLUMNS).eq('user_id', userId).maybeSingle();
    if (error) return { available: false, settings: defaults };
    return { available: true, settings: workSettingsOf((data ?? null) as WorkColumns | null) };
  } catch {
    return { available: false, settings: defaults };
  }
}

/**
 * Reads the Settings form. Property and work type must be one of the listed values; the minimum is empty (no minimum) or a whole number of
 * dollars from 1 to MAX_MIN_JOB_VALUE ("$5,000" and "5000" are both accepted). Returns null for anything else.
 */
export function parseWorkProfileForm(form: { get(name: string): unknown }): WorkProfileInput | null {
  const property = form.get('work_property');
  const type = form.get('work_type');
  const rawMin = form.get('work_min_value');
  if (!isPropertyFocus(property) || !isWorkType(type)) return null;
  const minText = typeof rawMin === 'string' ? rawMin.trim().replace(/^\$\s*/, '').replace(/,/g, '') : rawMin == null ? '' : null;
  if (minText === null) return null;
  let min: number | null = null;
  if (minText !== '') {
    // Whole dollars; a trailing ".00" or ".0" is accepted ("$5,000.00"), any other cents are refused.
    if (!/^\d{1,9}(?:\.0{1,2})?$/.test(minText)) return null;
    const n = Number(minText.replace(/\.0+$/, ''));
    if (n > MAX_MIN_JOB_VALUE) return null;
    min = n === 0 ? null : n;
  }
  return { work_property: property, work_min_value: min, work_type: type };
}

/**
 * Saves the member's work profile in their own holler_work_profiles row (RLS: own row only, migration 0027), never inside the main
 * profile save, so a missing table can never break "Save changes". With migration 0027 not applied it writes nothing and returns
 * { ok: true, skipped: true }. The new settings apply to new scans: no card the member already has
 * is removed (lib/signals/rematch.ts prunes with the profile minus its work settings).
 */
export async function saveWorkProfile(
  supabase: Pick<SupabaseClient, 'from'>,
  userId: string,
  form: { get(name: string): unknown },
  lang: Lang = 'en',
): Promise<WorkProfileState> {
  const input = parseWorkProfileForm(form);
  if (!input) return { error: t(lang, 'settings.work.error') };
  try {
    const { error } = await supabase.from('holler_work_profiles').upsert({ user_id: userId, ...input }, { onConflict: 'user_id' });
    if (workProfilesMissing(error)) return { ok: true, skipped: true };
    if (error) return { error: t(lang, 'settings.work.error') };
    return { ok: true, message: t(lang, 'settings.work.saved') };
  } catch {
    return { error: t(lang, 'settings.work.error') };
  }
}
