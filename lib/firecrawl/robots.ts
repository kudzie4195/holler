/**
 * robots.txt check for the agency pages Firecrawl is asked to read. Pure parser plus one small fetch helper.
 *
 * Why this exists: the shell that built this unit could not read any agency's robots.txt (WebFetch refused the robots.txt URLs and the
 * proxy answered 403), so the rule is enforced when the code runs instead: before a source's first paid call of a run its robots.txt is
 * fetched (free: it is the agency's own file, not a Firecrawl call) and the source is skipped when the page path is disallowed.
 * Rules follow RFC 9309: the most specific user-agent group wins ("firecrawl" over "*"), the longest matching path wins, Allow beats
 * Disallow on a tie, `*` and `$` work in paths. A 4xx answer (no file) means allowed; a 5xx or a network error means "cannot tell", and the
 * source is skipped for this run.
 */
const AGENTS = ['firecrawlagent', 'firecrawl', 'holler'];

interface Group {
  agents: string[];
  rules: Array<{ allow: boolean; path: string }>;
}

export function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      if (cur) cur.rules.push({ allow: key === 'allow', path: val });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function toRegex(path: string): RegExp {
  const esc = path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${esc}`);
}

/** Is `path` (with query, starting with "/") allowed for our crawler by this robots.txt text? */
export function robotsAllows(text: string, path: string): boolean {
  const groups = parseRobots(text);
  const specific = groups.filter((g) => g.agents.some((a) => AGENTS.some((x) => a.includes(x) && a !== '*')));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of chosen) {
    for (const r of g.rules) {
      if (r.path === '') continue; // "Disallow:" with nothing allows everything
      const pat = r.path.endsWith('$') ? r.path.slice(0, -1) : r.path;
      const re = r.path.endsWith('$') ? new RegExp(`${toRegex(pat).source}$`) : toRegex(pat);
      if (!re.test(path)) continue;
      const len = r.path.length;
      if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { allow: r.allow, len };
    }
  }
  return best ? best.allow : true;
}

export type RobotsVerdict = { allowed: true; checked: boolean } | { allowed: false; reason: 'disallowed' | 'unreachable' };

const cache = new Map<string, { at: number; text: string | null; unreachable: boolean }>();
const TTL_MS = 3_600_000;

/** Test hook. */
export function resetRobotsCache(): void {
  cache.clear();
}

/** Fetches https://host/robots.txt (cached for an hour) and judges the page URL. */
export async function checkRobots(pageUrl: string, fetchImpl: typeof fetch, nowMs: number = Date.now()): Promise<RobotsVerdict> {
  const u = new URL(pageUrl);
  const key = u.origin;
  let hit = cache.get(key);
  if (!hit || nowMs - hit.at > TTL_MS) {
    try {
      const res = await fetchImpl(`${u.origin}/robots.txt`, { headers: { 'User-Agent': 'Holler/1.0 (+https://holler.app/about)', Accept: 'text/plain' }, signal: AbortSignal.timeout(8000) });
      if (res.ok) hit = { at: nowMs, text: (await res.text()).slice(0, 500_000), unreachable: false };
      else if (res.status >= 500) hit = { at: nowMs, text: null, unreachable: true };
      else hit = { at: nowMs, text: null, unreachable: false }; // 4xx: no robots.txt, everything allowed
    } catch {
      hit = { at: nowMs, text: null, unreachable: true };
    }
    cache.set(key, hit);
  }
  if (hit.unreachable) return { allowed: false, reason: 'unreachable' };
  if (hit.text === null) return { allowed: true, checked: false };
  return robotsAllows(hit.text, `${u.pathname}${u.search}`) ? { allowed: true, checked: true } : { allowed: false, reason: 'disallowed' };
}
