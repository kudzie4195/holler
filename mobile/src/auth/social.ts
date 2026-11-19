// Sign in with Apple and Continue with Google.
//
//   Apple on iPhone: Apple's own sheet through @capawesome/capacitor-apple-sign-in. Apple gets the
//     SHA-256 of a fresh nonce, Supabase gets the raw nonce and the id token (signInWithIdToken).
//     The bundle id com.localholler.app must be listed under Supabase > Auth > Apple > Client IDs.
//   Apple on Android, and Google everywhere: Supabase's authorize URL opened in the in-app browser
//     (@capacitor/browser), back on holler://auth-callback?code=..., where finishAuthCallback()
//     swaps the code for a session (PKCE; the verifier never leaves this phone).
//
// Two rules live here and nowhere else:
//   * Guideline 4.8: socialButtonsFor() returns no buttons at all when Apple is off, whatever the
//     Google flag says, and Apple always comes first.
//   * No Capacitor plugin is ever returned from an async function. A plugin is a Proxy that answers
//     `then`, so returning one makes the promise wait forever. Loaders return a box: { Browser }.
import type { BuildFlags } from '../lib/env';
import { platform, isNative } from '../lib/platform';
import { AUTH_CALLBACK_URL, parseAuthCallback, isAuthCallbackUrl } from './callback';
import { supabase } from './supabase';

export type SocialProvider = 'apple' | 'google';

export function socialButtonsFor(flags: Pick<BuildFlags, 'appleSignIn' | 'googleSignIn'>): SocialProvider[] {
  if (!flags.appleSignIn) return [];
  return flags.googleSignIn ? ['apple', 'google'] : ['apple'];
}

function webcrypto(): Crypto {
  const c = globalThis.crypto;
  if (!c || !c.subtle || typeof c.getRandomValues !== 'function') throw new Error('WEBCRYPTO_UNAVAILABLE');
  return c;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** 32 random bytes as 64 hex characters. */
export function makeNonce(): string {
  const bytes = new Uint8Array(32);
  webcrypto().getRandomValues(bytes);
  return toHex(bytes);
}

/** SHA-256 of a UTF-8 string, lowercase hex. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await webcrypto().subtle.digest('SHA-256', new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
}

async function browserBox() {
  const { Browser } = await import('@capacitor/browser');
  return { Browser };
}

async function appleBox() {
  const mod = await import('@capawesome/capacitor-apple-sign-in');
  return { AppleSignIn: mod.AppleSignIn, SignInScope: mod.SignInScope };
}

export async function closeAuthBrowser(): Promise<void> {
  if (!isNative()) return;
  try {
    const { Browser } = await browserBox();
    await Browser.close();
  } catch {
    // Already closed (iOS closes SFSafariViewController itself on a scheme redirect), or not present.
  }
}

async function oauthInBrowser(provider: SocialProvider): Promise<void> {
  const sb = supabase();
  if (!isNative()) {
    const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });
    if (error) throw error;
    return;
  }
  const { data, error } = await sb.auth.signInWithOAuth({
    provider,
    options: { redirectTo: AUTH_CALLBACK_URL, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('NO_AUTHORIZE_URL');
  const { Browser } = await browserBox();
  await Browser.open({ url: data.url, presentationStyle: 'popover' });
}

/** Resolves when signed in (iPhone), or as soon as the browser is open (the callback finishes the job). */
export async function signInWithApple(): Promise<{ viaBrowser: boolean }> {
  if (platform() !== 'ios') {
    await oauthInBrowser('apple');
    return { viaBrowser: true };
  }
  const { AppleSignIn, SignInScope } = await appleBox();
  const rawNonce = makeNonce();
  const hashedNonce = await sha256Hex(rawNonce);
  const result = await AppleSignIn.signIn({ scopes: [SignInScope.Email, SignInScope.FullName], nonce: hashedNonce });
  if (!result?.idToken) throw new Error('APPLE_NO_ID_TOKEN');
  const sb = supabase();
  const { error } = await sb.auth.signInWithIdToken({ provider: 'apple', token: result.idToken, nonce: rawNonce });
  if (error) throw error;
  // Apple sends the name once, on first consent only. Keep it if it came; never fail the sign-in over it.
  const fullName = [result.givenName, result.familyName].filter(Boolean).join(' ').trim();
  if (fullName) {
    try {
      await sb.auth.updateUser({ data: { full_name: fullName } });
    } catch {
      /* a missing display name is not worth a failed sign-in */
    }
  }
  return { viaBrowser: false };
}

export async function signInWithGoogle(): Promise<{ viaBrowser: boolean }> {
  await oauthInBrowser('google');
  return { viaBrowser: true };
}

export type CallbackOutcome = { kind: 'ignored' } | { kind: 'signed-in' } | { kind: 'error'; message: string };

/** Handle a URL the OS opened the app with. Only holler://auth-callback is acted on. */
export async function finishAuthCallback(url: string): Promise<CallbackOutcome> {
  if (!isAuthCallbackUrl(url)) return { kind: 'ignored' };
  await closeAuthBrowser();
  const parsed = parseAuthCallback(url);
  if (parsed.error) {
    const cancelled = /access_denied|cancel/i.test(`${parsed.error} ${parsed.errorDescription ?? ''}`);
    return cancelled ? { kind: 'ignored' } : { kind: 'error', message: "That sign-in didn't go through. Try again." };
  }
  if (!parsed.code) return { kind: 'error', message: "That sign-in didn't go through. Try again." };
  const { error } = await supabase().auth.exchangeCodeForSession(parsed.code);
  if (error) return { kind: 'error', message: "That sign-in link expired. Try again." };
  return { kind: 'signed-in' };
}
