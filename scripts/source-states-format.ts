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
    health: rows(healthPsv).map((c) => ({ source: c[0], last_success_at: nul(c[1]), last_run_at: nul(c[2]), consecutive_failures: Number(c[3]), tracked_since: nul(c[4]) })),
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
  lines.push('Rules in one line each: Delayed = no successful run for more than 2 cadences. Degraded = the last 3 runs each failed, or each returned 0 rows from a permit/311/alert source. Unavailable = no successful run for more than 24 h (36 h for a 12 h cadence), or never run. Not set up yet = needs an env key or flag that is not set.');
  lines.push('');
  lines.push('## Needs attention (not healthy)');
  lines.push('');
  lines.push('| Source | State | Last update | Why |');
  lines.push('|---|---|---|---|');
  for (const r of sum.attention) {
    const last = r.sinceSuccessMs === null ? 'none' : `${agePhrase(r.sinceSuccessMs)} ago`;
    lines.push(`| ${r.id} | ${STATE_LABEL[r.state]} | ${last} | ${r.state === 'not_set_up' ? r.detail : r.detail} |`);
  }
  lines.push('');
  lines.push('## All sources');
  lines.push('');
  lines.push('| Source | Kind | Cadence | State | Last successful run |');
  lines.push('|---|---|---|---|---|');
  for (const r of results) {
    const a = adapterBy.get(r.id)!;
    const cad = a.cadenceMinutes >= 60 ? `${a.cadenceMinutes / 60} h` : `${a.cadenceMinutes} min`;
    const last = r.sinceSuccessMs === null ? 'none' : `${agePhrase(r.sinceSuccessMs)} ago`;
    lines.push(`| ${r.id} | ${a.kind} | ${cad} | ${STATE_LABEL[r.state]} | ${last} |`);
  }
  lines.push('');
  return lines.join('\n');
}
