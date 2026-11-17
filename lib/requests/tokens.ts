import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { rateDigest } from '@/lib/auth/limits';

/**
 * Link tokens for resident requests. Only sha256 hashes are stored; each kind is hashed with its own prefix, so a token of one kind
 * never matches a hash column of another kind. Lookups are by hash (an index lookup, no string comparison of secrets in code).
 *
 * - confirm: 32 random bytes, emailed once.
 * - close / remove: HMAC-SHA256(server secret, kind + request id). 32 bytes, unguessable without the secret, and the same link can be
 *   put in every email we send for that request (we cannot re-create a random token later because only its hash is kept).
 *   The request id is a random UUID that is never shown anywhere.
 */
export type TokenKind = 'confirm' | 'close' | 'remove';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function linkToken(kind: 'close' | 'remove', requestId: string, secret: string): string {
  if (!secret) throw new Error('missing secret');
  return createHmac('sha256', secret).update(`holler-request:${kind}:v1:${requestId}`).digest('base64url');
}

export function hashToken(kind: TokenKind, token: string): string {
  return createHash('sha256').update(`holler-request:${kind}:${token}`).digest('hex');
}

/** Cheap shape check before any database lookup: 43 base64url characters (32 bytes). */
export function isTokenShape(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

export function newRequestId(): string {
  return randomUUID();
}

/** Public id used as holler_signals.external_id. Random, says nothing about the resident. */
export function newPublicId(): string {
  return `req_${randomBytes(10).toString('hex')}`;
}

/**
 * Keyed hash of an email address for the rate limiter, so its key is not a plain sha256 of the address. Uses the same helper as every
 * other limiter key (lib/auth/limits.ts rateDigest), with the request secret passed explicitly.
 */
export function emailRateValue(email: string, secret: string): string {
  return rateDigest(`holler-request:email:${limiterMailbox(email)}`, secret);
}

/**
 * The mailbox an address delivers to, for the rate limiter only (never for sending): lower case, any "+tag" removed and dots in the
 * local part removed, and googlemail.com read as gmail.com. "Victim+1@Gmail.com" and "v.i.c.t.i.m@googlemail.com" are one mailbox, so
 * they share one daily limit. Removing dots for every domain can only make the limit stricter.
 */
export function limiterMailbox(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  let domain = e.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  const local = e.slice(0, at).split('+')[0].replace(/\./g, '');
  return `${local || e.slice(0, at)}@${domain}`;
}
