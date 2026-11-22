import {
  agePhrase,
  computeSourceStates,
  STATE_LABEL,
  summarizeSourceStates,
  type HealthSample,
  type ScanRunRow,
  type StateAdapter,
} from '../lib/signals/source-state';

/** Parse the two PSV fixtures (header line first, `|` separated, empty field = null). */
export function readSourceHealthShape(healthPsv: string, runsPsv: string): { health: Array<HealthSample & { source: string }>; runs: ScanRunRow[] } {
  const rows = (s: string) => s.trim().split('\n').slice(1).map((l) => l.split('|'));
  const nul = (v: string | undefined) => (v === undefined || v === '' ? null : v);
  return {
    health: rows(healthPsv).map((c) => ({ source: c[0], last_success_at: nul(c[1]), last_run_at: nul(c[2]), consecutive_failures: Number(c[3]), tracked_since: nul(c[4]), last_record_at: nul(c[5]) })),
    runs: rows(runsPsv).map((c) => ({ source: c[0], started_at: nul(c[1]), fetched: c[2] === '' ? null : Number(c[2]), error: nul(c[3]) })),
  };
}

export function formatSnapshot(input: { adapters: StateAdapter[]; health: Array<HealthSample & { source: string }>; runs: ScanRunRow[]; now: Date }): string {
  const results = computeSourceStates(input);
  const sum = summarizeSourceStates(results);
  const adapterBy = new Map(input.adapters.map((a) => [a.id, a]));
  const lines: string[] = [];
  lines.push('# H-states: source states, read-only snapshot');
  lines.push('');
  lines.push(`Snapshot time: ${input.now.toISOString()} (database clock). Rules: lib/signals/source-state.ts. Inputs: scripts/fixtures/source-states-live/ (sourced: read-only selects on holler_source_health and holler_scan_runs, ksctghdtklufgxblueqp; adapters from the real registry).`);
  lines.push('');
  lines.push(`Sources in the registry: ${sum.total}. Healthy ${sum.counts.healthy}, Delayed ${sum.counts.delayed}, Degraded ${sum.counts.degraded}, Unavailable ${sum.counts.unavailable}, Not set up yet ${sum.counts.not_set_up}.`);
  lines.push('');
  lines.push('Rules in one line each: Delayed = no successful run for more than 2 cadences. Degraded = the last 3 runs each failed, or each returned 0 rows from a source whose OWN run history shows it returning rows on at least half of at least 3 earlier runs spanning 24 h or more (a source that publishes in bursts, like Cobb County, or has never returned a row is not degraded for empty runs). Unavailable = no successful run for more than 24 h (36 h for a 12 h cadence), or never run. Not set up yet = needs an env key or flag that is not set. "Last update" shown to members is the newest record date the source returned, not the last clean run.');
  lines.push('');
  lines.push('Run history in the fixture: the full 96 hours for the nine sources that had empty runs (three Cobb layers, LA permits, Kansas City 311, Oakland 311, Austin inspections, Baton Rouge 311, Cincinnati 311) and the 3 newest runs for the rest (their newest run returned rows or they are not judged by empty runs, so more history cannot change their state).');
  lines.push('');
  lines.push('## Needs attention (not healthy)');
  lines.push('');
  lines.push('| Source | State | Last update (newest record) | Last successful run | Why |');
  lines.push('|---|---|---|---|---|');
  const rec = (iso: string | null) => (iso === null ? 'none yet' : `${agePhrase(input.now.getTime() - Date.parse(iso))} ago`);
  for (const r of sum.attention) {
    const run = r.sinceSuccessMs === null ? 'none' : `${agePhrase(r.sinceSuccessMs)} ago`;
    lines.push(`| ${r.id} | ${STATE_LABEL[r.state]} | ${rec(r.lastRecordAt)} | ${run} | ${r.detail} |`);
  }
  lines.push('');
  lines.push('## Healthy but never returned a row in the history held (quiet)');
  lines.push('');
  if (sum.quiet.length === 0) lines.push('None.');
  for (const r of sum.quiet) lines.push(`- ${r.id}: newest record ${rec(r.lastRecordAt)}`);
  lines.push('');
  lines.push('## All sources');
  lines.push('');
  lines.push('| Source | Kind | Cadence | State | Rows history | Last successful run | Newest record |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    const a = adapterBy.get(r.id)!;
    const cad = a.cadenceMinutes >= 60 ? `${a.cadenceMinutes / 60} h` : `${a.cadenceMinutes} min`;
    const last = r.sinceSuccessMs === null ? 'none' : `${agePhrase(r.sinceSuccessMs)} ago`;
    lines.push(`| ${r.id} | ${a.kind} | ${cad} | ${STATE_LABEL[r.state]} | ${r.rowsHistory ?? 'n/a'} | ${last} | ${rec(r.lastRecordAt)} |`);
  }
  lines.push('');
  return lines.join('\n');
}
