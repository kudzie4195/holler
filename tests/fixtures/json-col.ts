/** Value of a column or a PostgREST JSON text path (`data->>probation`) on a plain row, for the in-memory query fakes. Missing is null. */
export function colOf(r: Record<string, unknown>, col: string): unknown {
  const m = /^(\w+)->>(\w+)$/.exec(col);
  if (!m) return r[col] ?? null;
  const v = (r[m[1]] as Record<string, unknown> | null | undefined)?.[m[2]];
  return v == null ? null : String(v);
}
