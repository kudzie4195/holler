/**
 * A fake plugin shaped like a real Capacitor plugin: a Proxy that answers EVERY property name,
 * `then` included, with a function. Returning one from an async function hangs forever, exactly as
 * on a phone (see @capacitor/core registerPlugin). Implemented methods come from `impl`.
 */
export function capacitorProxy<T extends Record<string, unknown>>(impl: T): T {
  return new Proxy({} as T, {
    get(_, prop) {
      if (prop === '$$typeof') return undefined;
      if (prop === 'toJSON') return () => ({});
      if (typeof prop === 'string' && prop in impl) return impl[prop];
      // Unimplemented method: like Capacitor, returns a rejected promise and never calls back arguments.
      return () => Promise.reject(new Error(`"${String(prop)}" is not implemented`));
    },
  });
}

/** Fail a test instead of hanging when a promise never settles. */
export function settlesWithin<T>(p: Promise<T>, ms = 1000): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`did not settle within ${ms} ms`)), ms))]);
}
