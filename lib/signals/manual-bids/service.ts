import { createHash } from 'node:crypto';
import type { Db } from '@/lib/signals/store';
import type { CategoryId } from '@/lib/signals/categories';
import type { SignalInput } from '@/lib/signals/types';
import { csvFormat, readCsv, type CsvRecord } from './csv';
import { buildManualBid, capFields, linkHost, PROBLEM_TEXT, type ManualBidFields, type ManualBidProblem, type ManualBidReady, type RecordDeps } from './record';
import type { ExistingCandidate, ManualBidListing, PublishResult, RetireOutcome } from './store';
import type { OwnerGate } from './owner';
import { MAX_CSV_CHARS, MAX_CSV_ROWS, SERVICE_ERROR_TEXT, type CsvAnalysis, type RowOutcome, type ServiceError } from './service-text';

/**
 * The owner actions (round 33), written against injected dependencies so the rules are tested without Next or a database:
 *  - quickAdd: one bid from the form, in two steps (review 2): without a confirm key it checks the bid and returns the preview (what will
 *    be stored, READ ONLY); with the key from that preview it checks everything again from scratch and publishes. A key that no longer
 *    matches the fields (the owner edited them after the preview) is refused, so nothing is published that he has not seen.
 *  - retire: expires a hand-added bid now (added by mistake): it leaves every member's feed, e-mail and push at once (bidHidden).
 *  - previewCsv: a CSV file read and checked. READS ONLY: it never calls publish and never writes (tests/manual-bids prove it).
 *  - importCsv: the same file read and checked again from scratch (nothing from the preview is trusted), then the "add" rows published.
 * Every one of them asks the owner gate first and stops before touching the database when it says no.
 */

export interface ServiceDeps {
  gate: () => Promise<OwnerGate>;
  /** Service-role client; called only after the gate passes. */
  db: () => Db;
  now: () => Date;
  /** HOLLER_BIDS_ENABLED: a bid published while it is off would never reach a member, so publishing is refused. */
  bidsOn: () => boolean;
  findExisting: (db: Db, cands: ExistingCandidate[]) => Promise<Set<string>>;
  publish: (db: Db, items: SignalInput[], now: Date) => Promise<PublishResult>;
  served?: RecordDeps['served'];
  /** Expire one hand-added bid now. */
  retire?: (db: Db, id: number, now: Date) => Promise<RetireOutcome>;
  /** The open hand-added bids, newest first. */
  list?: (db: Db, now: Date) => Promise<ManualBidListing[]>;
}

export { MAX_CSV_CHARS, MAX_CSV_ROWS, SERVICE_ERROR_TEXT, type CsvAnalysis, type RowOutcome, type ServiceError } from './service-text';

/** What the owner sees before confirming: exactly what will be stored and shown to members. */
export interface QuickPreview {
  storedTitle: string;
  title: string;
  agency: string;
  dueDate: string;
  place: string;
  trades: CategoryId[];
  solicitationId: string | null;
  url: string;
  host: string;
}

export type QuickAddResult =
  | { ok: true; step: 'preview'; preview: QuickPreview; confirmKey: string; bidsOn: boolean }
  | { ok: true; step: 'done'; inserted: number; matched: number; title: string; agency: string; trades: CategoryId[]; host: string; note?: string }
  | { ok: false; error: string; field?: ManualBidProblem | 'duplicate' | 'changed' };

export type RetireResult = { ok: true; title: string } | { ok: false; error: string };

export type PreviewResult = { ok: true; analysis: CsvAnalysis; bidsOn: boolean } | { ok: false; error: ServiceError; missing?: string[] };
export type ImportResult =
  | { ok: true; analysis: CsvAnalysis; inserted: number; matched: number; note?: string }
  | { ok: false; error: ServiceError; missing?: string[] };

function candidate(r: ManualBidReady): ExistingCandidate {
  return {
    externalId: r.signal.externalId,
    url: r.view.url,
    keys: r.keys,
    solicitationId: r.view.solicitationId,
    agency: r.view.agency,
  };
}

/** Ties a confirmation to the exact fields that were previewed. */
export function confirmKeyOf(fields: ManualBidFields, externalId: string): string {
  const f = capFields(fields);
  const ordered = Object.keys(f).sort().map((k) => [k, (f as Record<string, string>)[k]]);
  return createHash('sha256').update(JSON.stringify([ordered, externalId])).digest('hex').slice(0, 32);
}

export async function quickAdd(deps: ServiceDeps, fields: ManualBidFields, confirm?: string): Promise<QuickAddResult> {
  const gate = await deps.gate();
  if (!gate.ok) return { ok: false, error: SERVICE_ERROR_TEXT.not_found };
  const now = deps.now();
  const built = buildManualBid(fields, { now, served: deps.served });
  if (!built.ok) return { ok: false, error: built.detail ?? PROBLEM_TEXT[built.problem], field: built.problem };
  const key = confirmKeyOf(fields, built.signal.externalId);
  const confirming = typeof confirm === 'string' && confirm.length > 0;
  if (confirming && confirm !== key) {
    return { ok: false, error: 'The fields changed after the preview. Check the new preview, then confirm.', field: 'changed' };
  }
  if (confirming && !deps.bidsOn()) return { ok: false, error: SERVICE_ERROR_TEXT.bids_off };
  const db = deps.db();
  let existing: Set<string>;
  try {
    existing = await deps.findExisting(db, [candidate(built)]);
  } catch {
    return { ok: false, error: SERVICE_ERROR_TEXT.db_failed };
  }
  if (existing.has(built.signal.externalId)) return { ok: false, error: PROBLEM_TEXT.already_in_holler, field: 'duplicate' };
  if (!confirming) {
    const v = built.view;
    return {
      ok: true,
      step: 'preview',
      preview: { storedTitle: built.signal.title, title: v.title, agency: v.agency, dueDate: v.dueDate, place: v.place, trades: v.trades, solicitationId: v.solicitationId, url: v.url, host: v.host },
      confirmKey: key,
      bidsOn: deps.bidsOn(),
    };
  }
  const res = await deps.publish(db, [built.signal], now);
  if (res.inserted === 0) return { ok: false, error: PROBLEM_TEXT.already_in_holler, field: 'duplicate' };
  return {
    ok: true,
    step: 'done',
    inserted: res.inserted,
    matched: res.matched,
    title: built.view.title,
    agency: built.view.agency,
    host: built.view.host,
    trades: built.view.trades,
    ...(res.error ? { note: 'Saved, but matching to members failed. It will be retried by the next re-match.' } : {}),
  };
}

/** Expire a hand-added bid now (added by mistake). Owner only; only rows of the manual source can be touched. */
export async function retireBid(deps: ServiceDeps, id: unknown): Promise<RetireResult> {
  const gate = await deps.gate();
  if (!gate.ok) return { ok: false, error: SERVICE_ERROR_TEXT.not_found };
  const n = typeof id === 'string' ? Number(id) : typeof id === 'number' ? id : NaN;
  if (!Number.isSafeInteger(n) || n <= 0 || !deps.retire) return { ok: false, error: 'Unknown record.' };
  try {
    const r = await deps.retire(deps.db(), n, deps.now());
    if (r.status === 'retired') return { ok: true, title: r.title };
    return { ok: false, error: r.status === 'already_closed' ? 'That bid is already closed.' : 'Unknown record.' };
  } catch {
    return { ok: false, error: 'Could not retire it. Try again.' };
  }
}

/** The open hand-added bids for the owner page. Empty for anyone but the owner, and on a read error. */
export async function listBids(deps: ServiceDeps): Promise<ManualBidListing[]> {
  const gate = await deps.gate();
  if (!gate.ok || !deps.list) return [];
  try {
    return await deps.list(deps.db(), deps.now());
  } catch {
    return [];
  }
}

function recordFields(rec: CsvRecord): ManualBidFields {
  const f = rec.fields;
  return {
    url: f.url,
    title: f.title,
    agency: f.agency,
    dueDate: f.due_date,
    zip: f.zip,
    city: f.city,
    state: f.state,
    solicitationId: f.solicitation_id,
    description: f.description,
  };
}

/** Reads, checks and de-duplicates (in the file, then against Holler) every row. Reads the database; never writes. */
async function analyze(deps: ServiceDeps, text: string, formatId: unknown): Promise<{ ok: true; analysis: CsvAnalysis; ready: ManualBidReady[] } | { ok: false; error: ServiceError; missing?: string[] }> {
  const format = csvFormat(formatId);
  if (!format) return { ok: false, error: 'bad_format' };
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'empty' };
  if (text.length > MAX_CSV_CHARS) return { ok: false, error: 'too_big' };
  const read = readCsv(text, format);
  if (!read.ok) return { ok: false, error: read.error, ...(read.missing ? { missing: read.missing } : {}) };
  if (read.records.length === 0) return { ok: false, error: 'empty' };
  if (read.records.length > MAX_CSV_ROWS) return { ok: false, error: 'too_many_rows' };

  const now = deps.now();
  const rows: RowOutcome[] = [];
  const pending: Array<{ row: RowOutcome; built: ManualBidReady }> = [];
  const seenUrl = new Set<string>();
  const seenSol = new Set<string>();
  const seenId = new Set<string>();
  for (const rec of read.records) {
    const f = capFields(recordFields(rec));
    const built = buildManualBid(f, { now, served: deps.served });
    if (!built.ok) {
      // What is echoed back for a skipped row is cut short too (review P2-4).
      const url = (f.url ?? '').slice(0, 300);
      rows.push({ line: rec.line, action: 'skip', reason: built.detail ?? PROBLEM_TEXT[built.problem], title: (f.title ?? '').slice(0, 140), agency: (f.agency ?? '').slice(0, 120), dueDate: (f.dueDate ?? '').slice(0, 40), place: [f.city, f.state, f.zip].filter(Boolean).join(' ').slice(0, 120), trades: [], url, host: linkHost(url) });
      continue;
    }
    const row: RowOutcome = { line: rec.line, action: 'add', reason: null, title: built.view.title, agency: built.view.agency, dueDate: built.view.dueDate, place: built.view.place, trades: built.view.trades, url: built.view.url, host: built.view.host };
    // One bid = the same link AND title, or the same agency AND solicitation number (a list page can carry many bids).
    const { solKey } = built.keys;
    const urlKey = `${built.keys.urlKey}|${built.keys.titleKey}`;
    if (seenUrl.has(urlKey) || (solKey && seenSol.has(solKey)) || seenId.has(built.signal.externalId)) {
      row.action = 'skip';
      row.reason = PROBLEM_TEXT.duplicate_in_file;
    } else {
      seenUrl.add(urlKey);
      if (solKey) seenSol.add(solKey);
      seenId.add(built.signal.externalId);
      pending.push({ row, built });
    }
    rows.push(row);
  }

  if (pending.length) {
    let existing: Set<string>;
    try {
      existing = await deps.findExisting(deps.db(), pending.map((p) => candidate(p.built)));
    } catch {
      return { ok: false, error: 'db_failed' };
    }
    for (const p of pending) {
      if (existing.has(p.built.signal.externalId)) {
        p.row.action = 'skip';
        p.row.reason = PROBLEM_TEXT.already_in_holler;
      }
    }
  }
  const ready = pending.filter((p) => p.row.action === 'add').map((p) => p.built);
  const skipped: Record<string, number> = {};
  for (const r of rows) if (r.action === 'skip' && r.reason) skipped[r.reason] = (skipped[r.reason] ?? 0) + 1;
  const add = rows.filter((r) => r.action === 'add').length;
  return { ok: true, analysis: { rows, add, skip: rows.length - add, skipped }, ready };
}

export async function previewCsv(deps: ServiceDeps, text: string, formatId: unknown): Promise<PreviewResult> {
  const gate = await deps.gate();
  if (!gate.ok) return { ok: false, error: 'not_found' };
  const a = await analyze(deps, text, formatId);
  if (!a.ok) return a;
  return { ok: true, analysis: a.analysis, bidsOn: deps.bidsOn() };
}

export async function importCsv(deps: ServiceDeps, text: string, formatId: unknown): Promise<ImportResult> {
  const gate = await deps.gate();
  if (!gate.ok) return { ok: false, error: 'not_found' };
  if (!deps.bidsOn()) return { ok: false, error: 'bids_off' };
  const a = await analyze(deps, text, formatId);
  if (!a.ok) return a;
  if (a.ready.length === 0) return { ok: true, analysis: a.analysis, inserted: 0, matched: 0 };
  const res = await deps.publish(deps.db(), a.ready.map((r) => r.signal), deps.now());
  return {
    ok: true,
    analysis: a.analysis,
    inserted: res.inserted,
    matched: res.matched,
    ...(res.error ? { note: 'Saved, but matching to members failed. It will be retried by the next re-match.' } : {}),
  };
}
