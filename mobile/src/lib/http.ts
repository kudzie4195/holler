// One HTTP function for the whole app, so the API client can be tested with a fake.
//
// On a phone the request goes through CapacitorHttp (the native networking stack): no CORS, no
// Origin header, which the website's own routes (email sign-up) need because they do not answer
// CORS. In a desktop browser (vite dev) it is plain fetch.
import { CapacitorHttp } from '@capacitor/core';
import { isNative } from './platform';
import { withTimeout } from './timeout';

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  /** Parsed JSON, or null when the body was empty or not JSON. */
  data: unknown;
}

export type HttpFn = (req: HttpRequest) => Promise<HttpResponse>;

const DEFAULT_TIMEOUT_MS = 20000;

function parseMaybeJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? null;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const nativeHttp: HttpFn = async (req) => {
  const res = await withTimeout(
    CapacitorHttp.request({
      method: req.method,
      url: req.url,
      headers: req.headers ?? {},
      data: req.body === undefined ? undefined : req.body,
      responseType: 'json',
      connectTimeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      readTimeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    }),
    (req.timeoutMs ?? DEFAULT_TIMEOUT_MS) + 2000,
    `${req.method} ${req.url}`,
  );
  return { status: res.status, data: parseMaybeJson(res.data) };
};

const webHttp: HttpFn = async (req) => {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: ctrl?.signal,
    });
    const text = await res.text();
    return { status: res.status, data: parseMaybeJson(text) };
  } finally {
    clearTimeout(timer);
  }
};

export function defaultHttp(): HttpFn {
  return isNative() ? nativeHttp : webHttp;
}
