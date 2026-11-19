/**
 * Firebase Cloud Messaging HTTP v1 sender (one sender for iOS and Android). No SDK: the OAuth access token is minted from the service
 * account in FIREBASE_SERVICE_ACCOUNT_JSON (the JSON key file, raw or base64) with a JWT signed by node:crypto (RS256), and cached in
 * memory until five minutes before it expires.
 *
 * Contract: sendPush never throws into the caller. Without the env it does nothing and reports `not_configured`. Only an answer that
 * is about the device token itself comes back as `dead` (the caller disables that token): UNREGISTERED, NOT_FOUND, or
 * INVALID_ARGUMENT whose details name the field `message.token`. Any other INVALID_ARGUMENT is a mistake in our payload, not a dead
 * device: it comes back as `payload` and disables nothing, so one bad payload can never disable every member's device in one run.
 * Reference: https://firebase.google.com/docs/cloud-messaging/send/v1-api (messages:send, error codes).
 */
import { createSign } from 'node:crypto';
import { PUSH_CHANNEL_ID } from '@/lib/mobile/types';

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri: string;
}

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** FCM data values must be strings. */
  data: Record<string, string>;
}

export type SendResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'dead'; code: string }
  | { ok: false; reason: 'payload'; code: string }
  | { ok: false; reason: 'error'; status: number; code: string };

export interface FcmDeps {
  fetch?: typeof fetch;
  now?: () => number;
  /** Raw env value; defaults to process.env.FIREBASE_SERVICE_ACCOUNT_JSON (read per call). */
  env?: string | undefined;
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TIMEOUT_MS = 8000;

/** Parses the service account env (raw JSON or base64 of it). Null when missing or unusable. */
export function parseServiceAccount(raw: string | undefined | null): ServiceAccount | null {
  if (!raw || !raw.trim()) return null;
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  let v = tryParse(raw.trim());
  if (!v) v = tryParse(Buffer.from(raw.trim(), 'base64').toString('utf8'));
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.project_id !== 'string' || typeof o.client_email !== 'string' || typeof o.private_key !== 'string') return null;
  if (!/^[a-z0-9-]{4,40}$/.test(o.project_id)) return null;
  const key = o.private_key.includes('\\n') ? o.private_key.replace(/\\n/g, '\n') : o.private_key;
  if (!key.includes('PRIVATE KEY')) return null;
  const tokenUri = typeof o.token_uri === 'string' && o.token_uri.startsWith('https://') ? o.token_uri : 'https://oauth2.googleapis.com/token';
  return { project_id: o.project_id, client_email: o.client_email, private_key: key, token_uri: tokenUri };
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/** The signed assertion for the OAuth jwt-bearer grant. Exported for tests. */
export function signAssertion(sa: ServiceAccount, nowSec: number): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri, iat: nowSec, exp: nowSec + 3600 }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(sa.private_key).toString('base64url')}`;
}

let cached: { email: string; token: string; expiresAt: number } | null = null;

/** Test hook: forget the cached access token. */
export function resetFcmCache(): void {
  cached = null;
}

async function accessToken(sa: ServiceAccount, f: typeof fetch, now: number): Promise<string | null> {
  if (cached && cached.email === sa.client_email && cached.expiresAt - 300_000 > now) return cached.token;
  const res = await f(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signAssertion(sa, Math.floor(now / 1000)) }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const j = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
  if (!j || typeof j.access_token !== 'string') return null;
  const ttl = typeof j.expires_in === 'number' && j.expires_in > 0 ? j.expires_in : 3600;
  cached = { email: sa.client_email, token: j.access_token, expiresAt: now + ttl * 1000 };
  return j.access_token;
}

/** FCM's error code for a failed send: details[].errorCode (UNREGISTERED, INVALID_ARGUMENT, ...) or error.status. */
export function fcmErrorCode(body: unknown): string {
  const err = (body as { error?: { status?: unknown; details?: unknown } } | null)?.error;
  const details = Array.isArray(err?.details) ? (err!.details as { errorCode?: unknown }[]) : [];
  const fromDetails = details.map((d) => d?.errorCode).find((c): c is string => typeof c === 'string');
  return fromDetails ?? (typeof err?.status === 'string' ? err.status : 'UNKNOWN');
}

function hasFcmDetail(body: unknown): boolean {
  const details = (body as { error?: { details?: unknown } } | null)?.error?.details;
  return Array.isArray(details) && details.some((d) => String((d as { '@type'?: unknown } | null)?.['@type'] ?? '').endsWith('google.firebase.fcm.v1.FcmError'));
}

/** True when FCM's error details name the token field (google.rpc.BadRequest fieldViolations[].field = 'message.token'). */
export function namesTokenField(body: unknown): boolean {
  const details = (body as { error?: { details?: unknown } } | null)?.error?.details;
  if (!Array.isArray(details)) return false;
  return details.some((d) => {
    const v = (d as { fieldViolations?: unknown } | null)?.fieldViolations;
    return Array.isArray(v) && v.some((f) => (f as { field?: unknown } | null)?.field === 'message.token');
  });
}

/**
 * FCM's answer for a malformed registration token: INVALID_ARGUMENT whose only details are FcmError entries (no field violations) and
 * whose message names the registration token ("The registration token is not a valid FCM registration token"). Any other
 * INVALID_ARGUMENT (a payload problem: a bad data key, an APNs field) is not this. Pure.
 */
export function malformedTokenAnswer(body: unknown): boolean {
  const err = (body as { error?: { message?: unknown; details?: unknown } } | null)?.error;
  const details = Array.isArray(err?.details) ? (err!.details as unknown[]) : [];
  if (details.length === 0) return false;
  const onlyFcm = details.every((d) => String((d as { '@type'?: unknown } | null)?.['@type'] ?? '').endsWith('google.firebase.fcm.v1.FcmError'));
  return onlyFcm && typeof err?.message === 'string' && /\bregistration\s+token\b/i.test(err.message);
}

/**
 * What a failed send means for the device: 'dead' (disable the token), 'payload' (our request was wrong; disable nothing) or
 * 'error' (try again next time). Pure, exported for tests.
 */
export function classifyFcmError(status: number, body: unknown): 'dead' | 'payload' | 'error' {
  const code = fcmErrorCode(body);
  if (code === 'UNREGISTERED') return 'dead';
  // NOT_FOUND counts only with FCM's own error detail: a bare 404 (for example a wrong project id in the URL) is our mistake and must
  // not disable every device.
  if (code === 'NOT_FOUND') return hasFcmDetail(body) ? 'dead' : 'error';
  if (code === 'INVALID_ARGUMENT' || status === 400) return namesTokenField(body) || malformedTokenAnswer(body) ? 'dead' : 'payload';
  return 'error';
}

export function messageBody(m: PushMessage): unknown {
  return {
    message: {
      token: m.token,
      notification: { title: m.title, body: m.body },
      data: m.data,
      android: { priority: 'HIGH', notification: { channel_id: PUSH_CHANNEL_ID } },
      apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
    },
  };
}

export function isFcmConfigured(env: string | undefined = process.env.FIREBASE_SERVICE_ACCOUNT_JSON): boolean {
  return parseServiceAccount(env) !== null;
}

/** Sends one notification. Never throws. */
export async function sendPush(m: PushMessage, deps: FcmDeps = {}): Promise<SendResult> {
  const sa = parseServiceAccount('env' in deps ? deps.env : process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (!sa) return { ok: false, reason: 'not_configured' };
  const f = deps.fetch ?? fetch;
  const now = (deps.now ?? Date.now)();
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await accessToken(sa, f, now);
      if (!token) return { ok: false, reason: 'error', status: 0, code: 'AUTH_FAILED' };
      const res = await f(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(messageBody(m)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return { ok: true };
      const errBody = await res.json().catch(() => null);
      const code = fcmErrorCode(errBody);
      if (res.status === 401 && attempt === 0) {
        cached = null; // expired or revoked access token: mint a new one once
        continue;
      }
      const kind = classifyFcmError(res.status, errBody);
      if (kind === 'dead') return { ok: false, reason: 'dead', code };
      if (kind === 'payload') return { ok: false, reason: 'payload', code };
      return { ok: false, reason: 'error', status: res.status, code };
    }
    return { ok: false, reason: 'error', status: 401, code: 'UNAUTHENTICATED' };
  } catch (e) {
    return { ok: false, reason: 'error', status: 0, code: e instanceof Error && e.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK' };
  }
}
