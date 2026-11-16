/**
 * Login-CSRF guard for form POSTs that sign someone in (/auth/confirm): when the browser sends an Origin
 * header it must match this site. A missing Origin (some privacy settings, non-browser clients) is allowed;
 * the token in the body is still required.
 */
export function originAllowed(request: Request, siteUrl: string): boolean {
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return origin !== 'null';
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const hosts = new Set<string>();
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (host) hosts.add(host.split(',')[0].trim());
  try {
    hosts.add(new URL(siteUrl).host);
  } catch {
    // siteUrl is validated elsewhere
  }
  return hosts.has(originHost);
}
