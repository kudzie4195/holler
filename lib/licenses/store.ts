import type { SupabaseClient } from '@supabase/supabase-js';
import type { LicenseRow } from './company-row';

type Db = SupabaseClient;

export const LICENSE_TABLE = 'holler_contractor_licenses';
const BATCH = 500;
/** At most this many licence numbers in one lookup query (a scan chunk holds a few hundred signals). */
const LOOKUP_MAX = 300;

/** The table of migration 0036 is not there (PostgREST PGRST205, Postgres 42P01, or the message). */
export function isLicenseTableMissing(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === 'PGRST205' || e.code === '42P01' || (/holler_contractor_licenses/.test(e.message ?? '') && /does not exist|could not find|schema cache/i.test(e.message ?? ''));
}

/**
 * Upsert company rows (on state + licence number). Returns the number of rows sent, or 'missing' when the table is not there (nothing is
 * written, no error). A failed batch is counted in `failed` and the rest carry on.
 */
export async function upsertLicenseRows(db: Db, rows: readonly LicenseRow[]): Promise<{ written: number; failed: number } | 'missing'> {
  let written = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const part = rows.slice(i, i + BATCH);
    const { error } = await db.from(LICENSE_TABLE).upsert(part as LicenseRow[], { onConflict: 'state,license_number' });
    if (error) {
      if (isLicenseTableMissing(error)) return 'missing';
      failed += part.length;
      continue;
    }
    written += part.length;
  }
  return { written, failed };
}

export interface StoredLicense {
  state: string;
  license_number: string;
  business_name: string;
  business_phone: string | null;
  business_address: string | null;
  business_city: string | null;
  business_zip: string | null;
}

/**
 * Look licence numbers up for one state. Never throws: a missing table (0036 not applied) or any error gives an empty map (and
 * `missing` true for the missing table), so the scan attaches nothing and carries on.
 */
export async function lookupLicenses(db: Db, state: string, numbers: readonly string[]): Promise<{ found: Map<string, StoredLicense>; missing: boolean }> {
  const found = new Map<string, StoredLicense>();
  const uniq = [...new Set(numbers)].slice(0, LOOKUP_MAX);
  if (!uniq.length) return { found, missing: false };
  try {
    const { data, error } = await db
      .from(LICENSE_TABLE)
      .select('state, license_number, business_name, business_phone, business_address, business_city, business_zip')
      .eq('state', state)
      .in('license_number', uniq);
    if (error) return { found, missing: isLicenseTableMissing(error) };
    for (const r of (data ?? []) as StoredLicense[]) if (r && typeof r.license_number === 'string') found.set(r.license_number, r);
    return { found, missing: false };
  } catch {
    return { found, missing: false };
  }
}
