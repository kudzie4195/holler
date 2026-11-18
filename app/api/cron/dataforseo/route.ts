import { env } from '@/lib/env';
import { isCronAuthorized } from '@/lib/email/cron-auth';
import { DEFAULT_MONTHLY_CAP_USD, getDb, monthKey, monthSpendUsd, monthlyCapUsd } from '@/lib/dataforseo/client';
import { QUERIES, runLlmMentions } from '@/lib/dataforseo/llm-mentions';
import { buildKeywordPlan, expectedVolumeCostUsd, loadDoneKeywords, refreshVolumes } from '@/lib/dataforseo/volume';

// Monthly DataForSEO job. Two steps, both resumable and both skipped for anything already stored this month:
//   1. AI mention check (llm-mentions.ts): at most 9 calls, once a month.
//   2. Search volume refresh (volume.ts): "<trade> <city>" keywords in batches of up to 1000, as many as the time budget and the
//      monthly spend cap allow. A full month takes several runs, so the schedule fires it a few times in the first days of the
//      month; a run with nothing left to do costs nothing.
// GET with Authorization: Bearer CRON_SECRET or ?key=. ?dry=1 reads state only: no DataForSEO call, no spend.
// Internal: the response is for the owner, nothing here is shown on a public page.
export const maxDuration = 60;

const RUN_BUDGET_MS = 50_000;

export async function GET(req: Request) {
  if (!isCronAuthorized(req, env.CRON_SECRET)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const dry = ['1', 'true'].includes(new URL(req.url).searchParams.get('dry') ?? '');
  const started = Date.now();
  const month = monthKey(new Date());
  const noStore = { headers: { 'Cache-Control': 'no-store' } };

  if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
    return Response.json({ month, status: 'not_configured' }, noStore);
  }

  if (dry) {
    const db = await getDb({});
    const plan = buildKeywordPlan();
    const expected = expectedVolumeCostUsd(plan);
    let spent: number | null = null;
    let done: number | null = null;
    if (db) {
      try {
        spent = await monthSpendUsd(db, month);
        done = (await loadDoneKeywords(db, month)).size;
      } catch {
        // leave null
      }
    }
    return Response.json(
      { month, dry: true, capUsd: monthlyCapUsd(), defaultCapUsd: DEFAULT_MONTHLY_CAP_USD, spentUsd: spent, keywordsStored: done, expectedVolume: expected, llmQueries: QUERIES.length + 1 },
      noStore,
    );
  }

  // The mention check is small and concurrent, so it goes first; the volume refresh uses the rest of the time.
  const llm = await runLlmMentions({ deps: { timeoutMs: 25_000 } });
  const left = Math.max(0, RUN_BUDGET_MS - (Date.now() - started));
  const volume = await refreshVolumes({ budgetMs: left });
  return Response.json({ month, llm, volume, elapsedMs: Date.now() - started }, noStore);
}
