import type { SupabaseClient } from '@supabase/supabase-js';
import type { MatchProfile, MatchRow, MatchSignal } from './match';
import type { SignalInput } from './types';
import { MAX_FUTURE_DAYS } from './run-limits';
import { sanitizeContacts } from '@/lib/contacts/sanitize';
import { NO_CONTACT_SUBTYPES } from '@/lib/contacts/extract';
import type { ContactInput } from '@/lib/contacts/types';

export type Db = SupabaseClient;

export const RETENTION_DAYS = 120;
const CHUNK = 200;

export interface StoredSignal extends MatchSignal {
  source: string;
  title: string;
  /** nearest city slug, read back so the scan can tell IndexNow which city pages changed */
  place_slug?: string | null;
  /** read back so contacts can be filed under the rows that were actually inserted */
  external_id?: string;
}

export interface ScanRunRecord {
  source: string;
  started_at: string;
  finished_at: string;
  fetched: number;
  inserted: number;
  matched: number;
  error: string | null;
}

function chunks<T>(arr: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** PostgREST caps one response at 1000 rows (Supabase default max_rows), so everything that can exceed that is read in pages. */
export const PAGE_SIZE = 1000;

/**
 * Read every row a query returns, one 1000-row page at a time.
 * `build(from, to)` must return the same ordered query for the given inclusive range. Stops after `maxPages`.
 */
export async function readAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  maxPages = 50,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await build(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

/**
 * Latest started_at per source from holler_scan_runs (last 3 days).
 * Paged: 40 sources at 15 to 720 minute cadences write about 350 rows a day, so one 1000-row page can drop a slow
 * source off the end, which would make it look "never run" and re-run it on every tick.
 */
export async function getLastRunTimes(db: Db): Promise<Record<string, number>> {
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  let rows: { source: string | null; started_at: string | null }[];
  try {
    rows = await readAllPages(
      (from, to) =>
        db
          .from('holler_scan_runs')
          .select('source, started_at')
          .gte('started_at', since)
          .order('started_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      10,
    );
  } catch (e) {
    throw new Error(`scan_runs read failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (!r.source || !r.started_at) continue;
    const t = Date.parse(r.started_at);
    if (Number.isFinite(t) && !(r.source in out)) out[r.source] = t;
  }
  return out;
}

export interface SignalRowInput extends SignalInput {
  placeSlug: string | null;
}

function toRow(s: SignalRowInput) {
  return {
    source: s.source,
    external_id: s.externalId,
    kind: s.kind,
    title: s.title,
    summary: s.summary ?? null,
    url: s.url ?? null,
    lat: s.lat ?? null,
    lon: s.lon ?? null,
    city: s.city ?? null,
    state: s.state ?? null,
    county: s.county ?? null,
    zip: s.zip ?? null,
    place_slug: s.placeSlug,
    categories: s.categories,
    severity: s.severity,
    occurred_at: s.occurredAt,
    expires_at: s.expiresAt ?? null,
    data: s.data ?? {},
  };
}

export interface InsertOptions {
  /** Where contact-write problems are reported (they never fail the insert). Defaults to console.error. */
  log?: (m: string) => void;
  /** Dry run: nothing is written, nothing is returned. */
  dry?: boolean;
}

/**
 * Insert with on conflict (source, external_id) do nothing; returns only the rows actually inserted.
 * Contacts (SignalInput.contacts) are then written for those inserted rows only, matched by source + external id: a signal that was
 * already stored never gets a second contact write. Contacts are written per chunk, right after that chunk's signal upsert succeeds,
 * so a later chunk's failure cannot leave earlier chunks' new signals without their contacts (a re-scan never retries them).
 * Contacts never block or fail the insert (see writeSignalContacts). A signal whose data.subtype is 'violation' or '311' gets no contact
 * write at all, whatever its adapter attached.
 */
export async function insertNewSignals(db: Db, signals: SignalRowInput[], opts: InsertOptions = {}): Promise<StoredSignal[]> {
  if (opts.dry) return [];
  const inserted: StoredSignal[] = [];
  let contactBudget = MAX_CONTACT_ROWS;
  for (const part of chunks(signals)) {
    const { data, error } = await db
      .from('holler_signals')
      .upsert(part.map(toRow), { onConflict: 'source,external_id', ignoreDuplicates: true })
      .select('id, source, external_id, title, summary, categories, lat, lon, state, severity, occurred_at, place_slug, subtype:data->>subtype');
    if (error) throw new Error(`signals upsert failed: ${error.message}`);
    const rows = (data ?? []) as StoredSignal[];
    inserted.push(...rows);
    const byKey = new Map<string, { contacts: ContactInput[]; city: string | null }>();
    // Code violations and 311 requests never get a contact, whatever an adapter attached (review2 P2-5).
    for (const s of part) {
      if (s.contacts?.length && !noContactSubtype(s.data?.subtype)) byKey.set(`${s.source}\u0000${s.externalId}`, { contacts: s.contacts, city: s.city ?? null });
    }
    if (!byKey.size || contactBudget <= 0) continue;
    const pending: { signalId: number; contacts: ContactInput[]; city?: string | null }[] = [];
    for (const r of rows) {
      const c = r.external_id != null && !noContactSubtype(r.subtype) ? byKey.get(`${r.source}\u0000${r.external_id}`) : undefined;
      if (c && typeof r.id === 'number') pending.push({ signalId: r.id, contacts: c.contacts, city: c.city });
    }
    if (pending.length) contactBudget -= await writeSignalContacts(db, pending, opts.log, contactBudget);
  }
  return inserted;
}

/** data.subtype of a code violation or a 311 request (lib/contacts/extract.ts NO_CONTACT_SUBTYPES). */
function noContactSubtype(subtype: unknown): boolean {
  return typeof subtype === 'string' && NO_CONTACT_SUBTYPES.has(subtype.trim().toLowerCase());
}

const CONTACT_BATCH = 500;
/** Most contact rows written in one scan call (at most 6 per signal). */
const MAX_CONTACT_ROWS = 6000;

function missingContactsTable(e: { message?: string; code?: string } | null | undefined): boolean {
  const m = e?.message ?? '';
  return e?.code === '42P01' || e?.code === 'PGRST205' || (/holler_signal_contacts/.test(m) && /does not exist|could not find|schema cache/i.test(m));
}

/**
 * Write contacts for newly inserted signals into holler_signal_contacts (service role only; migration 0006). Each contact is sanitised
 * again here (organization check, address cut, US state code, the signal's own city or place words, length limits, plausible phone and
 * email, at most 6 per signal). Bounded batches of 500 rows, and
 * at most `maxRows` rows in all (insertNewSignals passes what is left of the per-scan cap).
 * Never throws: a missing table (code deployed before the migration) or a failed batch is logged and the scan carries on.
 * Returns the number of rows sent.
 */
export async function writeSignalContacts(
  db: Db,
  items: { signalId: number; contacts: ContactInput[]; /** the signal's own city: a contact city equal to it is kept */ city?: string | null }[],
  log: (m: string) => void = (m) => console.error(m),
  maxRows: number = MAX_CONTACT_ROWS,
): Promise<number> {
  const cap = Math.max(0, Math.min(maxRows, MAX_CONTACT_ROWS));
  const rows: Record<string, unknown>[] = [];
  for (const it of items) {
    if (!Number.isSafeInteger(it.signalId) || it.signalId <= 0) continue;
    for (const c of sanitizeContacts(it.contacts, { datasetCity: it.city ?? null })) {
      rows.push({
        signal_id: it.signalId,
        role: c.role,
        name: c.name,
        attn: c.attn ?? null,
        address: c.address ?? '',
        city: c.city ?? null,
        state: c.state ?? null,
        zip: c.zip ?? null,
        phone: c.phone ?? null,
        email: c.email ?? null,
        website: c.website ?? null,
      });
      if (rows.length >= cap) break;
    }
    if (rows.length >= cap) break;
  }
  let sent = 0;
  for (const part of chunks(rows, CONTACT_BATCH)) {
    try {
      const { error } = await db
        .from('holler_signal_contacts')
        .upsert(part, { onConflict: 'signal_id,role,name,address', ignoreDuplicates: true });
      if (error) {
        if (missingContactsTable(error)) {
          log('contacts: holler_signal_contacts is missing (apply migration 0006); contacts for this scan are skipped');
          return sent;
        }
        log(`contacts: write failed, ${part.length} rows skipped: ${error.message}`);
        continue;
      }
      sent += part.length;
    } catch (e) {
      log(`contacts: write failed, ${part.length} rows skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return sent;
}

export interface LoadedProfile extends MatchProfile {
  subscription_status: string;
  trial_ends_at: string | null;
}

/** Columns a matcher needs from holler_profiles, plan limits included (plan, extra_areas, keywords come from migration 0004). */
export const PROFILE_MATCH_COLUMNS =
  'user_id, categories, lat, lon, state, radius_mi, subscription_status, trial_ends_at, plan, extra_areas, keywords';
/** The same without the 0004 columns: read only when the database does not have them yet, which gives every profile Starter limits. */
const PROFILE_MATCH_COLUMNS_LEGACY = 'user_id, categories, lat, lon, state, radius_mi, subscription_status, trial_ends_at';

function missingPlanColumn(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /(plan|extra_areas|keywords)/.test(m) && /does not exist|could not find/i.test(m);
}

/**
 * Can this profile still see alerts in the app? (F-11)
 * Mirrors lib/auth/access.ts computeAccess, with one difference: a canceled profile never matches.
 * active and past_due keep access (past_due is Stripe's retry window); trialing keeps it until trial_ends_at;
 * an unknown status is treated as trialing, like computeAccess does.
 */
export function canSeeAlerts(p: { subscription_status: string; trial_ends_at: string | null }, nowMs: number = Date.now()): boolean {
  if (p.subscription_status === 'canceled') return false;
  if (p.subscription_status === 'active' || p.subscription_status === 'past_due') return true;
  const end = p.trial_ends_at ? Date.parse(p.trial_ends_at) : NaN;
  return Number.isFinite(end) && end > nowMs;
}

/**
 * Profiles eligible for matching: has categories and can still see alerts (not canceled, not past an unpaid trial).
 * Each row carries plan, subscription_status, extra_areas and keywords, so matchOne/matchSignals apply the plan limits.
 * Paged with .range() because PostgREST silently caps one response at 1000 rows.
 */
export async function loadProfiles(db: Db, now: Date = new Date()): Promise<MatchProfile[]> {
  const read = (columns: string) =>
    readAllPages<LoadedProfile>(
      (from, to) =>
        db
          .from('holler_profiles')
          .select(columns)
          .neq('subscription_status', 'canceled')
          .order('user_id', { ascending: true })
          .range(from, to),
      100,
    );
  let rows: LoadedProfile[];
  try {
    try {
      rows = await read(PROFILE_MATCH_COLUMNS);
    } catch (e) {
      // Code deployed before migration 0004 ran: keep matching on Starter limits instead of matching nobody.
      if (!missingPlanColumn(e)) throw e;
      console.error('loadProfiles: plan columns missing (apply migration 0004); matching with Starter limits');
      rows = await read(PROFILE_MATCH_COLUMNS_LEGACY);
    }
  } catch (e) {
    throw new Error(`profiles read failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return rows.filter((p) => Array.isArray(p.categories) && p.categories.length > 0 && canSeeAlerts(p, now.getTime()));
}

export async function insertMatches(db: Db, rows: MatchRow[]): Promise<number> {
  let n = 0;
  for (const part of chunks(rows, 500)) {
    const { data, error } = await db
      .from('holler_matches')
      .upsert(part, { onConflict: 'user_id,signal_id', ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error(`matches upsert failed: ${error.message}`);
    n += data?.length ?? 0;
  }
  return n;
}

export async function logRun(db: Db, rec: ScanRunRecord): Promise<void> {
  const { error } = await db.from('holler_scan_runs').insert(rec);
  if (error) throw new Error(`scan_runs insert failed: ${error.message}`);
}

/**
 * Delete signals older than RETENTION_DAYS (matches cascade) at most once per 24 h.
 * Uses a marker row in holler_scan_runs with source '_prune'. Returns true when a prune ran.
 */
export async function pruneOldSignals(db: Db, now = new Date()): Promise<boolean> {
  const dayAgo = new Date(now.getTime() - 86400_000).toISOString();
  const { data, error } = await db.from('holler_scan_runs').select('id').eq('source', '_prune').gte('started_at', dayAgo).limit(1);
  if (error) throw new Error(`prune check failed: ${error.message}`);
  if (data && data.length > 0) return false;
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86400_000).toISOString();
  const started = new Date().toISOString();
  const { error: oldErr, count: oldCount } = await db.from('holler_signals').delete({ count: 'exact' }).lt('occurred_at', cutoff);
  // Garbage future dates (a typo year, a portal placeholder) are never reached by the age cutoff above, so they are removed here.
  const futureCutoff = new Date(now.getTime() + MAX_FUTURE_DAYS * 86400_000).toISOString();
  const { error: futErr, count: futCount } = await db.from('holler_signals').delete({ count: 'exact' }).gt('occurred_at', futureCutoff);
  const delErr = oldErr ?? futErr;
  const count = (oldCount ?? 0) + (futCount ?? 0);
  await db
    .from('holler_scan_runs')
    .delete()
    .lt('started_at', new Date(now.getTime() - 30 * 86400_000).toISOString());
  // The area checker writes one holler_rate_limits row per visitor. The table has no other cleanup beyond a 1 in 100 chance inside the
  // limiter RPC, so the daily prune removes rows older than two days (a window is at most an hour; migration 0002/0003 index window_start).
  // Best effort: a failure here (table missing, privileges) never fails the prune of signals.
  try {
    const { error: rlErr } = await db
      .from('holler_rate_limits')
      .delete()
      .lt('window_start', new Date(now.getTime() - 2 * 86400_000).toISOString());
    if (rlErr) console.error('prune: holler_rate_limits delete failed:', rlErr.message);
  } catch (e) {
    console.error('prune: holler_rate_limits delete failed:', e instanceof Error ? e.message : String(e));
  }
  await logRun(db, {
    source: '_prune',
    started_at: started,
    finished_at: new Date().toISOString(),
    fetched: 0,
    inserted: 0,
    matched: count ?? 0,
    error: delErr ? delErr.message : null,
  });
  return !delErr;
}
