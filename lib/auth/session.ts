import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

export interface Profile {
  user_id: string;
  business_name: string;
  categories: string[];
  zip: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lon: number | null;
  radius_mi: number;
  alert_email: boolean;
  subscription_status: string;
  trial_ends_at: string;
  /** 'starter' | 'pro' (migration 0004). Missing on a database without 0004: read it through lib/plan effectiveTier, never directly. */
  plan?: string | null;
  /** Pro extra service areas, jsonb array of {zip, city, state, lat, lon}. Read with lib/plan parseExtraAreas. */
  extra_areas?: unknown;
  /** Pro keyword watches. */
  keywords?: string[] | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  /** 'none' | 'stripe' | 'apple' | 'google' (migration 0020). Missing before 0020. */
  plan_source?: string | null;
  /** End of the current App Store or Google Play period (migration 0020). Missing before 0020. */
  store_expires_at?: string | null;
  email_verified_at: string | null;
  created_at: string;
  /** 'en' | 'es' (migration 0024). Missing before 0024: read it through lib/i18n langOfProfile, and treat the key being absent as "no language setting yet". */
  language?: string | null;
}

/** Verified user (asks the Auth server, not just the cookie). Deduped per request. */
export const getUser = cache(async (): Promise<User | null> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user;
  } catch {
    return null;
  }
});

export const getProfile = cache(async (userId: string): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from('holler_profiles').select('*').eq('user_id', userId).maybeSingle();
  // "No row" is data === null. A DB error must reach the error boundary, never look like "no profile".
  if (error) throw new Error(`profile lookup failed: ${error.code ?? 'unknown'}`);
  return (data as Profile | null) ?? null;
});

export async function requireUser(next?: string): Promise<User> {
  const user = await getUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  return user;
}

/** User plus profile. Signed in without a profile goes to /onboarding. */
export async function requireProfile(): Promise<{ user: User; profile: Profile }> {
  const user = await requireUser('/app');
  const profile = await getProfile(user.id);
  if (!profile) redirect('/onboarding');
  return { user, profile };
}
