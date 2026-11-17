import type { CategoryId } from '@/lib/signals/categories';
import type { SignalRowInput } from '@/lib/signals/store';
import { REQUEST_SEVERITY, REQUEST_SOURCE } from './constants';
import { tradeLabel } from '@/lib/check/trades';

/**
 * The columns of holler_requests that the public record is built from. Never the email, the raw description or the filtered text:
 * the public row carries no free text at all.
 */
export interface PublishableRequest {
  public_id: string;
  trade: string;
  zip: string;
  city: string | null;
  state: string | null;
  place_slug: string | null;
  lat: number | null;
  lon: number | null;
}

/** "Service request in Atlanta: Roofing". Built only from the trade list and the ZIP lookup, never from free text. */
export function requestTitle(city: string | null, trade: string): string {
  return `Service request in ${city ?? 'your area'}: ${tradeLabel(trade)}`;
}

/**
 * The one public holler_signals row for a confirmed request.
 * url is the /request page (there is no per-request public page), data is empty and summary is always null: the filtered description
 * lives only in holler_requests (service role) and reaches only the businesses matched to the request (lib/requests/details.ts).
 * Migration 0005 enforces it (holler_signals_request_no_text).
 */
export function buildRequestSignal(
  req: PublishableRequest,
  opts: { siteUrl: string; now: Date; expiresAt: Date },
): SignalRowInput {
  return {
    source: REQUEST_SOURCE,
    externalId: req.public_id,
    kind: 'ask',
    title: requestTitle(req.city, req.trade),
    summary: null,
    url: `${opts.siteUrl}/request`,
    lat: req.lat,
    lon: req.lon,
    city: req.city,
    state: req.state,
    county: null,
    zip: req.zip,
    placeSlug: req.place_slug,
    categories: [req.trade as CategoryId],
    severity: REQUEST_SEVERITY,
    occurredAt: opts.now.toISOString(),
    expiresAt: opts.expiresAt.toISOString(),
    data: {},
  };
}
