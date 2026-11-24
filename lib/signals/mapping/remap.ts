import type { SupabaseClient } from '@supabase/supabase-js';
import type { CategoryId } from '@/lib/signals/categories';
import { isCategoryId } from '@/lib/signals/categories';
import { categorize } from '@/lib/signals/adapters/socrata';
import { civicLabel } from '@/lib/signals/adapters/permit-privacy';
import { CAT_V, REMAP_SUBTYPES } from './version';
import { normalizeWorkText } from './permit';
import { KIND_FOR_CATEGORY, NO_TRADE_WORK_TYPES, NO_TRADE_WORK_TYPE_RE, PERMIT_KINDS, classFromKinds, classifyPermit, permitTitleFor } from './permit';
import { pruneStaleMatches, rematchSignals, type PruneResult, type RematchResult } from '@/lib/signals/rematch';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { loadProfiles } from '@/lib/signals/store';
import type { MatchProfile } from '@/lib/signals/match';

type Db = Pick<SupabaseClient, 'from'>;

export const REMAP_DAYS = 14;
export const REMAP_BATCH = 100;
export const REMAP_MAX_BATCHES = 10;
const UPDATE_CONCURRENCY = 10;

export interface StoredRuleRow {
  id: number;
  source: string;
  title: string;
  summary: string | null;
  city: string | null;
  categories: string[] | null;
  data: Record<string, unknown> | null;
}

export interface Remapped {
  categories: CategoryId[];
  title: string;
  data: Record<string, unknown>;
  /** true when categories or title differ from the stored row (a stamp-only update is false). */
  changed: boolean;
  /** Trades the row carries now and did not before. Only these can create matches (quietly). */
  gained: CategoryId[];
  /** Trades the row carried and no longer does. Untouched matches that relied on them are removed (pruneStaleMatches). */
  lost: CategoryId[];
}

/** Summary parts that are not type vocabulary: a street address, a money amount, a ZIP, a status word. */
function isNoisePart(p: string): boolean {
  return /^\s*\d/.test(p) || /\bjob value\b|\bblock of\b|\b\d{5}\b/i.test(p) || /^\s*(?:issued|finaled|final|active|open|closed|approved|expired|complete[d]?)\s*$/i.test(p);
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Re-derive a stored permit's trades and title from what the row still holds: its summary, which carries the dataset's type, class and
 * use columns (the raw description was never stored). When those name a specific kind of work they decide, as at ingest. When they
 * do not (the old trades came from a description), the old trades are kept, minus the round 6 fan-out (cleaning, and landscaping that
 * came with new construction), and the title is rebuilt from them so it names what the row carries.
 */
export function remapPermitRow(row: StoredRuleRow): { categories: CategoryId[]; label: string | null } | null {
  const city = row.city ?? '';
  const parts = (row.summary ?? '').split(' | ').map((p) => p.trim()).filter((p) => p && !isNoisePart(p));
  // A paperwork or temporary-protection work type (sidewalk shed, site-safety plan, fire sprinklers): no trade work, whatever the old tags say.
  if (parts.some((v) => NO_TRADE_WORK_TYPE_RE.test(normalizeWorkText(v)))) return { categories: [], label: null };
  const fromSummary = classifyPermit({ structured: parts, source: row.source }, city);
  const specific = fromSummary.kinds.some((id) => !PERMIT_KINDS.find((k) => k.id === id)?.generic);
  if (specific) return { categories: fromSummary.categories, label: fromSummary.label };

  const old = (row.categories ?? []).filter(isCategoryId) as CategoryId[];
  const fanOut = old.includes('general-contractor') && old.includes('landscaping') && old.includes('cleaning');
  // Round 6 added hvac to a water heater permit through the keyword "heater". Its stored title then names plumbing or a water heater
  // and not HVAC (an HVAC record would have been titled HVAC first). Such hvac is dropped, never promoted into the title.
  const titleLabel = row.title.replace(/\s+permit in .*$/i, '');
  const heaterArtefact =
    old.includes('hvac') && old.includes('plumbing') && /\b(?:plumbing|water heater)\b/i.test(titleLabel) && !/\bhvac\b/i.test(titleLabel);
  const kinds = new Set<string>();
  for (const c of old) {
    if (c === 'cleaning') continue;
    if (c === 'landscaping' && fanOut) continue;
    if (c === 'hvac' && heaterArtefact) continue;
    const k = KIND_FOR_CATEGORY[c];
    if (k) kinds.add(k);
  }
  // An addition or alteration is not a new building: the old real-estate and moving tags came from a description read as a new dwelling.
  if (old.includes('real-estate') && old.includes('moving') && !fromSummary.kinds.some((id) => id === 'addition' || id === 'remodel')) kinds.add('new-home');
  // A generic word from the summary names the general contractor work better than "Building".
  const genericFromSummary = fromSummary.kinds[0];
  if (kinds.has('building') && genericFromSummary) {
    kinds.delete('building');
    kinds.add(genericFromSummary);
  }
  // Named trades from a description do not carry a city's catch-all type with them (same rule as at ingest).
  const hasSpecific = [...kinds].some((id) => !PERMIT_KINDS.find((k) => k.id === id)?.generic);
  if (hasSpecific) for (const id of [...kinds]) if (PERMIT_KINDS.find((k) => k.id === id)?.generic) kinds.delete(id);
  if (kinds.size === 0) {
    return fromSummary.categories.length ? { categories: fromSummary.categories, label: fromSummary.label } : null;
  }
  const c = classFromKinds([...kinds], city);
  return c.categories.length ? { categories: c.categories, label: c.label } : null;
}

type ViolationConfig = { id: string; subtype: string; titleFields: string[]; textFields: string[]; summaryFields: string[]; freeTextFields?: string[] };
const VIOLATION_CONFIGS: Map<string, ViolationConfig> = new Map(
  [...SOCRATA_DATASETS, ...ARCGIS_DATASETS].filter((d) => d.subtype === 'violation').map((d) => [d.id, d as ViolationConfig]),
);

/**
 * The stored text of a code violation that came from the dataset's classified fields (textFields), and nothing else: never the block
 * address, the status or any column the ingest did not classify. The title holds the first title field (when it is a text field);
 * the first summary part is used only when it is that same value (it can be longer than the title's 110 characters). Empty when the
 * row holds none of it (DeKalb: no title field, and its summary is only the address).
 */
export function violationClassifiedText(row: Pick<StoredRuleRow, 'source' | 'title' | 'summary'>): string {
  const ds = VIOLATION_CONFIGS.get(row.source);
  if (!ds) return '';
  const firstTitleField = ds.titleFields[0];
  if (!firstTitleField || !ds.textFields.includes(firstTitleField)) return '';
  const fromTitle = row.title.includes(': ') ? row.title.slice(row.title.indexOf(': ') + 2).trim() : '';
  if (!fromTitle) return '';
  const stem = fromTitle.replace(/\.\.\.$/, '').trim().toLowerCase();
  const first = (row.summary ?? '').split(' | ')[0]?.trim() ?? '';
  const sameValue = ds.summaryFields[0] === firstTitleField && first.toLowerCase().startsWith(stem) && !isNoisePart(first);
  return sameValue ? first : fromTitle;
}

/**
 * The exact text the ingest classified for this code violation (categorize(ds, textFields joined)), or null when the stored row does not
 * hold all of it (commander decision 3, verify-v1 finding 3). Recoverable only when the dataset classifies ONE column, that column is the
 * title field, it is not a free-text column (never printed), and the stored title is that value and not the fixed fallback words
 * (civicLabel) used when the value was withheld. Austin classifies description AND case_type, and DeKalb has no title field: null, so
 * the re-map never changes their trades and never drops one the ingest assigned.
 */
export function violationIngestText(row: Pick<StoredRuleRow, 'source' | 'title' | 'summary' | 'categories'>): string | null {
  const ds = VIOLATION_CONFIGS.get(row.source);
  if (!ds) return null;
  const field = ds.titleFields[0];
  if (!field || ds.textFields.length !== 1 || ds.textFields[0] !== field) return null;
  if ((ds.freeTextFields ?? []).includes(field)) return null;
  const text = violationClassifiedText(row);
  if (!text) return null;
  const fromTitle = row.title.includes(': ') ? row.title.slice(row.title.indexOf(': ') + 2).trim() : '';
  const old = (row.categories ?? []).filter(isCategoryId);
  if (fromTitle === 'property violation' || fromTitle === civicLabel(old, 'property violation')) return null;
  return text;
}

/**
 * The version 3 delta for a row stored at version 2, and nothing else:
 *  - permit: a structured work type that is paperwork or temporary protection (NO_TRADE_WORK_TYPES: sidewalk shed, scaffold, site-safety
 *    plan, fire sprinklers, curb cut) holds no trade work. The row loses its trades and its title becomes the typeless "Permit in <city>".
 *    These rows were tagged from a description of the building's other work (a fire-sprinkler job titled "Landscaping"). The proof is the
 *    work type text still stored in the summary. Every other permit keeps its title and trades exactly.
 *  - violation: the keyword classifier no longer tags code violations (a gutter order is not roofing). Where the stored title holds all
 *    of the text the ingest classified, the explicit violation rules decide, as at ingest; elsewhere the trades stay as stored.
 * Anything this changes is recorded in data.cat_prev ({ v, title, categories }) first.
 */
function remapFromV2(row: StoredRuleRow, data: Record<string, unknown>, subtype: string, old: CategoryId[]): Remapped | null {
  let categories = old;
  let title = row.title;
  if (subtype === 'permit') {
    const parts = (row.summary ?? '').split(' | ').map((p) => p.trim()).filter((p) => p && !isNoisePart(p));
    if (parts.some((p) => NO_TRADE_WORK_TYPE_RE.test(normalizeWorkText(p)))) {
      categories = [];
      title = permitTitleFor(row.city ?? '', null);
    }
  } else if (subtype === 'violation') {
    const text = violationIngestText(row);
    if (text) {
      const r = categorize({ subtype: 'violation' }, text);
      if (r.categories.length) categories = r.categories;
    }
  } else {
    return null;
  }
  const gained = categories.filter((c) => !old.includes(c));
  const lost = old.filter((c) => !categories.includes(c));
  const changed = !sameSet(categories, old) || title !== row.title;
  const prev = changed && !data.cat_prev ? { cat_prev: { v: 2, title: row.title, categories: old } } : {};
  return { categories, title, data: { ...data, ...prev, cat_v: CAT_V }, changed, gained, lost };
}

/**
 * The PostgREST filter for the rows the re-map reads: no version, version 1 (full re-map), or version 2 and only when the version 3 delta can
 * apply (a violation, or a permit whose summary names a no-trade work type). The other version 2 rows are never read or written.
 */
export function remapVersionFilter(): string {
  const words = NO_TRADE_WORK_TYPES.map((w) => `summary.ilike.*${w}*`).join(',');
  return `data->>cat_v.is.null,data->>cat_v.eq.1,and(data->>cat_v.eq.2,or(data->>subtype.eq.violation,${words}))`;
}

/** Re-map one stored rule-based row. Returns null when it is not a row this pass handles (AI-set, other subtype, newer version). */
export function remapRow(row: StoredRuleRow): Remapped | null {
  const data = (row.data && typeof row.data === 'object' ? row.data : {}) as Record<string, unknown>;
  if (data.cat_src === 'ai') return null;
  const v = Number(data.cat_v);
  if (Number.isFinite(v) && v >= CAT_V) return null;
  const subtype = typeof data.subtype === 'string' ? data.subtype : '';
  const old = (row.categories ?? []).filter(isCategoryId) as CategoryId[];
  // A row written at version 2 already went through the full mapping at ingest, from description fields the database does not keep. The
  // summary-only re-derivation below was written for version 1 rows and would degrade it (round 15 review P0: 11.5% of titles). A v2 row
  // gets ONLY the specific changes version 3 made, and the row it replaces is kept in data.cat_prev so the write can be undone.
  if (v === 2) return remapFromV2(row, data, subtype, old);
  let categories = old;
  let title = row.title;
  if (subtype === 'permit') {
    const r = remapPermitRow(row);
    if (r) {
      categories = r.categories;
      title = permitTitleFor(row.city ?? '', r.label);
    }
  } else if (subtype === 'violation') {
    // Exactly the ingest's inputs, never the address (review r1: "1200 PINE TREE LN" added tree-service). When the row does not hold
    // all of them (Austin's case_type) the trades stay as the ingest set them (verify-v1 decision 3).
    const text = violationIngestText(row);
    if (text) {
      const r = categorize({ subtype: 'violation' }, text);
      if (r.categories.length) categories = r.categories;
    }
  } else {
    return null;
  }
  const gained = categories.filter((c) => !old.includes(c));
  const lost = old.filter((c) => !categories.includes(c));
  const changed = !sameSet(categories, old) || title !== row.title;
  // What the row held before is kept, so the write can be undone (round 15 review P0: titles were rewritten with no copy of the original).
  const prev = changed && !data.cat_prev ? { cat_prev: { v: Number.isFinite(v) ? v : 1, title: row.title, categories: old } } : {};
  return { categories, title, data: { ...data, ...prev, cat_v: CAT_V }, changed, gained, lost };
}

export interface RemapReport {
  scanned: number;
  updated: number;
  changed: number;
  rematched: number;
  /** Untouched matches removed because the record lost the trade they relied on. */
  pruned: number;
  batches: number;
  /** true when the last batch came back short (nothing older left for now). */
  done: boolean;
  error?: string;
}

export interface RemapOptions {
  now?: Date;
  /** Checked before every batch; return false to stop (the scan's time budget). */
  shouldContinue?: () => boolean;
  batchSize?: number;
  maxBatches?: number;
  /** Test hook. Defaults to rematchSignals with the profiles loaded once for the whole pass. */
  rematch?: (ids: number[]) => Promise<RematchResult>;
  /** Test hook. Defaults to pruneStaleMatches with the same profiles. */
  prune?: (ids: number[]) => Promise<PruneResult>;
  log?: (m: string) => void;
}

/**
 * Scan-time re-map of stored rows written under an older mapping version (data.cat_v missing or older), from the last 14 days, for the
 * subtypes whose mapping changed (REMAP_SUBTYPES), skipping rows the AI step categorised (data.cat_src = 'ai'). Small batches (100
 * rows), checked against the scan's time budget before each one, at most 10 per scan. Every handled row is stamped with the current
 * cat_v. A title-only change updates the row and creates no match. Only a row that GAINED a trade is rematched, and those matches are
 * inserted already notified and pushed (history in the feed, no email, no push). A row that LOST a trade has its untouched matches
 * (status new, no draft, not emailed, not pushed, no feedback) checked again and removed when the member no longer matches. Never throws.
 */
export async function remapStoredSignals(db: Db, opts: RemapOptions = {}): Promise<RemapReport> {
  const now = opts.now ?? new Date();
  const batchSize = opts.batchSize ?? REMAP_BATCH;
  const maxBatches = opts.maxBatches ?? REMAP_MAX_BATCHES;
  const shouldContinue = opts.shouldContinue ?? (() => true);
  const report: RemapReport = { scanned: 0, updated: 0, changed: 0, rematched: 0, pruned: 0, batches: 0, done: false };
  const since = new Date(now.getTime() - REMAP_DAYS * 86_400_000).toISOString();
  let profiles: Promise<MatchProfile[]> | null = null;
  const loadOnce = () => (profiles ??= loadProfiles(db as never, now));
  const rematch =
    opts.rematch ??
    ((ids: number[]) => rematchSignals(db as never, ids, { now, profiles: loadOnce, log: opts.log, quiet: true }));
  const prune = opts.prune ?? ((ids: number[]) => pruneStaleMatches(db as never, ids, { now, profiles: loadOnce, log: opts.log }));
  const versionFilter = remapVersionFilter();
  let afterId = 0;
  try {
    while (report.batches < maxBatches && shouldContinue()) {
      const { data, error } = await db
        .from('holler_signals')
        .select('id,source,title,summary,city,categories,data')
        .gte('occurred_at', since)
        .gt('id', afterId)
        .in('data->>subtype', [...REMAP_SUBTYPES])
        .or('source.like.socrata-*,source.like.arcgis-*')
        .or(versionFilter)
        .or('data->>cat_src.is.null,data->>cat_src.neq.ai')
        .order('id', { ascending: true })
        .limit(batchSize);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as StoredRuleRow[];
      report.batches++;
      report.scanned += rows.length;
      if (rows.length === 0) {
        report.done = true;
        break;
      }
      afterId = rows[rows.length - 1].id;
      const work = rows.map((r) => ({ r, m: remapRow(r) })).filter((x): x is { r: StoredRuleRow; m: Remapped } => x.m !== null);
      const gainedIds: number[] = [];
      const lostIds: number[] = [];
      for (let i = 0; i < work.length; i += UPDATE_CONCURRENCY) {
        const results = await Promise.all(
          work.slice(i, i + UPDATE_CONCURRENCY).map(async ({ r, m }) => {
            const patch: Record<string, unknown> = { data: m.data };
            if (m.changed) {
              patch.categories = m.categories;
              patch.title = m.title;
            }
            const { error: uErr } = await db.from('holler_signals').update(patch).eq('id', r.id);
            return { id: r.id, ok: !uErr, changed: m.changed, gained: m.gained.length > 0, lost: m.lost.length > 0, err: uErr?.message };
          }),
        );
        for (const x of results) {
          if (!x.ok) {
            (opts.log ?? console.error)(`remap: update of signal ${x.id} failed: ${x.err ?? 'unknown'}`);
            continue;
          }
          report.updated++;
          if (x.changed) report.changed++;
          if (x.gained) gainedIds.push(x.id);
          if (x.lost) lostIds.push(x.id);
        }
      }
      if (lostIds.length) {
        const p = await prune(lostIds);
        report.pruned += p.removed;
        if (p.error) report.error = p.error;
      }
      if (gainedIds.length) {
        const r = await rematch(gainedIds);
        report.rematched += r.created;
        if (r.error) report.error = r.error;
      }
      if (rows.length < batchSize) {
        report.done = true;
        break;
      }
    }
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
  }
  return report;
}
