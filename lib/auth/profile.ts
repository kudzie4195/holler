import 'server-only';
import { z } from 'zod';
import { lookupZip } from '@/lib/geo';
import { CATEGORIES } from '@/lib/signals/categories';
import { createClient } from '@/lib/supabase/server';
import type { ProfileFormState } from './profile-types';

const schema = z.object({
  business_name: z
    .string()
    .trim()
    .min(2, 'Enter your business name.')
    .max(80, 'Keep the name under 80 characters.'),
  categories: z
    .array(z.string())
    .min(1, 'Pick at least one thing you do.')
    .max(5, 'Pick up to 5.'),
  zip: z.string().trim().regex(/^\d{5}$/, 'Enter a 5-digit ZIP code.'),
  radius: z.coerce.number().int().min(5, 'Minimum is 5 miles.').max(100, 'Maximum is 100 miles.'),
});

/**
 * Validates the shared onboarding/settings fields, geocodes the ZIP and writes holler_profiles
 * through the user's own RLS-scoped client.
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
      error: 'Fix the highlighted fields and try again.',
      fieldErrors: {
        business_name: flat.business_name?.[0],
        categories: flat.categories?.[0],
        zip: flat.zip?.[0],
        radius: flat.radius?.[0],
      },
    };
  }

  const valid = new Set<string>(CATEGORIES.map((c) => c.id));
  const categories = [...new Set(parsed.data.categories)].filter((c) => valid.has(c));
  if (categories.length === 0) {
    return { error: 'Fix the highlighted fields and try again.', fieldErrors: { categories: 'Pick at least one thing you do.' } };
  }

  const place = lookupZip(parsed.data.zip);
  if (!place) {
    return { error: 'Fix the highlighted fields and try again.', fieldErrors: { zip: "We couldn't find that ZIP code. Check it and try again." } };
  }

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
    updated_at: new Date().toISOString(),
  };
  if (typeof opts.alertEmail === 'boolean') row.alert_email = opts.alertEmail;

  const supabase = await createClient();
  const { error } = await supabase.from('holler_profiles').upsert(row, { onConflict: 'user_id' });
  if (error) {
    return { error: 'We could not save that. Try again in a moment.' };
  }
  return { ok: true, message: 'Saved.' };
}
