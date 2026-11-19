import { EMAIL_STYLE } from '@/lib/email/theme';
import { COMPANY } from './company';

/**
 * Sender identity and postal address for the end of every email Holler sends to members.
 * CAN-SPAM asks commercial email to carry a valid physical postal address; transactional mail gets it too, so every
 * member-facing email reads the same. All values come from lib/legal/company.ts (one place to change).
 */

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "Holler is run by ColorLabPro, Inc., <address>." Plain text, no trailing newline. */
export function postalFooterText(): string {
  return `${COMPANY.brand} is run by ${COMPANY.legalName}, ${COMPANY.addressLine}.`;
}

/** The same line as a small grey paragraph (size and color from the email theme), every value HTML-escaped. */
export function postalFooterHtml(): string {
  return `<p style="${EMAIL_STYLE.small};margin:16px 0 0 0">${escape(COMPANY.brand)} is run by ${escape(
    COMPANY.legalName,
  )}, ${escape(COMPANY.addressLine)}.</p>`;
}
