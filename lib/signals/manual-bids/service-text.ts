import type { CategoryId } from '@/lib/signals/categories';

/** Client-safe constants and result types of lib/signals/manual-bids/service.ts (the import page shows them). Owner pages: English only. */

/** Largest CSV text accepted (server actions take at most 1 MB a request). */
export const MAX_CSV_CHARS = 900_000;
/** Most data rows read from one file. */
export const MAX_CSV_ROWS = 500;

export type ServiceError = 'not_found' | 'bids_off' | 'db_failed' | 'empty' | 'too_big' | 'too_many_rows' | 'missing_columns' | 'bad_format';

export const SERVICE_ERROR_TEXT: Record<ServiceError, string> = {
  not_found: 'Not found.',
  bids_off: 'HOLLER_BIDS_ENABLED is off, so no bid reaches a member. Turn it on before publishing (preview still works).',
  db_failed: 'Could not read Holler\'s records to check for duplicates. Nothing was added. Try again.',
  empty: 'The file is empty.',
  too_big: 'The file is over 900 KB. Split it and import each part.',
  too_many_rows: `The file has more than ${MAX_CSV_ROWS} rows. Split it and import each part.`,
  missing_columns: 'The header row is missing columns this format needs.',
  bad_format: 'Unknown file format.',
};

export interface RowOutcome {
  line: number;
  action: 'add' | 'skip';
  reason: string | null;
  title: string;
  agency: string;
  dueDate: string;
  place: string;
  trades: CategoryId[];
  url: string;
  /** The link's host, shown in the preview so the owner sees where each record will point before confirming. */
  host: string;
}

export interface CsvAnalysis {
  rows: RowOutcome[];
  add: number;
  skip: number;
  /** Skip counts by reason text. */
  skipped: Record<string, number>;
}

