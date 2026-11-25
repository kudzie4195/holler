import type { Db } from '@/lib/signals/store';
import type { CategoryId } from '@/lib/signals/categories';
import type { SignalInput } from '@/lib/signals/types';
import { csvFormat, readCsv, type CsvRecord } from './csv';
import { buildManualBid, PROBLEM_TEXT, type ManualBidFields, type ManualBidProblem, type ManualBidReady, type RecordDeps } from './record';
import type { ExistingCandidate, PublishResult } from './store';
import type { OwnerGate } from './owner';
import { MAX_CSV_CHARS, MAX_CSV_ROWS, SERVICE_ERROR_TEXT, type CsvAnalysis, type RowOutcome, type ServiceError } from './service-text';

/**
 * The three owner actions (round 33), written against injected dependencies so the rules are tested without Next or a database:
 *  - quickAdd: one bid from the form. Checked, de-duplicated, published.
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
}

export { MAX_CSV_CHARS, MAX_CSV_ROWS, SERVICE_ERROR_TEXT, type CsvAnalysis, type RowOutcome, type ServiceError } from './service-text';

export type QuickAddResult =
  | { ok: true; inserted: number; matched: number; title: string; trades: CategoryId[]; note?: string }
  | { ok: false; error: string; field?: ManualBidProblem | 'duplicate' };

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

export async function quickAdd(deps: ServiceDeps, fields: ManualBidFields): Promise<QuickAddResult> {
  const gate = await deps.gate();
  if (!gate.ok) return { ok: false, error: SERVICE_ERROR_TEXT.not_found };
  const now = deps.now();
  const built = buildManualBid(fields, { now, served: deps.served });
  if (!built.ok) return { ok: false, error: PROBLEM_TEXT[built.problem], field: built.problem };
  if (!deps.bidsOn()) return { ok: false, error: SERVICE_ERROR_TEXT.bids_off };
  const db = deps.db();
  let existing: Set<string>;
  try {
    existing = await deps.findExisting(db, [candidate(built)]);
  } catch {
    return { ok: false, error: SERVICE_ERROR_TEXT.db_failed };
  }
  if (existing.has(built.signal.externalId)) return { ok: false, error: PROBLEM_TEXT.already_in_holler, field: 'duplicate' };
  const res = await deps.publish(db, [built.signal], now);
  if (res.inserted === 0) return { ok: false, error: PROBLEM_TEXT.already_in_holler, field: 'duplicate' };
  return {
    ok: true,
    inserted: res.inserted,
    matched: res.matched,
    title: built.view.title,
    trades: built.view.trades,
    ...(res.error ? { note: 'Saved, but matching to members failed. It will be retried by the next re-match.' } : {}),
  };
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
    const f = recordFields(rec);
    const built = buildManualBid(f, { now, served: deps.served });
    if (!built.ok) {
      rows.push({ line: rec.line, action: 'skip', reason: PROBLEM_TEXT[built.problem], title: (f.title ?? '').slice(0, 140), agency: (f.agency ?? '').slice(0, 120), dueDate: f.dueDate ?? '', place: [f.city, f.state, f.zip].filter(Boolean).join(' '), trades: [], url: (f.url ?? '').slice(0, 300) });
      continue;
    }
    const row: RowOutcome = { line: rec.line, action: 'add', reason: null, title: built.view.title, agency: built.view.agency, dueDate: built.view.dueDate, place: built.view.place, trades: built.view.trades, url: built.view.url };
    const { urlKey, solKey } = built.keys;
    if ((urlKey && seenUrl.has(urlKey)) || (solKey && seenSol.has(solKey)) || seenId.has(built.signal.externalId)) {
      row.action = 'skip';
      row.reason = PROBLEM_TEXT.duplicate_in_file;
    } else {
      if (urlKey) seenUrl.add(urlKey);
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
