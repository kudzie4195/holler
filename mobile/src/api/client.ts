// The Holler API client: every call the app makes to https://localholler.com/api/m/*.
//
// Errors are thrown as ApiCallError with the server's code and its message (already safe to show).
// A 401 on a member call refreshes the Supabase session once and retries. onUnauthorized (the app
// signs out) runs only on a definite auth failure; being offline is a 'network' error, never a sign-out.
import type {
  AlertResponse,
  ApiErrorCode,
  CheckResponse,
  ConfigResponse,
  DeleteAccountResponse,
  FeedResponse,
  FeedbackInput,
  FeedbackResponse,
  MeResponse,
  ProfileField,
  ProfileInput,
  PushRegisterInput,
} from '../contract';
import type { HttpFn, HttpRequest } from '../lib/http';

export type ClientErrorCode = ApiErrorCode | 'network' | 'bad_response';

export class ApiCallError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  readonly fieldErrors: Partial<Record<ProfileField, string>>;
  constructor(code: ClientErrorCode, message: string, status: number, fieldErrors?: Partial<Record<ProfileField, string>>) {
    super(message);
    this.name = 'ApiCallError';
    this.code = code;
    this.status = status;
    this.fieldErrors = fieldErrors ?? {};
  }
}

export const NETWORK_MESSAGE = "We couldn't reach Holler. Check your connection and try again.";
export const SERVER_MESSAGE = 'Something went wrong on our side. Try again in a moment.';

export interface ApiClientOptions {
  baseUrl: string;
  http: HttpFn;
  /** The current Supabase access token, null only when signed out for certain. Throws when offline. */
  getToken: () => Promise<string | null>;
  /** Refresh the session: the new access token, null only when Supabase rejected the refresh token. Throws when offline. */
  refresh: () => Promise<string | null>;
  /** Called on a definite auth failure: no session stored, the refresh token rejected, or a fresh token still refused. */
  onUnauthorized?: () => void;
}

const STATUS_CODE: Record<number, ApiErrorCode> = {
  400: 'invalid',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'needs_onboarding',
  415: 'unsupported',
  429: 'rate_limited',
  503: 'not_configured',
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Turn any response into the typed success body, or throw ApiCallError. Exported for tests. */
export function readResult<T>(status: number, data: unknown): T & { ok: true } {
  if (isObject(data) && data.ok === true && status >= 200 && status < 300) return data as T & { ok: true };
  if (isObject(data) && data.ok === false) {
    const code = (typeof data.error === 'string' ? data.error : STATUS_CODE[status] ?? 'server_error') as ApiErrorCode;
    const message = typeof data.message === 'string' && data.message ? data.message : SERVER_MESSAGE;
    // 503 `unavailable`: the server could not check the token because the sign-in service is busy or down. That is a passing
    // network-type failure: keep the session, let the member try again, never sign out.
    if (code === 'unavailable') throw new ApiCallError('network', message, status);
    const fieldErrors = isObject(data.fieldErrors) ? (data.fieldErrors as Partial<Record<ProfileField, string>>) : undefined;
    throw new ApiCallError(code, message, status, fieldErrors);
  }
  if (status >= 500 || status === 0) throw new ApiCallError('server_error', SERVER_MESSAGE, status);
  const code = STATUS_CODE[status];
  if (code) throw new ApiCallError(code, SERVER_MESSAGE, status);
  throw new ApiCallError('bad_response', SERVER_MESSAGE, status);
}

function asNetworkError(e: unknown): ApiCallError {
  return e instanceof ApiCallError ? e : new ApiCallError('network', NETWORK_MESSAGE, 0);
}

export function createApiClient(opts: ApiClientOptions) {
  const base = opts.baseUrl.replace(/\/+$/, '');

  async function send<T>(req: Omit<HttpRequest, 'url'> & { path: string }, auth: boolean): Promise<T & { ok: true }> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (req.body !== undefined) headers['Content-Type'] = 'application/json';

    const attempt = async (token: string | null) => {
      const h = { ...headers };
      if (token) h.Authorization = `Bearer ${token}`;
      try {
        return await opts.http({ method: req.method, url: `${base}${req.path}`, headers: h, body: req.body, timeoutMs: req.timeoutMs });
      } catch {
        throw new ApiCallError('network', NETWORK_MESSAGE, 0);
      }
    };

    if (!auth) {
      const res = await attempt(null);
      return readResult<T>(res.status, res.data);
    }

    // getToken and refresh throw (as 'network') when they cannot tell because the phone is offline or
    // Supabase Auth answered 429 / 5xx. Only a definite answer (null) signs the member out.
    const token = await opts.getToken().catch((e) => {
      throw asNetworkError(e);
    });
    if (!token) {
      opts.onUnauthorized?.();
      throw new ApiCallError('unauthorized', 'Please sign in again.', 401);
    }
    let res = await attempt(token);
    if (res.status === 401) {
      const fresh = await opts.refresh().catch((e) => {
        throw asNetworkError(e);
      });
      if (!fresh) {
        opts.onUnauthorized?.();
        throw new ApiCallError('unauthorized', 'Please sign in again.', 401);
      }
      res = await attempt(fresh);
      if (res.status === 401) {
        // A token Supabase has just issued is still refused: the account is gone or blocked.
        opts.onUnauthorized?.();
        throw new ApiCallError('unauthorized', 'Please sign in again.', 401);
      }
    }
    return readResult<T>(res.status, res.data);
  }

  return {
    config: () => send<ConfigResponse>({ method: 'GET', path: '/api/m/config' }, false),
    me: () => send<MeResponse>({ method: 'GET', path: '/api/m/me' }, true),
    onboarding: (input: ProfileInput) =>
      send<MeResponse>({ method: 'POST', path: '/api/m/onboarding', body: input, timeoutMs: 45000 }, true),
    updateProfile: (input: ProfileInput) => send<MeResponse>({ method: 'PATCH', path: '/api/m/profile', body: input }, true),
    feed: (cursor?: string | null) =>
      send<FeedResponse>({ method: 'GET', path: `/api/m/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}` }, true),
    alert: (signalId: number) => send<AlertResponse>({ method: 'GET', path: `/api/m/alert/${encodeURIComponent(String(signalId))}` }, true),
    feedback: (input: FeedbackInput) => send<FeedbackResponse>({ method: 'POST', path: '/api/m/feedback', body: input }, true),
    check: (zip: string, trade: string) =>
      send<CheckResponse>(
        { method: 'GET', path: `/api/m/check?zip=${encodeURIComponent(zip)}&trade=${encodeURIComponent(trade)}` },
        false,
      ),
    registerPush: (input: PushRegisterInput) =>
      send<{ ok: true }>({ method: 'POST', path: '/api/m/push/register', body: input }, true),
    unregisterPush: (token: string) =>
      send<{ ok: true }>({ method: 'DELETE', path: '/api/m/push/register', body: { token } }, true),
    deleteAccount: () =>
      send<DeleteAccountResponse>({ method: 'POST', path: '/api/m/account/delete', body: { confirm: 'DELETE' }, timeoutMs: 45000 }, true),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
