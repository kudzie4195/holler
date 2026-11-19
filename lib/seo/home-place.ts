/**
 * Where each dot and label goes on the home page radius map. Pure, no React, no I/O.
 *
 * Distance from the centre is to scale: MAP_RADIUS_MI (6 miles) is RING_FRACTION (46%) of the square map box. Only the angle is
 * free, and this module chooses it so that nothing collides at the two sizes the page draws:
 *   - LABEL_MAP_PX (520 px, the map's largest size): dots AND their text labels. No label box may overlap another label, any dot,
 *     the centre chip or a ring caption, and every label stays inside the map.
 *   - DOT_MAP_PX (272 px, the map inside a 320 px phone): labels are hidden (container query in components/home/radius-map-css.ts) and the dots
 *     carry numbers. No two 22 px dots may overlap, and no dot may touch the centre chip, a ring caption or the map edge.
 * Every gap is at least CLEARANCE_PX (6 px), and every label keeps LABEL_EDGE_PX (16 px) from the map's edge, so no label crowds the
 * card's 20 px corner. Between 272 and 519 px only dots show; dots, chip and captions keep their pixel size while
 * the distances between them grow with the map, so a placement that is clear at 272 px is clear at every larger dots-only size.
 *
 * Text metrics: labels are JetBrains Mono at 13 px. Every glyph of a monospace face has the same advance, 600 of 1000 units for
 * JetBrains Mono (read from the font file in node_modules/@fontsource-variable/jetbrains-mono), so a label is exactly
 * 0.6 x 13 = 7.8 px per character plus its padding. The components use the same constants (components/home/radius-map.tsx).
 *
 * A record that cannot be placed is dropped and the rest are placed.
 */

export const MAP_RADIUS_MI = 6;
/** 6 miles is 46% of the box width from the centre. */
export const RING_FRACTION = 0.46;
/** Ring captions at these distances. */
export const RING_MILES = [2, 4, 6] as const;

export const LABEL_MAP_PX = 520;
export const DOT_MAP_PX = 272;
export const CLEARANCE_PX = 6;
/** A label keeps at least this much room to the inside edge of the 520 px map. */
export const LABEL_EDGE_PX = 16;
/** Clearance above this counts the same; among such candidates the one furthest in angle from the placed dots wins. */
export const SPREAD_AFTER_PX = 12;

export const DOT_PX = 22;
export const FONT_PX = 13;
export const MONO_ADVANCE_EM = 0.6;
/** Label: 13 px text on a 20 px line, padding 3 px top and bottom and 7 px left and right. */
export const LABEL_LINE_PX = 20;
export const LABEL_PAD_X = 7;
export const LABEL_PAD_Y = 3;
/** The label starts this far from the dot centre (11 px dot half plus a 5 px gap). */
export const LABEL_OFFSET_PX = 16;
/** Centre chip (the ZIP): 13 px text on a 20 px line, padding 6 px top and bottom, 10 px left and right. */
export const CHIP_PAD_X = 10;
export const CHIP_PAD_Y = 6;
/** Ring caption ("2 MI"): 13 px text on a 20 px line, 6 px padding left and right. */
export const CAPTION_PAD_X = 6;
/** The caption sits just inside its ring: this many percent of the box below the ring's top point. */
export const CAPTION_DROP_PCT = 0.6;

/** Candidate angles in degrees. */
const STEP_DEG = 5;

export interface PlaceInput {
  id: string;
  /** Distance from the centre in miles, 0 to MAP_RADIUS_MI. */
  mi: number;
  /** The label text exactly as drawn, e.g. "ROOF PERMIT 2.6 MI". */
  text: string;
}

export interface Placement {
  id: string;
  mi: number;
  text: string;
  /** Angle in degrees, counter-clockwise from east. */
  deg: number;
  /** Dot centre as a percentage of the box, from the left and from the top. */
  xPct: number;
  yPct: number;
  /** Which side of the dot the label sits on. */
  side: 'left' | 'right';
}

export interface PlaceResult {
  placed: Placement[];
  dropped: string[];
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function textWidthPx(chars: number): number {
  return chars * FONT_PX * MONO_ADVANCE_EM;
}

export function labelSize(text: string): { w: number; h: number } {
  return { w: textWidthPx(text.length) + 2 * LABEL_PAD_X, h: LABEL_LINE_PX + 2 * LABEL_PAD_Y };
}

export function chipBox(zip: string, size: number): Box {
  const w = textWidthPx(zip.length) + 2 * CHIP_PAD_X;
  const h = LABEL_LINE_PX + 2 * CHIP_PAD_Y;
  const c = size / 2;
  return { x0: c - w / 2, x1: c + w / 2, y0: c - h / 2, y1: c + h / 2 };
}

export function captionText(mi: number): string {
  return `${mi} MI`;
}

/** Top of the caption's box centre, in percent of the box, for a ring of `mi` miles. */
export function captionYPct(mi: number): number {
  return 50 - (mi / MAP_RADIUS_MI) * RING_FRACTION * 100 + CAPTION_DROP_PCT;
}

export function captionBoxes(size: number): Box[] {
  return RING_MILES.map((mi) => {
    const w = textWidthPx(captionText(mi).length) + 2 * CAPTION_PAD_X;
    const h = LABEL_LINE_PX;
    const cx = size / 2;
    const cy = (captionYPct(mi) / 100) * size;
    return { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };
  });
}

/** Dot centre in percent of the box for a distance and an angle. */
export function dotPct(mi: number, deg: number): { xPct: number; yPct: number } {
  const r = (mi / MAP_RADIUS_MI) * RING_FRACTION * 100;
  const rad = (deg * Math.PI) / 180;
  return { xPct: 50 + r * Math.cos(rad), yPct: 50 - r * Math.sin(rad) };
}

export function dotBox(p: { xPct: number; yPct: number }, size: number): Box {
  const x = (p.xPct / 100) * size;
  const y = (p.yPct / 100) * size;
  const h = DOT_PX / 2;
  return { x0: x - h, x1: x + h, y0: y - h, y1: y + h };
}

export function labelBox(p: { xPct: number; yPct: number; side: 'left' | 'right'; text: string }, size: number): Box {
  const x = (p.xPct / 100) * size;
  const y = (p.yPct / 100) * size;
  const { w, h } = labelSize(p.text);
  const x0 = p.side === 'right' ? x + LABEL_OFFSET_PX : x - LABEL_OFFSET_PX - w;
  return { x0, x1: x0 + w, y0: y - h / 2, y1: y + h / 2 };
}

/** Clear space between two boxes: positive when they are apart (the larger of the horizontal and vertical gaps), negative when they overlap. */
export function gap(a: Box, b: Box): number {
  return Math.max(b.x0 - a.x1, a.x0 - b.x1, b.y0 - a.y1, a.y0 - b.y1);
}

/** Clear space between a box and the inside edge of the map. */
export function edgeGap(a: Box, size: number): number {
  return Math.min(a.x0, a.y0, size - a.x1, size - a.y1);
}

interface Drawn {
  dot520: Box;
  dot272: Box;
  label520: Box;
  deg: number;
}

function drawn(p: { xPct: number; yPct: number; side: 'left' | 'right'; text: string; deg: number }): Drawn {
  return { dot520: dotBox(p, LABEL_MAP_PX), dot272: dotBox(p, DOT_MAP_PX), label520: labelBox(p, LABEL_MAP_PX), deg: p.deg };
}

/** The smallest gap a candidate has to everything already on the map, at both sizes. */
function minClearance(c: Drawn, others: Drawn[], zip: string): number {
  const chip520 = chipBox(zip, LABEL_MAP_PX);
  const chip272 = chipBox(zip, DOT_MAP_PX);
  // A label too near the map's edge is never a candidate, however clear it is of everything else.
  if (edgeGap(c.label520, LABEL_MAP_PX) < LABEL_EDGE_PX) return -1;
  let m = Infinity;
  // Fixed things: the chip, the ring captions and the edge.
  m = Math.min(m, gap(c.label520, chip520), gap(c.dot520, chip520), gap(c.dot272, chip272));
  for (const b of captionBoxes(LABEL_MAP_PX)) m = Math.min(m, gap(c.label520, b), gap(c.dot520, b));
  for (const b of captionBoxes(DOT_MAP_PX)) m = Math.min(m, gap(c.dot272, b));
  m = Math.min(m, edgeGap(c.label520, LABEL_MAP_PX), edgeGap(c.dot520, LABEL_MAP_PX), edgeGap(c.dot272, DOT_MAP_PX));
  // Its own dot sits LABEL_OFFSET_PX - DOT_PX / 2 = 5 px from its label by construction (the design's offset). That pair belongs
  // together and is not a clearance between two things, so it is not counted here.
  for (const o of others) {
    m = Math.min(
      m,
      gap(c.label520, o.label520),
      gap(c.label520, o.dot520),
      gap(c.dot520, o.label520),
      gap(c.dot520, o.dot520),
      gap(c.dot272, o.dot272),
    );
  }
  return m;
}

function angleApart(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Place the records. Inner records first (they have the least room), then outward; for each one every angle in STEP_DEG steps and
 * both label sides are tried, and the candidate kept is the one with the most clearance counted up to SPREAD_AFTER_PX, then the
 * one furthest in angle from the dots already placed, so once a candidate is comfortably clear the dots spread round the map. A record with no candidate that clears
 * everything by CLEARANCE_PX is dropped. Deterministic: the same input gives the same output.
 */
export function placeMarkers(items: PlaceInput[], zip: string): PlaceResult {
  const order = items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => a.it.mi - b.it.mi || a.i - b.i);
  const placed: (Placement & { d: Drawn })[] = [];
  const dropped: string[] = [];
  const CAP = SPREAD_AFTER_PX;
  for (const { it } of order) {
    if (!(it.mi >= 0 && it.mi <= MAP_RADIUS_MI)) {
      dropped.push(it.id);
      continue;
    }
    let best: { p: Placement; d: Drawn; score: number; spread: number } | null = null;
    for (let deg = 0; deg < 360; deg += STEP_DEG) {
      const pos = dotPct(it.mi, deg);
      for (const side of ['right', 'left'] as const) {
        const cand = { ...pos, side, text: it.text, deg };
        const d = drawn(cand);
        const clear = minClearance(
          d,
          placed.map((p) => p.d),
          zip,
        );
        if (clear < CLEARANCE_PX) continue;
        const score = Math.min(clear, CAP);
        const spread = placed.length ? Math.min(...placed.map((p) => angleApart(p.deg, deg))) : 180;
        if (!best || score > best.score || (score === best.score && spread > best.spread)) {
          best = { p: { id: it.id, mi: it.mi, text: it.text, deg, xPct: pos.xPct, yPct: pos.yPct, side }, d, score, spread };
        }
      }
    }
    if (best) placed.push({ ...best.p, d: best.d });
    else dropped.push(it.id);
  }
  // Back in the input order.
  const byId = new Map(placed.map((p) => [p.id, p]));
  return {
    placed: items.filter((it) => byId.has(it.id)).map((it) => {
      const { d: _d, ...p } = byId.get(it.id)!;
      void _d;
      return p;
    }),
    dropped,
  };
}

/**
 * The example map's layout: the approved design's angles (V3.dc.html: 250, 20, 60, 310, 110, 185 degrees, in the order of the
 * example records) and its side rule (a dot right of 55% of the box has its label on the left). A design angle that misses a
 * clearance (on the 272 px phone map two design dots sit 3 to 4 px from a ring caption) is replaced by the clear angle that keeps
 * the most room to the other dots (the placed ones and the design angles still to come), so the set stays spread round the centre;
 * ties go to the angle nearest the design's. A record with no clear angle at all is dropped, as in placeMarkers.
 */
export const EXAMPLE_DEGREES = [250, 20, 60, 310, 110, 185] as const;

export function placeNear(items: PlaceInput[], degrees: readonly number[], zip: string): PlaceResult {
  const placed: (Placement & { d: Drawn })[] = [];
  const dropped: string[] = [];
  const at = (it: PlaceInput, deg: number) => {
    const pos = dotPct(it.mi, deg);
    const side: 'left' | 'right' = pos.xPct > 55 ? 'left' : 'right';
    const d = drawn({ ...pos, side, text: it.text, deg });
    const clear =
      minClearance(
        d,
        placed.map((p) => p.d),
        zip,
      ) >= CLEARANCE_PX;
    return { p: { id: it.id, mi: it.mi, text: it.text, deg, ...pos, side }, d, clear };
  };
  items.forEach((it, i) => {
    const want = degrees[i] ?? 0;
    const first = at(it, want);
    if (first.clear) {
      placed.push({ ...first.p, d: first.d });
      return;
    }
    const others = [...placed.map((p) => p.deg), ...degrees.slice(i + 1, items.length)];
    let best: { c: ReturnType<typeof at>; spread: number; near: number } | null = null;
    for (let deg = 0; deg < 360; deg += STEP_DEG) {
      const c = at(it, deg);
      if (!c.clear) continue;
      const spread = others.length ? Math.min(...others.map((o) => angleApart(o, deg))) : 180;
      const near = angleApart(want, deg);
      if (!best || spread > best.spread || (spread === best.spread && near < best.near)) best = { c, spread, near };
    }
    if (best) placed.push({ ...best.c.p, d: best.c.d });
    else dropped.push(it.id);
  });
  return {
    placed: placed.map(({ d: _d, ...p }) => (void _d, p)),
    dropped,
  };
}
