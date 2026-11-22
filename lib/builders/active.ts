import { cleanOrgName, isOrganisationName } from '@/lib/contacts/org';
import { GENERIC_LABELS, KIND_DOERS, permitLabelsOf } from '@/lib/signals/permit-routing';

/**
 * "Who's building near you": companies that pulled building permits in the last 30 days, from public permit records (ported in round 19
 * UNIFY from origin/r10-integrate 9de8594 and 0cd8361, adapted to this base).
 *
 * Pure and client-safe (no server imports). Businesses only: a row is dropped before grouping unless its role is 'contractor', its name
 * passes this base's organisation check exactly (lib/contacts/org.ts isOrganisationName, the same rule lib/outreach/loader.ts applies to
 * every contractor name a member sees) and cleanOrgName leaves a printable name. No address, no person, no website is ever returned.
 *
 * Adapted from the other branch: their permit kinds came from lib/signals/opportunity.ts (PERMIT_KIND_LABELS, PERMIT_DOING,
 * permitKindsFromTitle). This base reads the same thing from lib/signals/permit-routing.ts: permitLabelsOf (the work-kind labels a typed
 * permit title names, lowercased English: 'roof', 'hvac', 'new home') and KIND_DOERS (the trades that do that work). `kinds` are returned
 * as those label keys; the component prints them through lib/signals/title-i18n.ts permitLabelLang in the member's language.
 *
 * "Works in your trade" (relation 'same-trade') comes only from a trade-specific kind on the permit TITLE whose doers include one of the
 * member's trades. General kinds (new home, new construction and this base's GENERIC_LABELS: remodel, addition, building ...) grant
 * nothing, so a general contractor is never told a house builder "works in your trade", and a trade tag on the record grants nothing.
 * This is a read-only panel: it creates no card, no match and no alert.
 */

export const BUILDER_WINDOW_DAYS = 30;
export const MAX_BUILDERS = 15;
const MAX_KIND_LABELS = 3;
const DAY_MS = 86_400_000;

export type BuilderRelation = 'same-trade' | 'other';

/** One permit/contact pair as read by lib/builders/load.ts (signal fields joined to a holler_signal_contacts row). */
export interface BuilderRow {
  /** holler_signals.id. When present, one permit counts once per builder even if the builder has several contact rows on it. */
  signal_id?: number | null;
  title: string | null;
  occurred_at: string;
  categories?: string[] | null;
  role: string | null;
  name: string | null;
  phone?: string | null;
}

export interface ActiveBuilder {
  name: string;
  permits: number;
  /** Work-kind label keys from the permit titles (lowercased English, e.g. 'roof', 'hvac'), most frequent first, at most 3. */
  kinds: string[];
  newest: string;
  phone: string | null;
  relation: BuilderRelation;
}

/** Kinds that name no particular trade: they never make a company "work in your trade". */
const GENERAL_KINDS: ReadonlySet<string> = new Set(['new home', 'new construction', ...GENERIC_LABELS]);
const LEGAL_FORMS = new Set(['inc', 'llc', 'co', 'corp', 'company', 'ltd', 'lp', 'incorporated', 'corporation', 'pllc', 'llp', 'pc', 'limited']);

/** Grouping key: case, punctuation, extra spaces and trailing legal forms ignored. Empty string when nothing is left. */
export function builderKey(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  while (words.length > 1 && LEGAL_FORMS.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

interface Group {
  names: Map<string, number>;
  permits: Map<string, { ms: number; iso: string; title: string | null }>;
  phone: string | null;
}

/** A phone is shown only with at least 7 digits. */
const usablePhone = (v: string | null | undefined): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.replace(/\D/g, '').length >= 7 ? t : null;
};

/** tel: href for a phone: digits and a leading + only. Null when the phone has fewer than 7 digits. */
export function telHref(phone: string | null | undefined): string | null {
  const t = usablePhone(phone);
  return t ? `${t.startsWith('+') ? '+' : ''}${t.replace(/\D/g, '')}` : null;
}

/** The company name to print, or null: businesses only (this base's organisation check, exact pass). */
export function builderName(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  if (!isOrganisationName(raw)) return null;
  return cleanOrgName(raw);
}

const isAllCaps = (s: string): boolean => /\p{L}/u.test(s) && s === s.toUpperCase();

export function summarizeBuilders(rows: readonly BuilderRow[], memberTrades: readonly string[], now: Date = new Date()): ActiveBuilder[] {
  const nowMs = now.getTime();
  const cutoff = nowMs - BUILDER_WINDOW_DAYS * DAY_MS;
  const groups = new Map<string, Group>();
  let anon = 0;

  for (const r of rows ?? []) {
    if (!r || r.role !== 'contractor') continue;
    const display = builderName(r.name);
    if (!display) continue;
    const ms = Date.parse(r.occurred_at);
    if (!Number.isFinite(ms) || ms < cutoff || ms > nowMs + DAY_MS) continue;
    const key = builderKey(display);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { names: new Map(), permits: new Map(), phone: null }));
    g.names.set(display, (g.names.get(display) ?? 0) + 1);
    const pid = r.signal_id != null ? `s${r.signal_id}` : `row${anon++}`;
    if (!g.permits.has(pid)) g.permits.set(pid, { ms, iso: new Date(ms).toISOString(), title: r.title ?? null });
    g.phone ??= usablePhone(r.phone);
  }

  const out: ActiveBuilder[] = [];
  const mine = new Set(memberTrades);
  for (const g of groups.values()) {
    const permits = [...g.permits.values()];
    const kindCounts = new Map<string, number>();
    let sameTrade = false;
    let newest = permits[0];
    for (const p of permits) {
      if (p.ms > newest.ms) newest = p;
      const kinds = [...new Set(permitLabelsOf(p.title) ?? [])];
      for (const k of kinds) kindCounts.set(k, (kindCounts.get(k) ?? 0) + 1);
      // Same trade: a member trade does the work named by a trade-specific kind. General kinds and unparsed titles grant nothing.
      if (!sameTrade && mine.size > 0) {
        for (const k of kinds) {
          if (GENERAL_KINDS.has(k)) continue;
          if ((KIND_DOERS[k] ?? []).some((t) => mine.has(t))) sameTrade = true;
        }
      }
    }
    const kinds = [...kindCounts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, MAX_KIND_LABELS)
      .map(([k]) => k);
    const name = [...g.names.entries()].sort((a, b) => b[1] - a[1] || Number(isAllCaps(a[0])) - Number(isAllCaps(b[0])) || (a[0] < b[0] ? -1 : 1))[0][0];
    out.push({ name, permits: permits.length, kinds, newest: newest.iso, phone: g.phone, relation: sameTrade ? 'same-trade' : 'other' });
  }

  out.sort((a, b) => b.permits - a.permits || (a.newest < b.newest ? 1 : a.newest > b.newest ? -1 : 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out.slice(0, MAX_BUILDERS);
}
