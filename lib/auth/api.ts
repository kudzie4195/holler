import 'server-only';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { parseLang, t, type Lang } from '@/lib/i18n';

export function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * Reads and validates a JSON body. Requires application/json, which a cross-site HTML form cannot send,
 * so it doubles as a basic CSRF guard for these cookie-setting routes.
 */
export async function readJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return { ok: false, response: jsonError('Unsupported request.', 415) };
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: jsonError('That request was not valid.', 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: jsonError(parsed.error.issues[0]?.message ?? 'Check your details and try again.', 400) };
  }
  return { ok: true, data: parsed.data };
}

/**
 * readJson for a form that may be in Spanish (round 18 ES). The body may carry `lang: 'es'` (the Spanish auth pages send it); the schema
 * is built for that language, so a validation message is in the language of the form. Anything but exactly 'es' is English, and the
 * English schema, messages and 415/400 answers are the ones readJson gives. The content-type check (the CSRF guard) is the same.
 */
export async function readJsonLang<T extends z.ZodType>(
  request: Request,
  schemaFor: (lang: Lang) => T,
): Promise<{ ok: true; data: z.infer<T>; lang: Lang } | { ok: false; response: NextResponse }> {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return { ok: false, response: jsonError('Unsupported request.', 415) };
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: jsonError('That request was not valid.', 400) };
  }
  const lang = parseLang(raw && typeof raw === 'object' ? (raw as { lang?: unknown }).lang : undefined);
  const parsed = schemaFor(lang).safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: jsonError(parsed.error.issues[0]?.message ?? (lang === 'en' ? 'Check your details and try again.' : t(lang, 'api.check_details')), 400) };
  }
  return { ok: true, data: parsed.data, lang };
}

/** A message for an auth route in the form's language. English is the literal each route always used (passed as `en`). */
export function authMessage(lang: Lang, key: Parameters<typeof t>[1], en: string): string {
  return lang === 'en' ? en : t(lang, key);
}

interface AuthLikeError {
  code?: string;
  status?: number;
  message?: string;
}

/** Turns a Supabase auth error into a short message and status that is safe to show. */
export function friendlyAuthError(error: AuthLikeError, lang: Lang = 'en'): { message: string; status: number } {
  const code = error.code ?? '';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || error.status === 429) {
    return { message: authMessage(lang, 'api.too_many', 'Too many tries. Wait a minute, then try again.'), status: 429 };
  }
  if (code === 'invalid_credentials') {
    return { message: authMessage(lang, 'api.invalid_login', INVALID_LOGIN_MESSAGE), status: 401 };
  }
  if (code === 'weak_password') {
    // The auth server writes its reason in English: a Spanish form gets the Spanish sentence instead.
    return { message: lang === 'en' ? error.message || 'Pick a stronger password.' : t(lang, 'api.weak_password'), status: 400 };
  }
  return { message: authMessage(lang, 'api.server', 'Something went wrong on our side. Try again in a moment.'), status: 500 };
}

/** True when an auth error means the email is already registered (never shown to the caller; see signup). */
export function isEmailTaken(error: AuthLikeError): boolean {
  return error.code === 'email_exists' || error.code === 'user_already_exists';
}

export const INVALID_LOGIN_MESSAGE = "That email and password don't match.";

export function isConfigError(e: unknown): boolean {
  return e instanceof Error && /not configured/i.test(e.message);
}
