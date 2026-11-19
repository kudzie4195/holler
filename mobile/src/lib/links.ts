// Which links the app will open. Pure.
//
// Only https: pages open (in the in-app browser). A mailto: opens only when the caller passes it as
// the support address and it is a single plain address. Everything else (javascript:, data:, http:,
// tel:, intent:, a custom scheme) is ignored.

export type LinkTarget = { kind: 'https'; url: string } | { kind: 'mailto'; url: string };

const MAILTO = /^mailto:[^\s?&,;:/<>"'()]+@[^\s?&,;:/<>"'()]+$/i;

export function linkTarget(url: unknown, opts: { supportMailto?: string | null } = {}): LinkTarget | null {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (!raw) return null;
  if (/^mailto:/i.test(raw)) {
    const support = opts.supportMailto?.trim();
    return support && raw === support && MAILTO.test(raw) ? { kind: 'mailto', url: raw } : null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname) return null;
  return { kind: 'https', url: parsed.toString() };
}
