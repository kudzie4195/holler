// Email and password, the same way the website does it.
//
// Sign-up goes through the website's own route (POST /api/auth/signup), never supabase.auth.signUp:
// the Supabase project is shared, and that route creates the account tagged as Holler, skips the
// shared project's confirmation email and sends Holler's own confirm-your-email message. The app then
// signs in with the same email and password to get its own session.
import type { HttpFn } from '../lib/http';
import { siteUrl } from '../lib/env';
import { NETWORK_MESSAGE, SERVER_MESSAGE } from '../api/client';
import { supabase } from './supabase';

export type EmailSignUpResult =
  | { kind: 'signed-in' }
  | { kind: 'log-in-instead'; message: string }
  | { kind: 'error'; message: string };

interface SiteAuthBody {
  ok?: boolean;
  signedIn?: boolean;
  error?: string;
  message?: string;
}

async function postSite(http: HttpFn, path: string, body: unknown): Promise<{ status: number; data: SiteAuthBody }> {
  try {
    const res = await http({
      method: 'POST',
      url: siteUrl(path),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    });
    const data = (res.data && typeof res.data === 'object' ? res.data : {}) as SiteAuthBody;
    return { status: res.status, data };
  } catch {
    return { status: 0, data: { ok: false, error: NETWORK_MESSAGE } };
  }
}

export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export async function signUpWithEmail(http: HttpFn, email: string, password: string): Promise<EmailSignUpResult> {
  const clean = email.trim().toLowerCase();
  const { data } = await postSite(http, '/api/auth/signup', { email: clean, password });
  if (!data.ok) return { kind: 'error', message: data.error || SERVER_MESSAGE };
  if (!data.signedIn) return { kind: 'log-in-instead', message: data.message || 'If you already have an account, log in.' };
  const { error } = await supabase().auth.signInWithPassword({ email: clean, password });
  if (error) return { kind: 'log-in-instead', message: 'Your account is ready. Log in to continue.' };
  return { kind: 'signed-in' };
}

export async function signInWithEmail(email: string, password: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (!error) return { ok: true };
  const status = (error as { status?: number }).status;
  if (status === 429) return { ok: false, message: 'Too many tries. Wait a minute, then try again.' };
  if (status === 400 || status === 401 || /invalid/i.test(error.message)) return { ok: false, message: 'That email and password do not match.' };
  if (status === 0 || /fetch|network/i.test(error.message)) return { ok: false, message: NETWORK_MESSAGE };
  return { ok: false, message: SERVER_MESSAGE };
}

/** Same route the website's "Forgot your password?" uses. Always answers the same way. */
export async function requestPasswordReset(http: HttpFn, email: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { status, data } = await postSite(http, '/api/auth/forgot', { email: email.trim().toLowerCase() });
  if (data.ok) return { ok: true };
  if (status === 0) return { ok: false, message: NETWORK_MESSAGE };
  return { ok: false, message: data.error || SERVER_MESSAGE };
}
