/**
 * Owner-run check for round 15 Unit G (PLAN-2.0 1.2 and 1.3). Needs the network, so it was NOT run in the session that wrote it.
 * For every permit feed with a contact spec or value columns it (1) reads the portal's own column list and prints which spec columns exist
 * and which are missing, and (2) with --sample, fetches up to 200 recent rows and prints the named-company rate and the value rate that
 * the REAL parsers give. Read-only GET requests to public portals; writes nothing.
 *
 *   JITI_TSCONFIG_PATHS=1 node node_modules/jiti/lib/jiti-cli.mjs scripts/check-contact-columns.ts            (columns only)
 *   JITI_TSCONFIG_PATHS=1 node node_modules/jiti/lib/jiti-cli.mjs scripts/check-contact-columns.ts --sample   (columns and rates)
 */
import { contactSpecFields } from '../lib/contacts/extract';
import { SOCRATA_DATASETS } from '../lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS } from '../lib/signals/adapters/arcgis-datasets';
import { buildSocrataQuery, parseSocrata } from '../lib/signals/adapters/socrata';
import { buildArcgisQuery, parseArcgis, valueFieldsOf } from '../lib/signals/adapters/arcgis';
import type { SignalInput } from '../lib/signals/types';

const sample = process.argv.includes('--sample');
const UA = 'HollerColumnCheck/1.0';

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function rates(items: SignalInput[]): string {
  const n = items.length || 1;
  const named = items.filter((s) => s.contacts?.some((c) => (c.role === 'contractor' || c.role === 'business') && c.name)).length;
  const valued = items.filter((s) => Number((s.data as Record<string, unknown>).jobValue) > 0).length;
  const sited = items.filter((s) => s.contacts?.some((c) => c.role === 'site' && c.address)).length;
  return `rows ${items.length}: named ${named} (${((100 * named) / n).toFixed(1)}%), value ${valued} (${((100 * valued) / n).toFixed(1)}%), site ${sited} (${((100 * sited) / n).toFixed(1)}%)`;
}

function report(id: string, have: Set<string>, wanted: string[]) {
  const miss = wanted.filter((f) => !have.has(f));
  console.log(`${id}: ${wanted.length - miss.length}/${wanted.length} columns present${miss.length ? `; MISSING: ${miss.join(', ')}` : ''}`);
}

async function main() {
  for (const ds of SOCRATA_DATASETS.filter((d) => d.subtype === 'permit' && (d.contacts || d.valueFields))) {
    try {
      const meta = (await getJson(`https://${ds.domain}/api/views/${ds.datasetId}.json`)) as { columns?: { fieldName?: string }[] };
      const have = new Set((meta.columns ?? []).map((c) => String(c.fieldName ?? '')));
      report(ds.id, have, [...new Set([...contactSpecFields(ds.contacts), ...(ds.valueFields ?? [])])]);
      if (sample) {
        const q = buildSocrataQuery(ds, new Date());
        q.set('$limit', '200');
        const rows = await getJson(`https://${ds.domain}/resource/${ds.datasetId}.json?${q}`);
        console.log(`  ${rates(parseSocrata(rows, ds))}`);
      }
    } catch (e) {
      console.log(`${ds.id}: could not check (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  for (const ds of ARCGIS_DATASETS.filter((d) => d.subtype === 'permit' && (d.contacts || d.valueFields))) {
    try {
      const meta = (await getJson(`${ds.layerUrl}?f=json`)) as { fields?: { name?: string }[] };
      const have = new Set((meta.fields ?? []).map((f) => String(f.name ?? '')));
      report(ds.id, have, [...new Set([...contactSpecFields(ds.contacts), ...valueFieldsOf(ds)])]);
      if (sample) {
        const q = buildArcgisQuery(ds, new Date(), have);
        q.set('resultRecordCount', '200');
        const rows = await getJson(`${ds.layerUrl}/query?${q}`);
        console.log(`  ${rates(parseArcgis(rows, ds))}`);
      }
    } catch (e) {
      console.log(`${ds.id}: could not check (${e instanceof Error ? e.message : String(e)})`);
    }
  }
}

void main();
