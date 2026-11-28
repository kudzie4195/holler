import { env } from '@/lib/env';
import { isCronAuthorized } from '@/lib/email/cron-auth';
import { DEFAULT_MONTHLY_CAP_USD, estimateUsd, getDb, monthKey, monthSpendUsd, monthlyCapUsd } from '@/lib/dataforseo/client';
import { QUERIES, QUERY_LIMIT, runLlmMentions } from '@/lib/dataforseo/llm-mentions';
import { buildLocationPlan, expectedLocationCostUsd, loadDoneLocationKeywords, refreshLocationVolumes } from '@/lib/dataforseo/location-volume';
import { keywordVolumeEnabled } from '@/lib/dataforseo/switch';
import { buildKeywordPlan, expectedVolumeCostUsd, loadDoneKeywords, refreshVolumes } from '@/lib/dataforseo/volume';

// Monthly DataForSEO job. Three steps, all resumable and all skipped for anything already stored this month:
//   1. AI mention check (llm-mentions.ts): at most 9 calls, once a month.
//   2. Location mode (location-volume.ts, round 35): plain trade words with a suburb as the location, one request per city, for the
//      four launch metros. 40 requests a month.
//   3. Search volume refresh (volume.ts): "<trade> <city>" keywords in batches of up to 1000, as many as the time budget and the
//      monthly spend cap allow. A full month takes several runs, so the schedule fires it a few times in the first days of the
//      month; a run with nothing left to do costs nothing.
// Round 35: nothing is called or spent unless HOLLER_KEYWORD_VOLUME_ENABLED is on (lib/dataforseo/switch.ts); off, the answer is
// status "disabled". Every call, in every step, still counts against DATAFORSEO_MONTHLY_CAP_USD.
// GET with Authorization: Bearer CRON_SECRET only (?key= is refused). ?dry=1 reads state only: no DataForSEO call, no spend, switch on or off.
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
    let locationDone: number | null = null;
    if (db) {
      try {
        spent = await monthSpendUsd(db, month);
        done = (await loadDoneKeywords(db, month)).size;
        locationDone = (await loadDoneLocationKeywords(db, month)).size;
      } catch {
        // leave null
      }
    }
    const expectedLocation = expectedLocationCostUsd(buildLocationPlan());
    const llmUsd = Math.round((QUERIES.length + 1) * estimateUsd('llmMentionsSearch', QUERY_LIMIT) * 1000) / 1000;
    const totalUsd = Math.round((expected.usd + expectedLocation.usd + llmUsd) * 1000) / 1000;
    return Response.json(
      {
        month,
        dry: true,
        enabled: keywordVolumeEnabled(),
        capUsd: monthlyCapUsd(),
        defaultCapUsd: DEFAULT_MONTHLY_CAP_USD,
        spentUsd: spent,
        keywordsStored: done,
        locationKeywordsStored: locationDone,
        expectedVolume: expected,
        expectedLocation,
        expectedMonthlyUsd: { volume: expected.usd, location: expectedLocation.usd, llm: llmUsd, total: totalUsd },
        llmQueries: QUERIES.length + 1,
      },
      noStore,
    );
  }

  if (!keywordVolumeEnabled()) {
    return Response.json({ month, status: 'disabled', reason: 'HOLLER_KEYWORD_VOLUME_ENABLED is off', spentUsd: 0 }, noStore);
  }

  // The mention check is small and concurrent, so it goes first; the volume refresh uses the rest of the time.
  const llm = await runLlmMentions({ deps: { timeoutMs: 25_000 } });
  // Location mode is the small, owner-wanted set (40 requests), so it goes before the national batches and finishes in the first runs.
  const locationLeft = Math.max(0, RUN_BUDGET_MS - (Date.now() - started));
  const location = await refreshLocationVolumes({ budgetMs: locationLeft });
  const left = Math.max(0, RUN_BUDGET_MS - (Date.now() - started));
  const volume = await refreshVolumes({ budgetMs: left });
  return Response.json({ month, llm, location, volume, elapsedMs: Date.now() - started }, noStore);
}
