// The radius map placement (lib/seo/home-place.ts): zero overlaps and at least 3 px clearance, checked here with an independent
// geometry check written from the design numbers, for the design's six, the preview fixture and 200 random sets.
import { describe, expect, it } from 'vitest';
import { placeMarkers, type Placement } from '@/lib/seo/home-place';
import { exampleMap, dotText, pickMapRecords } from '@/lib/seo/home-map';
import { fixtureMapRows } from '@/lib/seo/home-live';
import { lookupZip } from '@/lib/geo';

// Independent restatement of what the page draws (components/home/radius-map.tsx and radius-map-css.ts).
const MONO_PX = 13 * 0.6; // JetBrains Mono: every advance is 600 of 1000 units
const DOT = 22;
const label = (text: string) => ({ w: text.length * MONO_PX + 14, h: 20 + 6 });
type B = [number, number, number, number]; // x0 y0 x1 y1
const sep = (a: B, b: B) => Math.max(b[0] - a[2], a[0] - b[2], b[1] - a[3], a[1] - b[3]);
const inside = (a: B, s: number) => Math.min(a[0], a[1], s - a[2], s - a[3]);

function boxes(p: Placement, s: number) {
  const x = (p.xPct / 100) * s;
  const y = (p.yPct / 100) * s;
  const dot: B = [x - DOT / 2, y - DOT / 2, x + DOT / 2, y + DOT / 2];
  const { w, h } = label(p.text);
  const lx = p.side === 'right' ? x + 16 : x - 16 - w;
  return { dot, lab: [lx, y - h / 2, lx + w, y + h / 2] as B };
}
function fixed(s: number, zip: string): B[] {
  const cw = zip.length * MONO_PX + 20;
  const out: B[] = [[s / 2 - cw / 2, s / 2 - 16, s / 2 + cw / 2, s / 2 + 16]];
  for (const mi of [2, 4, 6]) {
    const cy = ((50 - (mi / 6) * 46 + 0.6) / 100) * s;
    const w = `${mi} MI`.length * MONO_PX + 12;
    out.push([s / 2 - w / 2, cy - 10, s / 2 + w / 2, cy + 10]);
  }
  return out;
}

/** The smallest gap anywhere on the map, at 520 px (labels and dots) and 272 px (dots only). */
function worstGap(placed: Placement[], zip = '60614'): number {
  let m = Infinity;
  const big = placed.map((p) => boxes(p, 520));
  const small = placed.map((p) => boxes(p, 272));
  for (let i = 0; i < placed.length; i++) {
    for (const f of fixed(520, zip)) m = Math.min(m, sep(big[i].lab, f), sep(big[i].dot, f));
    for (const f of fixed(272, zip)) m = Math.min(m, sep(small[i].dot, f));
    m = Math.min(m, inside(big[i].lab, 520), inside(big[i].dot, 520), inside(small[i].dot, 272));
    for (let j = 0; j < placed.length; j++) {
      if (i === j) continue;
      m = Math.min(m, sep(big[i].lab, big[j].lab), sep(big[i].lab, big[j].dot), sep(big[i].dot, big[j].dot), sep(small[i].dot, small[j].dot));
    }
  }
  return m;
}

/** Distance from the centre must stay to scale: 6 miles = 46% of the box. */
function toScale(p: Placement): number {
  return Math.hypot(p.xPct - 50, p.yPct - 50) - (p.mi / 6) * 46;
}

let seed = 20261119;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

describe('radius map placement', () => {
  it('the design six: all placed, no overlap, at least 3 px clear, distances to scale', () => {
    const m = exampleMap();
    expect(m.placed).toHaveLength(6);
    expect(worstGap(m.placed)).toBeGreaterThanOrEqual(3);
    for (const p of m.placed) expect(Math.abs(toScale(p))).toBeLessThan(1e-9);
    expect(m.placed.map((p) => p.text)).toEqual([
      'HVAC PERMIT 1.7 MI',
      'ROOF PERMIT 2.6 MI',
      'PLUMBING PERMIT 3.5 MI',
      'TREE EMERGENCY 4.9 MI',
      'ROOF REPAIR 5.0 MI',
      'PORCH REPAIR 5.5 MI',
    ]);
  });

  it('the preview fixture: the picked records are all placed with no overlap', () => {
    const now = new Date('2026-11-19T15:00:00Z');
    const recs = pickMapRecords(fixtureMapRows(now), lookupZip('60614')!, now.getTime());
    expect(recs.length).toBeGreaterThanOrEqual(4);
    const r = placeMarkers(
      recs.map((x) => ({ id: x.id, mi: x.mi, text: dotText(x) })),
      '60614',
    );
    expect(r.dropped).toEqual([]);
    expect(worstGap(r.placed)).toBeGreaterThanOrEqual(3);
  });

  it('200 random sets (0.3 to 6.0 miles, labels of 6 to 16 characters): zero overlaps and 3 px clearance among what is placed', () => {
    let placedTotal = 0;
    let droppedFar = 0;
    for (let k = 0; k < 200; k++) {
      const items = Array.from({ length: 6 }, (_, i) => {
        const mi = Math.round((0.3 + rnd() * 5.7) * 10) / 10;
        const len = 6 + Math.floor(rnd() * 11);
        return { id: `r${i}`, mi, text: `${'W'.repeat(len)} ${mi.toFixed(1)} MI` };
      });
      const r = placeMarkers(items, '60614');
      expect(r.placed.length + r.dropped.length).toBe(6);
      expect(new Set([...r.placed.map((p) => p.id), ...r.dropped]).size).toBe(6);
      if (r.placed.length) expect(worstGap(r.placed)).toBeGreaterThanOrEqual(3);
      for (const p of r.placed) expect(Math.abs(toScale(p))).toBeLessThan(1e-9);
      placedTotal += r.placed.length;
      droppedFar += r.dropped.filter((id) => items.find((x) => x.id === id)!.mi >= 1.5).length;
    }
    // Records under about 1.4 miles cannot clear the centre chip with a 22 px dot on a 272 px map and are dropped. Further out
    // almost everything fits.
    expect(placedTotal).toBeGreaterThanOrEqual(850);
    expect(droppedFar).toBeLessThan(60);
    console.log(JSON.stringify({ placedTotal, of: 1200, droppedAt1_5MiOrMore: droppedFar }));
  });

  it('is deterministic and drops a record it cannot place instead of overlapping', () => {
    const items = [
      { id: 'a', mi: 0.3, text: 'ROOF PERMIT 0.3 MI' },
      { id: 'b', mi: 3, text: 'HVAC PERMIT 3.0 MI' },
    ];
    const one = placeMarkers(items, '60614');
    expect(placeMarkers(items, '60614')).toEqual(one);
    expect(one.dropped).toEqual(['a']);
    expect(one.placed.map((p) => p.id)).toEqual(['b']);
    expect(placeMarkers([{ id: 'x', mi: 7, text: 'FAR 7.0 MI' }], '60614').dropped).toEqual(['x']);
  });
});
