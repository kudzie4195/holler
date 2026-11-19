import { shortDay, type HomeMap } from '@/lib/seo/home-map';
import { newestRecord } from './select';

/**
 * Signal strip under the hero: the newest of the records drawn on the live map (not the newest record near the ZIP, so it says
 * "on the map"). Not rendered without live data. Centred on every line when it wraps.
 */
export function LatestBand({ map }: { map: HomeMap }) {
  const r = newestRecord(map);
  if (!r || !r.occurredAt) return null;
  return (
    <p className="m-0 flex flex-wrap justify-center gap-x-4 gap-y-1 bg-signal px-6 py-3.5 text-center font-mono text-sm text-ink">
      <span className="tracking-[0.06em]">NEWEST ON THE MAP</span>
      <span>
        {r.label} · {r.mi.toFixed(1)} MI · <time dateTime={r.occurredAt}>{shortDay(r.occurredAt).toUpperCase()}</time>
      </span>
    </p>
  );
}
