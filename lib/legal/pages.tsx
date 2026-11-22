/**
 * Shared bits of the public legal pages (/privacy, /terms, /delete-account): the version date, the support link and the account
 * deletion steps, so the three pages cannot drift apart. Every step below is checked against the code in tests/legal:
 *  - web: components/delete-account.tsx (button "Delete my account", then "Yes, delete everything") on /app/settings;
 *  - app: mobile/src/screens/Settings.tsx (button "Delete account") and mobile/src/screens/DeleteAccount.tsx (field "Type DELETE to
 *    confirm", button "Delete my account"), which calls POST /api/m/account/delete (lib/mobile/account.ts deleteHollerAccount).
 */
import { env } from '@/lib/env';

/**
 * "Last updated" dates (round 18 integration): each legal page carries the date its own text last changed.
 *  - /terms: November 22, 2026 (round 18 trial: "60-day free trial").
 *  - /privacy: November 22, 2026 (round 18 trial: trial-email timing; round 18 ES: the holler_lang cookie sentence). PRIVACY_UPDATED below.
 *  - /delete-account: November 19, 2026 (no text change in round 18).
 */
export const LEGAL_UPDATED = 'November 19, 2026';
/** "Last updated" date printed on /terms (its trial sentence changed in round 18). */
export const TERMS_UPDATED = 'November 22, 2026';

/** "Last updated" date printed on /privacy: it changed later than the other two (round 18 ES: the holler_lang cookie sentence). */
export const PRIVACY_UPDATED = 'November 22, 2026';

/** The support address when SUPPORT_EMAIL is set, otherwise undefined (pages then point at the contact link in our emails). */
export function supportAddress(): string | undefined {
  return env.SUPPORT_EMAIL?.trim() || undefined;
}

/** Where to write to us: SUPPORT_EMAIL when set, otherwise the contact link in our emails (same fallback the pages always had). */
export function Support({ support }: { support: string | undefined }) {
  return support ? <a href={`mailto:${support}`}>{support}</a> : <>the contact link in any Holler email</>;
}

/** The word the app asks for before it deletes an account (mobile/src/screens/DeleteAccount.tsx). */
export const APP_DELETE_WORD = 'DELETE';
