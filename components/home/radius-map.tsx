import { dayRange, dotText, type Family, type HomeMap } from '@/lib/seo/home-map';
import { RING_FRACTION, RING_MILES, captionText, captionYPct } from '@/lib/seo/home-place';
import { MARK_ON_BRAND, SHAPE } from './styles';
import { RADIUS_MAP_CSS } from './radius-map-css';

const s = { fig: 'hm-fig', dot: 'hm-dot', label: 'hm-label', right: 'hm-right', left: 'hm-left', caption: 'hm-caption', chip: 'hm-chip', pulse: 'hm-pulse', num: 'hm-num', key: 'hm-key' };

const FAMILY_NAME: Record<Family, string> = { permit: 'Permit', civic: '311 and code', weather: 'Weather' };
/** Dot shapes at 22 px (the legend uses SHAPE at 12 px). */
const DOT_SHAPE: Record<Family, string> = { permit: 'rounded-[5px]', civic: 'rounded-full', weather: 'rounded-[50%_50%_50%_0]' };

/** "Tree Emergency · 4.9 mi" for the key under the map on narrow screens. */
function keyText(r: { phrase: string; mi: number }): string {
  return `${r.phrase} · ${r.mi.toFixed(1)} mi`;
}

/**
 * The hero map. Distances to scale (6 miles is 46% of the box), angles from lib/seo/home-place.ts so nothing overlaps.
 * Live: real records with their dates. Example (no live data): the design's six, labelled as an example, no dates.
 * Under 520 px of figure width the labels hide, the dots show numbers and a numbered key appears (radius-map-css.ts).
 */
export function RadiusMap({ map }: { map: HomeMap }) {
  const range = dayRange(map.records.map((r) => r.occurredAt));
  const longRange = dayRange(
    map.records.map((r) => r.occurredAt),
    'long',
  );
  const list = map.records.map((r) => `${r.phrase} ${r.mi.toFixed(1)} miles`).join(', ');
  const aria = map.live
    ? `Map of real alerts${longRange ? ` from ${longRange}` : ''} around ZIP ${map.zip}, ${map.city}: ${list}.`
    : `Map of example alerts around ZIP ${map.zip}, ${map.city}, not live data: ${list}.`;
  const families = (['permit', 'civic', 'weather'] as Family[]).filter((f) => map.records.some((r) => r.family === f));
  const ringPct = (mi: number) => `${((mi / RING_MILES[RING_MILES.length - 1]) * RING_FRACTION * 200).toFixed(2)}%`;

  return (
    <figure className={`${s.fig} m-0 flex min-w-0 flex-[1_1_420px] flex-col gap-3.5`}>
      <style href="home-radius-map" precedence="default">
        {RADIUS_MAP_CSS}
      </style>
      <div role="img" aria-label={aria} className="relative mx-auto aspect-square w-full max-w-[520px] overflow-hidden rounded-card bg-brand-raised">
        {RING_MILES.map((mi) => (
          <div
            key={mi}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-dashed border-on-brand-faint/60"
            style={{ width: ringPct(mi), height: ringPct(mi) }}
          />
        ))}
        <div className={`${s.pulse} border-2 border-signal`} />
        {RING_MILES.map((mi) => (
          <span key={mi} className={`${s.caption} bg-brand-raised font-mono text-on-brand-faint`} style={{ top: `${captionYPct(mi).toFixed(2)}%` }}>
            {captionText(mi)}
          </span>
        ))}
        {map.placed.map((p, i) => {
          const r = map.records[i];
          const pos = { left: `${p.xPct.toFixed(2)}%`, top: `${p.yPct.toFixed(2)}%` };
          return (
            <span key={r.id}>
              <span
                className={`${s.dot} flex items-center justify-center border-[2.5px] border-on-brand ${DOT_SHAPE[r.family]} ${MARK_ON_BRAND[r.family]}`}
                style={{ ...pos, animationDelay: `${(0.4 + i * 0.45).toFixed(2)}s` }}
              >
                <span className={`${s.num} font-mono text-[12px] leading-none text-ink`}>{i + 1}</span>
              </span>
              <span
                className={`${s.label} ${p.side === 'right' ? s.right : s.left} rounded-chip bg-brand-deep font-mono text-on-brand`}
                style={{ ...pos, animationDelay: `${(0.6 + i * 0.45).toFixed(2)}s` }}
              >
                {dotText(r)}
              </span>
            </span>
          );
        })}
        <span className={`${s.chip} rounded-chip bg-signal font-mono font-medium text-ink`}>{map.zip}</span>
      </div>
      <figcaption className="mx-auto flex w-full max-w-[520px] flex-col gap-3 text-sm text-on-brand-muted">
        <ol className={`${s.key} m-0 list-none p-0`}>
          {map.records.map((r, i) => (
            <li key={r.id}>
              {i + 1} {keyText(r)}
            </li>
          ))}
        </ol>
        <span className="flex flex-wrap gap-x-[18px] gap-y-2">
          {families.map((f) => (
            <span key={f} className="inline-flex items-center gap-[7px]">
              <span aria-hidden="true" className={`h-3 w-3 ${SHAPE[f]} ${MARK_ON_BRAND[f]}`} />
              {FAMILY_NAME[f]}
            </span>
          ))}
        </span>
        <span>
          {map.live
            ? `Real alerts around ZIP ${map.zip}, ${map.city}${range ? `, ${range}` : ''}. Distances to scale, directions not.`
            : `Example alerts around a ${map.city} ZIP code. Not live data. Distances to scale, directions not.`}
        </span>
      </figcaption>
    </figure>
  );
}
