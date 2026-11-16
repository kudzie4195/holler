import { createHash } from 'node:crypto';
/** First entry of x-forwarded-for (the client as seen by the edge), else x-real-ip, else 'unknown'. */
export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  if (first) return first.slice(0, 64);
  const real = request.headers.get('x-real-ip')?.trim();
  return real ? real.slice(0, 64) : 'unknown';
}

/** Keys never hold raw emails or IPs; the table is service-only but still a place PII should not sit. */
export function rateKey(scope: string, kind: 'ip' | 'email' | 'user', value: string): string {
  const digest = createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 32);
  return `${scope}:${kind}:${digest}`;
}

export interface Limit {
  key: string;
  max: number;
  windowSeconds: number;
}

export const LIMITS = {
  signupIp: (ip: string): Limit => ({ key: rateKey('signup', 'ip', ip), max: 5, windowSeconds: 3600 }),
  signupEmail: (email: string): Limit => ({ key: rateKey('signup', 'email', email), max: 3, windowSeconds: 86_400 }),
  forgotEmail: (email: string): Limit => ({ key: rateKey('forgot', 'email', email), max: 3, windowSeconds: 3600 }),
  forgotIp: (ip: string): Limit => ({ key: rateKey('forgot', 'ip', ip), max: 10, windowSeconds: 3600 }),
  loginIp: (ip: string): Limit => ({ key: rateKey('login', 'ip', ip), max: 20, windowSeconds: 900 }),
  verifyResendUser: (userId: string): Limit => ({ key: rateKey('verify', 'user', userId), max: 3, windowSeconds: 3600 }),
} as const;

export const RATE_LIMIT_MESSAGE = 'Too many tries. Wait a bit, then try again.';
