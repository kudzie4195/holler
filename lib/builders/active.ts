import { cleanOrgName } from '@/lib/contacts/org';
import { PERMIT_DOING, PERMIT_KIND_LABELS, permitKindsFromTitle } from '@/lib/signals/opportunity';

/**
 * "Who's building near you": companies that pulled building permits in the last 30 days, from public permit records.
 * Pure and client-safe (no server imports). Companies only: rows that are not a contractor, have no name, or whose name does not
 * pass cleanOrgName (anything that looks like a person, a phone, an address) are dropped before grouping. No address and no person
 * name is ever returned.
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
  kinds: string[];
  newest: string;
  phone: string | null;
  relation: BuilderRelation;
}

const GENERAL_KINDS = new Set(['new-home', 'new-construction', 'addition', 'remodel', 'building', 'structural', 'fit-out']);
const KIND_LABEL = new Map(PERMIT_KIND_LABELS.map((k) => [k.id, k.label]));
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
  permits: Map<string, { ms: number; iso: string; title: string | null; categories: string[] }>;
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

const isAllCaps = (s: string): boolean => /\p{L}/u.test(s) && s === s.toUpperCase();

export function summarizeBuilders(rows: readonly BuilderRow[], memberTrades: readonly string[], now: Date = new Date()): ActiveBuilder[] {
  const nowMs = now.getTime();
  const cutoff = nowMs - BUILDER_WINDOW_DAYS * DAY_MS;
  const groups = new Map<string, Group>();
  let anon = 0;

  for (const r of rows ?? []) {
    if (!r || r.role !== 'contractor') continue;
    if (typeof r.name !== 'string' || !r.name.trim()) continue;
    const display = cleanOrgName(r.name);
    if (!display) continue;
    const ms = Date.parse(r.occurred_at);
    if (!Number.isFinite(ms) || ms < cutoff || ms > nowMs + DAY_MS) continue;
    const key = builderKey(display);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { names: new Map(), permits: new Map(), phone: null }));
    g.names.set(display, (g.names.get(display) ?? 0) + 1);
    const pid = r.signal_id != null ? `s${r.signal_id}` : `row${anon++}`;
    if (!g.permits.has(pid)) {
      g.permits.set(pid, { ms, iso: new Date(ms).toISOString(), title: r.title ?? null, categories: Array.isArray(r.categories) ? r.categories : [] });
    }
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
      const { kinds } = permitKindsFromTitle(p.title);
      for (const k of kinds) kindCounts.set(k, (kindCounts.get(k) ?? 0) + 1);
      // Same trade: a member trade does the work named by a trade-specific kind. General kinds and unparsed kinds grant nothing.
      if (!sameTrade && mine.size > 0) {
        for (const k of kinds) {
          if (GENERAL_KINDS.has(k)) continue;
          if ((PERMIT_DOING[k] ?? []).some((t) => mine.has(t))) sameTrade = true;
        }
      }
    }
    const kinds = [...kindCounts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, MAX_KIND_LABELS)
      .map(([k]) => KIND_LABEL.get(k) ?? k);
    const name = [...g.names.entries()].sort((a, b) => b[1] - a[1] || Number(isAllCaps(a[0])) - Number(isAllCaps(b[0])) || (a[0] < b[0] ? -1 : 1))[0][0];
    out.push({
      name,
      permits: permits.length,
      kinds,
      newest: newest.iso,
      phone: g.phone,
      relation: sameTrade ? 'same-trade' : 'other',
    });
  }

  out.sort((a, b) => b.permits - a.permits || (a.newest < b.newest ? 1 : a.newest > b.newest ? -1 : 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out.slice(0, MAX_BUILDERS);
}
