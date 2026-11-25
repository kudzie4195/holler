/**
 * CSV reading for the owner's hand-downloaded bid exports (round 33). Pure: no I/O.
 *
 * Two formats:
 *  - generic: a file whose header row has the Holler field names below (title, agency, due_date, url, city, state, zip, solicitation_id,
 *    description). Any spreadsheet can be saved this way.
 *  - tx-esbd: the Texas Electronic State Business Daily "Export to CSV" button. Its column names are NOT known yet (no sample export
 *    has been seen), so the mapping below is a placeholder and `confirmed` is false. A file whose header lacks a mapped column is refused
 *    with the missing names listed; nothing is guessed from other columns.
 */

export const CSV_FIELDS = ['title', 'agency', 'due_date', 'url', 'city', 'state', 'zip', 'solicitation_id', 'description'] as const;
export type CsvField = (typeof CSV_FIELDS)[number];

export interface CsvFormat {
  id: string;
  label: string;
  /** Holler field -> the header text in the file (compared trimmed and case-insensitive). A field left out is read as empty. */
  columns: Partial<Record<CsvField, string>>;
  /** Fields whose column must be in the header for the file to be read at all. */
  required: readonly CsvField[];
  /** Values used when the file has no column (or an empty cell) for the field. */
  defaults?: Partial<Record<CsvField, string>>;
  /** false: the column names have not been checked against a real export. The import page says so. */
  confirmed: boolean;
}

export const CSV_FORMATS: Record<'generic' | 'tx-esbd', CsvFormat> = {
  generic: {
    id: 'generic',
    label: 'Generic CSV (headers: title, agency, due_date, url, city, state, zip, solicitation_id, description)',
    columns: {
      title: 'title',
      agency: 'agency',
      due_date: 'due_date',
      url: 'url',
      city: 'city',
      state: 'state',
      zip: 'zip',
      solicitation_id: 'solicitation_id',
      description: 'description',
    },
    required: ['title', 'agency', 'due_date', 'url'],
    confirmed: true,
  },
  'tx-esbd': {
    id: 'tx-esbd',
    label: 'Texas ESBD "Export to CSV" (column names not confirmed yet)',
    // TODO(owner): replace these header names with the exact ones from a real ESBD "Export to CSV" file. They are placeholders, not
    // read from an export. Until they match, the import page refuses the file and lists the missing headers. If the export has no link
    // per solicitation, add a `url` rule here only after opening one solicitation page by hand; rows without an https link are skipped.
    columns: {
      title: 'Solicitation Title',
      agency: 'Agency Name',
      due_date: 'Response Due Date',
      url: 'Solicitation URL',
      solicitation_id: 'Solicitation ID',
      city: 'City',
      zip: 'Zip',
      description: 'Description',
    },
    required: ['title', 'agency', 'due_date', 'url'],
    defaults: { state: 'TX' },
    confirmed: false,
  },
};

export type CsvFormatId = keyof typeof CSV_FORMATS;

export function csvFormat(id: unknown): CsvFormat | null {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(CSV_FORMATS, id) ? CSV_FORMATS[id as CsvFormatId] : null;
}

/**
 * RFC 4180 style: comma separated, double quotes around a field, "" for a quote inside one, line breaks inside quotes kept, CRLF or LF
 * row ends, a leading byte order mark dropped. Rows that are completely empty are left out. Never throws.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = (text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

export interface CsvRecord {
  /** 1-based line of the row in the file, counting the header as line 1 (what a spreadsheet shows). */
  line: number;
  fields: Partial<Record<CsvField, string>>;
}

/** Longest cell kept (review P2-4): anything past it is cut before the row is looked at. */
export const CELL_MAX = 2000;

export type CsvReadResult = { ok: true; records: CsvRecord[] } | { ok: false; error: 'empty' | 'missing_columns'; missing?: string[] };

const headerKey = (h: string) => h.trim().toLowerCase();

/** Reads the header row and maps every data row to Holler fields with the format's column names. */
export function readCsv(text: string, format: CsvFormat): CsvReadResult {
  const rows = parseCsv(text);
  if (rows.length === 0) return { ok: false, error: 'empty' };
  const header = rows[0].map(headerKey);
  const index = new Map<CsvField, number>();
  for (const f of CSV_FIELDS) {
    const name = format.columns[f];
    if (!name) continue;
    const at = header.indexOf(headerKey(name));
    if (at >= 0) index.set(f, at);
  }
  const missing = format.required.filter((f) => !index.has(f)).map((f) => format.columns[f] ?? f);
  if (missing.length) return { ok: false, error: 'missing_columns', missing };
  const records: CsvRecord[] = [];
  for (let r = 1; r < rows.length; r++) {
    const fields: Partial<Record<CsvField, string>> = {};
    for (const f of CSV_FIELDS) {
      const at = index.get(f);
      const v = at === undefined ? '' : (rows[r][at] ?? '').slice(0, CELL_MAX).trim();
      const d = format.defaults?.[f];
      if (v) fields[f] = v;
      else if (d) fields[f] = d;
    }
    records.push({ line: r + 1, fields });
  }
  return { ok: true, records };
}
