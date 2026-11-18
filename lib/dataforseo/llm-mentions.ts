import { PRICE_TABLE, credentials, dfsCall, getDb, monthKey, type Db, type DfsDeps } from './client';

/**
 * Monthly AI mention check for localholler.com. Internal only: nothing here is shown on a public page.
 *
 * Endpoint: POST /v3/ai_optimization/llm_mentions/search_mentions/live
 *   https://docs.dataforseo.com/v3/ai_optimization/llm_mentions/search_mentions/live/
 *   The older path /v3/ai_optimization/llm_mentions/search/live still works but the docs say it was replaced by this one.
 *   Body (verified on the page): `target` (up to 10 entities, each one `domain` or one `keyword`), `location_code` (2840),
 *   `language_code`, `platform` (omitted = google and chat_gpt), `limit` (default 100, max 1000), `order_by`.
 *   Keyword entity: `keyword`, `search_scope` (any, question, answer, brand_entities, fan_out_queries), `match_type`
 *   (word_match or partial_match). Domain entity: `domain` (no https:// or www.), `search_scope` (any, sources, search_results),
 *   `include_subdomains`.
 *   Response (verified): tasks[0].result[0] = { total_count, items_count, items[] }; item = { platform, question, answer (markdown),
 *   sources[] { domain, url, title }, ai_search_volume, brand_entities[] { title }, ... }; `cost` top level and per task.
 * What this endpoint is: a search over a DataForSEO dataset of AI questions and answers. It does not ask ChatGPT or Google anything
 * on our behalf. So each fixed query is looked up as a partial match against the QUESTION text, and the returned answers are
 * scanned for localholler.com. A query that matches no stored question is reported as 'no_data', not as 'not found'.
 * Unverified: how several `target` entities combine (the page does not say), so every call here carries exactly one entity.
 * Unverified: the exact price (see PRICE_TABLE in client.ts).
 */

export const TARGET_DOMAIN = 'localholler.com';
export const DOMAIN_LABEL = `domain:${TARGET_DOMAIN}`;
/** Rows asked for per call. Cost grows with rows, and one match is enough to answer the question. */
export const QUERY_LIMIT = 25;
export const DOMAIN_LIMIT = 20;

/** The fixed list. The domain check below is one more call, so the total is QUERIES.length + 1, which stays at 10 or fewer. */
export const QUERIES: readonly string[] = [
  'how to find roofing leads in Atlanta',
  'storm damage leads for roofers',
  'local service business alerts from public records',
  'how to find leads for tree service after a storm',
  'building permit leads for contractors',
  'hail damage leads for auto body shops',
  'how do plumbers find work after a freeze',
  'public records lead alerts for HVAC companies',
];

export type MentionStatus = 'cited' | 'mentioned' | 'not_found' | 'no_data';

export interface MentionMatch {
  platform: string | null;
  question: string | null;
  ai_search_volume: number | null;
  cited: boolean;
  mentioned: boolean;
  source_url: string | null;
}

export interface MentionRaw {
  total_count: number | null;
  items_checked: number;
  matches: MentionMatch[];
}

export interface MentionVerdict {
  status: MentionStatus;
  cited: boolean;
  mentioned: boolean;
  totalCount: number | null;
  itemsChecked: number;
  raw: MentionRaw;
}

function hostOf(s: unknown): string {
  if (typeof s !== 'string') return '';
  try {
    return new URL(s.includes('://') ? s : `https://${s}`).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return s.toLowerCase();
  }
}

function isOurHost(h: string): boolean {
  return h === TARGET_DOMAIN || h.endsWith(`.${TARGET_DOMAIN}`);
}

const BRAND = /localholler/i;

/**
 * Pure: read a result object and decide. Fails soft on any unexpected shape (missing arrays, wrong types).
 * Only a trimmed record is returned: flags, at most 5 matching items with the question text cut to 200 characters. The answer text is
 * never kept.
 */
export function evaluateResult(result: unknown, opts: { domainCheck?: boolean } = {}): MentionVerdict {
  const r = (result && typeof result === 'object' ? result : {}) as { total_count?: unknown; items?: unknown };
  const total = typeof r.total_count === 'number' && Number.isFinite(r.total_count) ? r.total_count : null;
  const items = Array.isArray(r.items) ? (r.items as unknown[]) : [];
  const matches: MentionMatch[] = [];
  let cited = false;
  let mentioned = false;
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const it = raw as Record<string, unknown>;
    const sources = Array.isArray(it.sources) ? (it.sources as unknown[]) : [];
    let sourceUrl: string | null = null;
    let itemCited = false;
    for (const s of sources) {
      if (!s || typeof s !== 'object') continue;
      const so = s as { domain?: unknown; url?: unknown };
      if (isOurHost(hostOf(so.domain)) || isOurHost(hostOf(so.url))) {
        itemCited = true;
        sourceUrl = typeof so.url === 'string' ? so.url.slice(0, 300) : null;
        break;
      }
    }
    const brandTitles = Array.isArray(it.brand_entities) ? (it.brand_entities as { title?: unknown }[]) : [];
    const itemMentioned =
      (typeof it.answer === 'string' && BRAND.test(it.answer)) || brandTitles.some((b) => typeof b?.title === 'string' && BRAND.test(b.title));
    if (itemCited) cited = true;
    if (itemMentioned) mentioned = true;
    if ((itemCited || itemMentioned) && matches.length < 5) {
      matches.push({
        platform: typeof it.platform === 'string' ? it.platform.slice(0, 20) : null,
        question: typeof it.question === 'string' ? it.question.slice(0, 200) : null,
        ai_search_volume: typeof it.ai_search_volume === 'number' && Number.isFinite(it.ai_search_volume) ? it.ai_search_volume : null,
        cited: itemCited,
        mentioned: itemMentioned,
        source_url: sourceUrl,
      });
    }
  }
  // For the domain call every returned row already has the domain as a source or result, so a positive total counts as cited
  // even when the rows came back without a sources array.
  if (opts.domainCheck && !cited && total !== null && total > 0) cited = true;
  const status: MentionStatus = cited ? 'cited' : mentioned ? 'mentioned' : (total ?? items.length) === 0 ? 'no_data' : 'not_found';
  return { status, cited, mentioned, totalCount: total, itemsChecked: items.length, raw: { total_count: total, items_checked: items.length, matches } };
}

export type MentionRunStatus = 'not_configured' | 'db_unavailable' | 'done' | 'partial' | 'cap_reached';

export interface MentionRun {
  status: MentionRunStatus;
  month: string;
  checked: number;
  skipped: number;
  failed: number;
  spentUsd: number;
  detail?: string;
}

function taskFor(label: string): { task: Record<string, unknown>; items: number; domainCheck: boolean } {
  if (label === DOMAIN_LABEL) {
    return {
      task: { target: [{ domain: TARGET_DOMAIN, include_subdomains: true }], location_code: 2840, language_code: 'en', limit: DOMAIN_LIMIT, order_by: ['ai_search_volume,desc'] },
      items: DOMAIN_LIMIT,
      domainCheck: true,
    };
  }
  return {
    task: {
      target: [{ keyword: label, search_scope: ['question'], match_type: 'partial_match' }],
      location_code: 2840,
      language_code: 'en',
      limit: QUERY_LIMIT,
      order_by: ['ai_search_volume,desc'],
    },
    items: QUERY_LIMIT,
    domainCheck: false,
  };
}

async function doneLabels(db: Db, month: string): Promise<Set<string>> {
  const { data, error } = await db.from('holler_llm_mentions').select('query').eq('month', month).limit(100);
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as { query: string }[]).map((r) => r.query));
}

/** Check every fixed query not yet stored for this month. Three calls at a time. Never throws. */
export async function runLlmMentions(opts: { deps?: DfsDeps; labels?: readonly string[] } = {}): Promise<MentionRun> {
  const deps = opts.deps ?? {};
  const env = deps.env ?? process.env;
  const now = (deps.now ?? (() => new Date()))();
  const month = monthKey(now);
  const out: MentionRun = { status: 'done', month, checked: 0, skipped: 0, failed: 0, spentUsd: 0 };
  if (!credentials(env)) return { ...out, status: 'not_configured' };
  const db = await getDb(deps);
  if (!db) return { ...out, status: 'db_unavailable' };

  const all = opts.labels ?? [...QUERIES, DOMAIN_LABEL];
  const labels = all.slice(0, 10);
  let done: Set<string>;
  try {
    done = await doneLabels(db, month);
  } catch (e) {
    return { ...out, status: 'db_unavailable', detail: e instanceof Error ? e.message : String(e) };
  }
  const todo = labels.filter((l) => !done.has(l));
  out.skipped = labels.length - todo.length;

  let capHit = false;
  for (let i = 0; i < todo.length && !capHit; i += 3) {
    const group = todo.slice(i, i + 3);
    const results = await Promise.all(
      group.map(async (label) => {
        const t = taskFor(label);
        const res = await dfsCall(PRICE_TABLE.llmMentionsSearch.path, t.task, { kind: 'llmMentionsSearch', items: t.items }, { ...deps, db });
        return { label, t, res };
      }),
    );
    for (const { label, t, res } of results) {
      if (!res.ok) {
        if (res.reason === 'cap_reached') capHit = true;
        out.failed += 1;
        if (!out.detail) out.detail = `${res.reason}${res.detail ? ': ' + res.detail : ''}`;
        continue;
      }
      out.spentUsd = Math.round((out.spentUsd + res.cost) * 100_000) / 100_000;
      const result = Array.isArray((res.task as { result?: unknown }).result) ? ((res.task as { result: unknown[] }).result[0] ?? null) : null;
      const v = evaluateResult(result, { domainCheck: t.domainCheck });
      const { error } = await db.from('holler_llm_mentions').upsert(
        [{
          month,
          query: label,
          status: v.status,
          cited: v.cited,
          mentioned: v.mentioned,
          total_count: v.totalCount,
          items_checked: v.itemsChecked,
          raw: v.raw,
          cost_usd: res.cost,
          checked_at: now.toISOString(),
        }],
        { onConflict: 'month,query' },
      );
      if (error) {
        out.failed += 1;
        if (!out.detail) out.detail = `store failed: ${error.message}`;
      } else out.checked += 1;
    }
  }
  if (capHit) out.status = 'cap_reached';
  else if (out.failed > 0) out.status = 'partial';
  return out;
}
