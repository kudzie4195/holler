import type { EmailOtpType } from '@supabase/supabase-js';

/**
 * Holler only ever issues password-recovery links. Other OTP types (signup, magiclink, invite, email_change)
 * belong to other products on the shared project and must not mint a Holler session.
 */
export const CONFIRM_TYPES: readonly EmailOtpType[] = ['recovery'];

export function isConfirmType(value: unknown): value is EmailOtpType {
  return typeof value === 'string' && (CONFIRM_TYPES as readonly string[]).includes(value);
}
