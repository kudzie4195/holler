/**
 * Did a model call fail BEFORE any response arrived (so nothing was billed)? Commander decision 5, verify-v1 finding 11.
 * Only two shapes count, anywhere in the error's cause chain (cause, RetryError.lastError / errors, up to 6 levels):
 *  - an API call error with an HTTP error status (the provider or gateway answered 4xx / 5xx instead of running the model). The AI
 *    Gateway wraps such an answer in a GatewayError whose cause is that API call error;
 *  - a connection error (no connection, DNS failure, connection reset, "fetch failed", "Cannot connect to API").
 * Everything else (an empty or invalid response body, a JSON or schema error, an unknown error) may come after the provider answered
 * and billed: the caller keeps the reserved amount. Duck-typed, so this file imports nothing from the `ai` package.
 */
const CONNECTION_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
]);
const CONNECTION_MESSAGE = /fetch failed|cannot connect to api|socket hang up|getaddrinfo|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN/i;

interface ErrLike {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  statusCode?: unknown;
  cause?: unknown;
  lastError?: unknown;
  errors?: unknown;
}

function chain(e: unknown): ErrLike[] {
  const out: ErrLike[] = [];
  const seen = new Set<unknown>();
  const walk = (x: unknown, depth: number) => {
    if (!x || typeof x !== 'object' || seen.has(x) || depth > 6) return;
    seen.add(x);
    const n = x as ErrLike;
    out.push(n);
    walk(n.cause, depth + 1);
    walk(n.lastError, depth + 1);
    if (Array.isArray(n.errors)) for (const y of n.errors) walk(y, depth + 1);
  };
  walk(e, 0);
  return out;
}

const isApiCallError = (n: ErrLike) => typeof n.name === 'string' && /APICallError$/.test(n.name);

export function failedBeforeResponse(e: unknown): boolean {
  for (const n of chain(e)) {
    if (isApiCallError(n) && typeof n.statusCode === 'number' && n.statusCode >= 400 && n.statusCode < 600) return true;
    if (typeof n.code === 'string' && CONNECTION_CODES.has(n.code)) return true;
    if (typeof n.message === 'string' && CONNECTION_MESSAGE.test(n.message)) return true;
  }
  return false;
}
