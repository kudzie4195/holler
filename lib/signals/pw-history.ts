import { matchScope } from '@/lib/plan';
import { holdOf } from './alert-gate';
import { pwRuleOf, recordLabelInput } from './lead-rules';
import { pwPlaceOf, PW_WINDOW_DAYS, type PwPast } from './pw-caps';
import { isPwMember } from './pw-switch';
import { readAllPages, type Db } from './store';
import type { MatchProfile } from './match';

/**
 * Round 35 review (P1-1): what each pressure-washing member already holds from the last 7 days, for the volume caps of matchSignals
 * (lib/signals/pw-caps.ts). Read-only: holler_matches (user_id, signal_id, created_at, alert_hold) and holler_signals (id, kind, subtype,
 * title, summary, lat, lon). Only members the pw rules apply to are read (none while HOLLER_PW_RULES_ENABLED is off: no query at all).
 * A member whose read fails is returned in `unknown`: matchSignals then holds every graffiti alert for them, so a failed read never sends
 * more than the cap.
 */
export async function loadPwHistory(db: Db, profiles: readonly MatchProfile[], now: Date): Promise<{ history: Map<string, PwPast[]>; unknown: Set<string> }> {
  const users = profiles.filter((p) => isPwMember(matchScope(p).categories)).map((p) => p.user_id);
  const history = new Map<string, PwPast[]>();
  const unknown = new Set<string>();
  if (users.length === 0) return { history, unknown };
  const since = new Date(now.getTime() - PW_WINDOW_DAYS * 86_400_000).toISOString();
  try {
    type M = { user_id: string; signal_id: number; created_at: string; alert_hold?: string | null };
    const matches: M[] = [];
    for (let i = 0; i < users.length; i += 100) {
      const part = users.slice(i, i + 100);
      const read = (cols: string) =>
        readAllPages<M>((from, to) => db.from('holler_matches').select(cols).in('user_id', part).gte('created_at', since).order('id', { ascending: true }).range(from, to), 20);
      try {
        matches.push(...(await read('user_id, signal_id, created_at, alert_hold')));
      } catch (e) {
        // Before migration 0027 there is no hold column: every stored card counts as sent, which can only lower what goes out.
        if (!/alert_hold/i.test(e instanceof Error ? e.message : String(e))) throw e;
        matches.push(...(await read('user_id, signal_id, created_at')));
      }
    }
    const ids = [...new Set(matches.map((m) => m.signal_id))];
    type S = { id: number; source: string; kind: string | null; subtype: string | null; title: string | null; summary: string | null; lat: number | null; lon: number | null };
    const sig = new Map<number, S>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db.from('holler_signals').select('id, source, kind, subtype:data->>subtype, title, summary, lat, lon').in('id', ids.slice(i, i + 200));
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as unknown as S[]) sig.set(r.id, r);
    }
    for (const m of matches) {
      const s = sig.get(m.signal_id);
      if (!s) continue;
      const place = pwPlaceOf(pwRuleOf(recordLabelInput(s)).kind, s);
      if (!place) continue;
      const at = Date.parse(m.created_at);
      if (!Number.isFinite(at)) continue;
      history.set(m.user_id, [...(history.get(m.user_id) ?? []), { place, at, alert: !holdOf(m) }]);
    }
  } catch {
    for (const u of users) unknown.add(u);
    history.clear();
  }
  return { history, unknown };
}
