import { clientIp, hit } from '@/lib/auth/ratelimit';
import { distanceFrom, groupItems, safeUrl } from '@/lib/check/group';
import { gateCheck } from '@/lib/check/limit';
import { loadCheck } from '@/lib/check/load';
import { MISSING_TRADE, parseCheckParams } from '@/lib/check/params';
import { deriveScope } from '@/lib/check/scope';
import { tradeLabel } from '@/lib/check/trades';
import { lookupZip } from '@/lib/geo';
import { getSourceMeta } from '@/lib/signals/source-meta';
import { fail, ok, preflight } from '@/lib/mobile/http';
import type { CheckGroupDto, CheckResponse } from '@/lib/mobile/types';

const METHODS = 'GET';

export function OPTIONS(req: Request) {
  return preflight(req, METHODS);
}

/**
 * GET /api/m/check?zip=&trade= (public): the free area check from /check. Same validation (parseCheckParams), same ZIP lookup and
 * scope, the same per-IP limiter (gateCheck: 15 views a minute), the same cached reader (loadCheck) and the same grouping.
 * When the limiter itself cannot run, the read goes ahead as on the web page (the cached reader bounds it).
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const params = parseCheckParams({ zip: sp.get('zip'), trade: sp.get('trade') });
  if (params.status === 'empty') return fail(req, METHODS, 'invalid', 'Enter your ZIP code.');
  // The web page treats a ZIP with no trade as a step; the API needs both, so it answers as it always has.
  if (params.status === 'zip') return fail(req, METHODS, 'invalid', MISSING_TRADE);
  if (params.status === 'invalid') return fail(req, METHODS, 'invalid', params.zipError ?? params.tradeError ?? 'Check the ZIP code and trade.');

  const place = lookupZip(params.zip);
  if (!place) return fail(req, METHODS, 'invalid', 'We could not find that ZIP code. Check it and try again.');

  const now = Date.now();
  const origin = { lat: place.lat, lon: place.lon };
  const base: Omit<CheckResponse, 'ok' | 'mode' | 'groups' | 'checkedAt'> = {
    place: { zip: place.zip, city: place.city, state: place.state },
    trade: { id: params.trade, label: tradeLabel(params.trade) },
  };
  const scope = deriveScope(place);
  if (!scope.covered) return ok(req, METHODS, { ...base, mode: 'uncovered', groups: [], checkedAt: new Date(now).toISOString() });

  const gate = await gateCheck(clientIp(req), hit);
  if (gate === 'limited') return ok(req, METHODS, { ...base, mode: 'limited', groups: [], checkedAt: new Date(now).toISOString() });

  const data = await loadCheck(scope.cellLat, scope.cellLon, scope.state, params.trade);
  const groups: CheckGroupDto[] = groupItems(data.items, now, origin).map((g) => ({
    id: g.id,
    title: g.title,
    items: g.items.map((it) => {
      const d = distanceFrom(origin, it);
      return {
        id: it.id,
        kind: it.kind,
        source: it.source,
        sourceLabel: getSourceMeta(it.source)?.label ?? null,
        title: it.title,
        url: safeUrl(it.url),
        place: it.place,
        occurredAt: it.occurredAt,
        severity: it.severity,
        distanceMi: d === null ? null : Math.round(d * 10) / 10,
      };
    }),
  }));
  return ok(req, METHODS, { ...base, mode: data.ok ? 'results' : 'unreadable', groups, checkedAt: data.checkedAt });
}
