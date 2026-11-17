import { z } from 'zod';
import { DESCRIPTION_MAX, DESCRIPTION_MIN, REPLY_MAX, REPLY_MIN } from './constants';

/**
 * Field names of the /request form. `leave_blank` is the honeypot: people never see it, simple bots fill it. It was called `website`,
 * which Safari's contact autofill can fill from the visitor's own card; a name no autofill rule maps keeps real people out of it.
 */
export const HONEYPOT_FIELD = 'leave_blank';
export const REQUEST_FIELDS = ['trade', 'zip', 'description', 'email', 'consent', HONEYPOT_FIELD] as const;
export type RequestField = (typeof REQUEST_FIELDS)[number];

export type RawRequest = Partial<Record<RequestField, unknown>>;

export interface RequestInput {
  trade: string;
  zip: string;
  description: string;
  email: string;
}

export type FieldErrors = Partial<Record<'trade' | 'zip' | 'description' | 'email' | 'consent', string>>;

// Tabs and line breaks are fine in a description; other control characters are not.
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const str = (v: unknown) => (typeof v === 'string' ? v : '');

const schema = z.object({
  trade: z.string().trim().min(1, 'Pick what you need.'),
  zip: z.string().trim().regex(/^\d{5}$/, 'Enter a 5-digit ZIP code.'),
  // Counted in characters as the database counts them (code points), so an emoji is one character here too.
  description: z
    .string()
    .trim()
    .refine((v) => [...v].length >= DESCRIPTION_MIN, `Tell businesses a bit more. Use at least ${DESCRIPTION_MIN} characters.`)
    .refine((v) => [...v].length <= DESCRIPTION_MAX, `Keep it under ${DESCRIPTION_MAX} characters.`)
    .refine((v) => !CONTROL_RE.test(v), 'Remove the special characters and try again.'),
  email: z.string().trim().max(254, 'Check your email address.').pipe(z.email('Check your email address.')),
  consent: z.literal(true, 'Tick the box to say you agree.'),
});

export function isHoneypotHit(raw: RawRequest): boolean {
  return str(raw[HONEYPOT_FIELD]).trim() !== '';
}

/** Validates the form. `isTrade` decides which trades are allowed (see lib/requests/trades.ts). */
export function parseRequest(
  raw: RawRequest,
  isTrade: (id: string) => boolean,
): { ok: true; data: RequestInput } | { ok: false; errors: FieldErrors } {
  const consent = raw.consent === true || raw.consent === 'on' || raw.consent === 'true' || raw.consent === 'yes';
  const parsed = schema.safeParse({
    trade: str(raw.trade),
    zip: str(raw.zip),
    description: str(raw.description).replace(/\r\n/g, '\n'),
    email: str(raw.email),
    consent,
  });
  const errors: FieldErrors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof FieldErrors;
      if (key && !errors[key]) errors[key] = issue.message;
    }
  }
  const trade = str(raw.trade).trim();
  if (!errors.trade && !isTrade(trade)) errors.trade = 'Pick what you need from the list.';
  if (Object.keys(errors).length > 0 || !parsed.success) return { ok: false, errors };
  return {
    ok: true,
    data: { ...parsed.data, email: parsed.data.email.toLowerCase(), trade },
  };
}

/**
 * A business reply. Only length and control characters are checked: the business may include its own phone, email or website.
 * Returns the trimmed message or an error.
 */
export function parseReplyMessage(raw: unknown): { ok: true; message: string } | { ok: false; error: string } {
  const message = str(raw).replace(/\r\n/g, '\n').trim();
  if (CONTROL_RE.test(message)) return { ok: false, error: 'Remove the special characters and try again.' };
  if (message.length < REPLY_MIN) return { ok: false, error: `Write at least ${REPLY_MIN} characters.` };
  if (message.length > REPLY_MAX) return { ok: false, error: `Keep it under ${REPLY_MAX} characters.` };
  return { ok: true, message };
}
