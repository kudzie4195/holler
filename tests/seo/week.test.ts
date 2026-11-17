import { describe, expect, it } from 'vitest';
import {
  WEEK_INDEX_MIN,
  WEEK_WINDOW,
  isCurrentWeek,
  isWeekIndexable,
  isoDay,
  mondayOf,
  parseWeek,
  thisAndLastWeek,
  weekNeighbors,
  weekPath,
} from '../../lib/seo/week';

// Tuesday 2026-11-17 12:00 UTC. Monday of that week is 2026-11-16.
const NOW = Date.parse('2026-11-17T12:00:00Z');
const WEEK = 7 * 86_400_000;
const monday = (weeksAgo: number) => isoDay(Date.parse('2026-11-16T00:00:00Z') - weeksAgo * WEEK);

describe('mondayOf', () => {
  it('maps every day of an ISO week to its Monday (UTC)', () => {
    for (const d of ['16', '17', '18', '19', '20', '21', '22']) expect(isoDay(mondayOf(Date.parse(`2026-11-${d}T23:59:59Z`)))).toBe('2026-11-16');
    expect(isoDay(mondayOf(Date.parse('2026-11-23T00:00:00Z')))).toBe('2026-11-23');
  });
  it('crosses year boundaries', () => {
    expect(isoDay(mondayOf(Date.parse('2027-01-01T10:00:00Z')))).toBe('2026-12-28');
  });
});

describe('parseWeek', () => {
  it('accepts the current Monday and the 11 before it, and nothing older', () => {
    expect(WEEK_WINDOW).toBe(12);
    for (let i = 0; i < 12; i++) {
      const p = parseWeek(monday(i), NOW);
      expect(p.ok, monday(i)).toBe(true);
      if (p.ok) expect(p.iso).toBe(monday(i));
    }
    expect(parseWeek(monday(12), NOW)).toEqual({ ok: false, reason: 'too-old' });
    expect(parseWeek(monday(30), NOW)).toEqual({ ok: false, reason: 'too-old' });
  });
  it('rejects every non-Monday', () => {
    for (const d of ['17', '18', '19', '20', '21', '22']) expect(parseWeek(`2026-11-${d}`, NOW)).toEqual({ ok: false, reason: 'monday' });
    expect(parseWeek('2026-11-09', NOW).ok).toBe(true);
    expect(parseWeek('2026-11-10', NOW)).toEqual({ ok: false, reason: 'monday' });
  });
  it('rejects the future, including next Monday', () => {
    expect(parseWeek('2026-11-23', NOW)).toEqual({ ok: false, reason: 'future' });
    expect(parseWeek('2027-01-04', NOW)).toEqual({ ok: false, reason: 'future' });
  });
  it('the new week opens at Monday 00:00 UTC and not before', () => {
    const justBefore = Date.parse('2026-11-22T23:59:59Z');
    const justAfter = Date.parse('2026-11-23T00:00:00Z');
    expect(parseWeek('2026-11-23', justBefore).ok).toBe(false);
    expect(parseWeek('2026-11-23', justAfter).ok).toBe(true);
    // and the oldest week drops out at the same moment
    expect(parseWeek('2026-08-31', justBefore).ok).toBe(true);
    expect(parseWeek('2026-08-31', justAfter).ok).toBe(false);
    expect(parseWeek('2026-09-07', justAfter).ok).toBe(true);
  });
  it('rejects malformed input strictly', () => {
    for (const bad of ['garbage', '', '2026-1-16', '26-11-16', '2026/11/16', '2026-11-16 ', ' 2026-11-16', '2026-11-16T00:00:00Z', '2026-13-01', '2026-02-30', '2026-00-10', '2026-11-00', '20261116', '0000-00-00', '2026-11-16%00', '٢٠٢٦-١١-١٦']) {
      expect(parseWeek(bad, NOW), JSON.stringify(bad)).toEqual({ ok: false, reason: 'format' });
    }
  });
  it('does not let Date.UTC two-digit-year handling through', () => {
    expect(parseWeek('0026-11-16', NOW).ok).toBe(false);
  });
});

describe('neighbours and helpers', () => {
  it('next only when not in the future, previous only inside the window', () => {
    expect(weekNeighbors(Date.parse(monday(0)), NOW)).toEqual({ prev: monday(1), next: null });
    expect(weekNeighbors(Date.parse(monday(1)), NOW)).toEqual({ prev: monday(2), next: monday(0) });
    expect(weekNeighbors(Date.parse(monday(11)), NOW)).toEqual({ prev: null, next: monday(10) });
  });
  it('every neighbour that is offered is a valid page', () => {
    for (let i = 0; i < 12; i++) {
      const n = weekNeighbors(Date.parse(monday(i)), NOW);
      if (n.prev) expect(parseWeek(n.prev, NOW).ok).toBe(true);
      if (n.next) expect(parseWeek(n.next, NOW).ok).toBe(true);
    }
  });
  it('this and last week', () => {
    expect(thisAndLastWeek(NOW)).toEqual({ thisWeek: '2026-11-16', lastWeek: '2026-11-09' });
    expect(isCurrentWeek(Date.parse('2026-11-16T00:00:00Z'), NOW)).toBe(true);
    expect(isCurrentWeek(Date.parse('2026-11-09T00:00:00Z'), NOW)).toBe(false);
  });
  it('indexable from 10 records', () => {
    expect(WEEK_INDEX_MIN).toBe(10);
    expect(isWeekIndexable(9)).toBe(false);
    expect(isWeekIndexable(10)).toBe(true);
    expect(isWeekIndexable(NaN)).toBe(false);
  });
  it('path', () => {
    expect(weekPath('/local/north-carolina/raleigh-nc', '2026-11-16')).toBe('/local/north-carolina/raleigh-nc/week/2026-11-16');
  });
});
