/**
 * Round 21 final review P1-1 (owner decision, reversible): ONE off switch for every request a probation source makes. Default ON: the
 * open-data APIs on probation (access 'open-data-api') are fetched so their samples and probes work, as round 19's probation sources were.
 * Set HOLLER_PROBATION_FETCH to "0" (or false, off, no) in Vercel to stop every probation request at once: the scan skips every probation
 * adapter (skipped(env), naming this key) and the owner probes answer without a request. Live (promoted) sources are not affected.
 * Read at call time.
 */
export const PROBATION_FETCH_FLAG = 'HOLLER_PROBATION_FETCH';

export function probationFetchOn(value: string | undefined = process.env[PROBATION_FETCH_FLAG]): boolean {
  return !/^\s*(?:0|false|off|no)\s*$/i.test(value ?? '');
}
