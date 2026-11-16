import { classifyText, type CategoryId } from '@/lib/signals/categories';
import type { Adapter, AdapterContext, Severity, SignalInput } from '@/lib/signals/types';
import { env } from '@/lib/env';
import {
  CIVIC_TYPE_KEYWORDS,
  RULES_BY_SUBTYPE,
  SOCRATA_DATASETS,
  datasetPageUrl,
  type SocrataDataset,
} from './socrata-datasets';

const LIMIT = 500;
const UA = 'Holler/1.0 (+https://holler.app/about; contact@holler)';

type Row = Record<string, unknown>;

function s(row: Row, field?: string): string {
  if (!field) return '';
  const v = row[field];
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function trunc(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 3).trimEnd()}...`;
}

function validLatLon(lat: number | null, lon: number | null): { lat: number; lon: number } | null {
  if (lat == null || lon == null) return null;
  if (lat === 0 && lon === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** Socrata `location` / `point` values come as {latitude, longitude} strings or GeoJSON Points. */
export function extractLatLon(row: Row, ds: SocrataDataset): { lat: number; lon: number; approx: boolean } | null {
  if (ds.latField && ds.lonField) {
    const p = validLatLon(num(row[ds.latField]), num(row[ds.lonField]));
    if (p) return { ...p, approx: false };
  }
  if (ds.locationField) {
    const v = row[ds.locationField] as unknown;
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (Array.isArray(o.coordinates) && o.coordinates.length >= 2) {
        const p = validLatLon(num(o.coordinates[1]), num(o.coordinates[0]));
        if (p) return { ...p, approx: false };
      }
      const p = validLatLon(num(o.latitude), num(o.longitude));
      if (p) return { ...p, approx: false };
    }
  }
  if (ds.latLonTextField) {
    const t = s(row, ds.latLonTextField);
    const m = t.match(/(-?\d{1,3}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)/);
    if (m) {
      let a = Number(m[1]);
      let b = Number(m[2]);
      if (a < 0 && b > 0) [a, b] = [b, a]; // "lon, lat" order guard for US coordinates
      const p = validLatLon(a, b);
      if (p) return { ...p, approx: false };
    }
  }
  if (ds.fallbackCenter) return { ...ds.fallbackCenter, approx: true };
  return null;
}

/** SODA floating timestamps have no zone; treat them as UTC so output is stable. */
export function toIso(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(v);
  const d = new Date(hasZone ? v : `${v}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function categorize(ds: SocrataDataset, text: string): { categories: CategoryId[]; severity: Severity } {
  const set = new Set<CategoryId>();
  let severity: Severity = ds.subtype === 'inspection' ? 2 : 1;
  for (const rule of RULES_BY_SUBTYPE[ds.subtype]) {
    if (rule.re.test(text)) {
      rule.add.forEach((c) => set.add(c));
      if (rule.severity && rule.severity > severity) severity = rule.severity;
    }
  }
  classifyText(text).forEach((c) => set.add(c));
  return { categories: [...set], severity };
}

/**
 * Pure parser. Rows with no matching trade are dropped (a permit for a sign or a 311 pothole is noise
 * for local trades). Inspections are kept only when the dataset's failure rule says so.
 * Never throws: malformed input returns [].
 */
export function parseSocrata(raw: unknown, ds: SocrataDataset): SignalInput[] {
  if (!Array.isArray(raw)) return [];
  const out: SignalInput[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    try {
      if (!item || typeof item !== 'object') continue;
      const row = item as Row;
      const occurredAt = toIso(row[ds.dateField]);
      const rawId = s(row, ds.idField);
      if (!occurredAt || !rawId) continue;
      if (ds.subtype === 'inspection' && ds.isFailure && !ds.isFailure(row)) continue;

      const externalId = ds.subtype === 'inspection' ? `${rawId}:${occurredAt.slice(0, 10)}` : rawId;
      if (seen.has(externalId)) continue;

      const text = ds.textFields.map((f) => s(row, f)).filter(Boolean).join(' | ');
      const { categories, severity } = categorize(ds, text);
      if (categories.length === 0) continue;

      const titleBits = ds.titleFields.map((f) => s(row, f)).filter(Boolean);
      let title: string;
      if (ds.subtype === 'permit') {
        title = `New permit in ${ds.city}: ${trunc(titleBits[0] ?? 'building permit', 110)}`;
      } else if (ds.subtype === '311') {
        const uniq = [...new Set(titleBits.map((b) => b.toLowerCase()))].map(
          (l) => titleBits.find((b) => b.toLowerCase() === l) as string,
        );
        title = `311 request in ${ds.city}: ${trunc(uniq.join(' / ') || 'service request', 110)}`;
      } else {
        title = `Failed inspection in ${ds.city}: ${trunc(s(row, ds.nameField) || 'food establishment', 100)}`;
      }

      const address = (ds.addressFields ?? []).map((f) => s(row, f)).filter(Boolean).join(' ');
      const summaryBits = ds.summaryFields.map((f) => s(row, f)).filter(Boolean);
      // 311 summaries leave the street address out; permits and inspections are business/property records.
      const summaryParts = [...new Set(summaryBits)];
      if (address && ds.subtype !== '311') summaryParts.push(address);
      const summary = trunc(summaryParts.join(' | '), 280) || null;

      const pos = extractLatLon(row, ds);
      const zip = s(row, ds.zipField).slice(0, 5) || null;
      seen.add(externalId);
      out.push({
        source: ds.id,
        externalId,
        kind: ds.kind,
        title,
        summary,
        url: datasetPageUrl(ds),
        lat: pos?.lat ?? null,
        lon: pos?.lon ?? null,
        city: ds.city,
        state: ds.state,
        zip,
        categories,
        severity,
        occurredAt,
        data: {
          dataset: ds.datasetId,
          domain: ds.domain,
          subtype: ds.subtype,
          ...(pos?.approx ? { approxLocation: true } : {}),
        },
      });
    } catch {
      // skip malformed row
    }
  }
  return out;
}

/** Builds the SODA query string. $where is on the date field; newest first; $limit 500. */
export function buildSocrataQuery(ds: SocrataDataset, since: Date): URLSearchParams {
  const sinceStr = since.toISOString().slice(0, 19); // floating timestamp, no zone
  const clauses = [`${ds.dateField} > '${sinceStr}'`];
  if (ds.extraWhere) clauses.push(`(${ds.extraWhere})`);
  if (ds.subtype === '311' && ds.typeFilterField) {
    const ors = CIVIC_TYPE_KEYWORDS.map((k) => `upper(${ds.typeFilterField}) like '%${k}%'`);
    clauses.push(`(${ors.join(' OR ')})`);
  }
  const p = new URLSearchParams();
  p.set('$where', clauses.join(' AND '));
  p.set('$order', `${ds.dateField} DESC`);
  p.set('$limit', String(LIMIT));
  return p;
}

export function buildSocrataAdapter(ds: SocrataDataset): Adapter {
  const label =
    ds.subtype === 'permit'
      ? `${ds.city} building permits`
      : ds.subtype === '311'
        ? `${ds.city} 311 requests`
        : `${ds.city} food inspections`;
  return {
    id: ds.id,
    label,
    kind: ds.kind,
    cadenceMinutes: ds.cadenceMinutes,
    sourceUrl: datasetPageUrl(ds),
    async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
      try {
        const url = `https://${ds.domain}/resource/${ds.datasetId}.json?${buildSocrataQuery(ds, ctx.since).toString()}`;
        const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': UA };
        const token = ctx.env.SOCRATA_APP_TOKEN ?? env.SOCRATA_APP_TOKEN;
        if (token) headers['X-App-Token'] = token;
        const res = await ctx.fetch(url, { headers, signal: AbortSignal.timeout(15000) });
        if (!res.ok) {
          ctx.log(`${ds.id}: HTTP ${res.status}`);
          return [];
        }
        return parseSocrata(await res.json(), ds);
      } catch (e) {
        ctx.log(`${ds.id}: ${e instanceof Error ? e.message : String(e)}`);
        return [];
      }
    },
  };
}

/** Only verified datasets are enabled by default. */
export const adapters: Adapter[] = SOCRATA_DATASETS.filter((d) => d.verified).map(buildSocrataAdapter);
