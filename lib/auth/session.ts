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
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  created_at: string;
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
  const { data } = await supabase.from('holler_profiles').select('*').eq('user_id', userId).maybeSingle();
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
