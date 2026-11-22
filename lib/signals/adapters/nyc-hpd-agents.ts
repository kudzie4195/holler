import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import { env } from '@/lib/env';
import { joinNycComplaints, type NycComplaint } from '@/lib/contacts/nyc-agents-fetch';
import type { NycJoinStatus } from '@/lib/contacts/nyc-agents';
import { buildSocrataQuery, parseSocrataReport } from './socrata';
import { SOCRATA_DATASETS, datasetPageUrl, type SocrataDataset } from './socrata-datasets';

/**
 * PROBATION adapter: NYC heat / hot-water 311 complaints joined to the building's registered HPD managing-agent company.
 * Same complaint set, title and summary as the live socrata-nyc-311 adapter (its query, filters and parser are reused), narrowed to
 * complaint_type 'HEAT/HOT WATER'. Rows go to holler_source_samples only (Adapter.probation), never to members. Each row carries
 * data.joinStatus so the samples show the hit rate, and a business contact when a company was found.
 *
 * data.subtype is 'hpd-agent', not '311': 311 is in NO_CONTACT_SUBTYPES and sanitizeSample would drop the contact. See the switch-on note
 * in lib/contacts/nyc-agents.ts before making this live.
 */
export const NYC_HPD_AGENTS_ID = 'nyc-hpd-agents';
export const HEAT_COMPLAINT_TYPE = 'HEAT/HOT WATER';
/** Complaints joined per run: samples keep SAMPLE_CAP (300, lib/signals/samples.ts) rows anyway. */
export const MAX_COMPLAINTS = 300;

const UA = 'Holler/1.0 (+https://holler.app/about; contact@holler)';

function nycDataset(): SocrataDataset {
  const ds = SOCRATA_DATASETS.find((d) => d.id === 'socrata-nyc-311');
  if (!ds) throw new Error('socrata-nyc-311 dataset config missing');
  return ds;
}

/** The live 311 query with one more clause: complaint_type is exactly HEAT/HOT WATER. */
export function buildHeatQuery(now: Date = new Date()): URLSearchParams {
  const p = buildSocrataQuery(nycDataset(), now);
  p.set('$where', `(${p.get('$where')}) AND complaint_type='${HEAT_COMPLAINT_TYPE}'`);
  return p;
}

type Row = Record<string, unknown>;
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));

export function countJoinStatuses(items: readonly SignalInput[]): Record<NycJoinStatus, number> {
  const out: Record<NycJoinStatus, number> = { matched: 0, ambiguous: 0, 'no-registration': 0, 'agent-individual': 0, 'no-agent': 0 };
  for (const i of items) {
    const s = i.data?.joinStatus as NycJoinStatus | undefined;
    if (s && s in out) out[s] += 1;
  }
  return out;
}

export function buildNycHpdAgentsAdapter(): Adapter {
  const ds = nycDataset();
  return {
    id: NYC_HPD_AGENTS_ID,
    label: 'New York City HPD: managing agents for heat and hot water 311 requests',
    kind: 'civic',
    cadenceMinutes: 360,
    probation: true,
    sourceUrl: 'https://data.cityofnewyork.us/d/tesw-yqqr',
    async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
      try {
        const token = ctx.env.SOCRATA_APP_TOKEN ?? env.SOCRATA_APP_TOKEN;
        const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': UA };
        if (token) headers['X-App-Token'] = token;
        const url = `https://${ds.domain}/resource/${ds.datasetId}.json?${buildHeatQuery(ctx.now ?? new Date()).toString()}`;
        const res = await ctx.fetch(url, { headers, signal: AbortSignal.timeout(15000) });
        if (!res.ok) {
          ctx.log(`${NYC_HPD_AGENTS_ID}: HTTP ${res.status}`);
          return [];
        }
        const body: unknown = await res.json();
        if (!Array.isArray(body)) {
          ctx.log(`error: ${NYC_HPD_AGENTS_ID} returned a non-array response, shape may have changed`);
          return [];
        }
        const raw = new Map<string, Row>();
        for (const r of body as Row[]) if (r && typeof r === 'object') raw.set(text(r[ds.idField]), r);
        // Same parser as the live 311 adapter: same rows kept, same title, summary, position, categories.
        const parsed = parseSocrataReport(body, ds).items.filter((i) => text(raw.get(i.externalId)?.complaint_type) === HEAT_COMPLAINT_TYPE).slice(0, MAX_COMPLAINTS);
        const complaints: NycComplaint[] = parsed.map((i) => ({ key: i.externalId, bbl: raw.get(i.externalId)?.bbl, incidentAddress: raw.get(i.externalId)?.incident_address }));
        const joined = await joinNycComplaints(complaints, { fetch: ctx.fetch, appToken: token, log: ctx.log });
        const out: SignalInput[] = [];
        for (const item of parsed) {
          const j = joined.byKey.get(item.externalId);
          if (!j) continue; // lookup not made or failed: not counted as a miss
          out.push({
            ...item,
            source: NYC_HPD_AGENTS_ID,
            url: datasetPageUrl(ds),
            data: { ...item.data, subtype: 'hpd-agent', baseSubtype: '311', joinStatus: j.status, registrationCandidates: j.candidates, matchStep: j.step, agentNamesRejected: j.rejectedNames },
            ...(j.agent
              ? {
                  contacts: [
                    { role: 'business' as const, name: j.agent.company, city: j.agent.businessCity, state: j.agent.businessState, zip: j.agent.businessZip },
                  ],
                }
              : {}),
          });
        }
        const c = countJoinStatuses(out);
        ctx.log(`${NYC_HPD_AGENTS_ID}: ${out.length} of ${parsed.length} joined in ${joined.calls} calls; matched ${c.matched}, ambiguous ${c.ambiguous}, no-registration ${c['no-registration']}, agent-individual ${c['agent-individual']}, no-agent ${c['no-agent']}`);
        return out;
      } catch (e) {
        ctx.log(`${NYC_HPD_AGENTS_ID}: ${e instanceof Error ? e.message : String(e)}`);
        return [];
      }
    },
  };
}

export const adapters: Adapter[] = [buildNycHpdAgentsAdapter()];
