import { describe, expect, it } from 'vitest';
import { AUTH_CALLBACK_URL, isAuthCallbackUrl, isUserCancelled, parseAuthCallback } from '../src/auth/callback';
import { makeNonce, sha256Hex, socialButtonsFor } from '../src/auth/social';

describe('auth callback parsing', () => {
  it('uses the holler scheme', () => {
    expect(AUTH_CALLBACK_URL).toBe('holler://auth-callback');
  });
  it('reads the code', () => {
    expect(parseAuthCallback('holler://auth-callback?code=abc-123')).toEqual({ code: 'abc-123', error: null, errorDescription: null });
  });
  it('reads values from the fragment too', () => {
    expect(parseAuthCallback('holler://auth-callback#code=frag')).toMatchObject({ code: 'frag' });
  });
  it('an error wins over a code', () => {
    expect(parseAuthCallback('holler://auth-callback?code=x&error=access_denied&error_description=User%20cancelled')).toEqual({
      code: null,
      error: 'access_denied',
      errorDescription: 'User cancelled',
    });
  });
  it('folds error_code into error', () => {
    expect(parseAuthCallback('holler://auth-callback?error_code=bad_oauth_state')).toMatchObject({ error: 'bad_oauth_state', code: null });
  });
  it('ignores other schemes and garbage without throwing', () => {
    for (const url of ['https://localholler.com/?code=x', 'durobay://auth-callback?code=x', 'holler://auth-callbackX?code=1', '', null, undefined, 42, '%%%']) {
      expect(parseAuthCallback(url)).toEqual({ code: null, error: null, errorDescription: null });
    }
    expect(isAuthCallbackUrl('holler://auth-callback')).toBe(true);
    expect(isAuthCallbackUrl('HOLLER://auth-callback/?code=1')).toBe(true);
    expect(isAuthCallbackUrl('holler://other')).toBe(false);
  });
  it('recognizes a cancel', () => {
    expect(isUserCancelled({ code: 'SIGN_IN_CANCELED', message: 'x' })).toBe(true);
    expect(isUserCancelled(new Error('The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)'))).toBe(true);
    expect(isUserCancelled(new Error('Network down'))).toBe(false);
  });
});

describe('social buttons (guideline 4.8)', () => {
  it('no buttons at all when Apple is off, even with Google on', () => {
    expect(socialButtonsFor({ appleSignIn: false, googleSignIn: true })).toEqual([]);
    expect(socialButtonsFor({ appleSignIn: false, googleSignIn: false })).toEqual([]);
  });
  it('Apple first, then Google', () => {
    expect(socialButtonsFor({ appleSignIn: true, googleSignIn: true })).toEqual(['apple', 'google']);
    expect(socialButtonsFor({ appleSignIn: true, googleSignIn: false })).toEqual(['apple']);
  });
});

describe('Apple nonce', () => {
  it('is 64 hex chars and fresh each time', () => {
    const a = makeNonce();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(makeNonce()).not.toBe(a);
  });
  it('hashes with SHA-256 (known vector)', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
