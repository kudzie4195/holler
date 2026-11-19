import { describe, expect, it } from 'vitest';
import { bestAlerts, defaultRank } from '@/lib/lifecycle/best';
import type { AlertItem } from '@/lib/lifecycle/templates';

const it_ = (title: string, severity: number | null, occurredAt: string): AlertItem => ({ title, severity, occurredAt, kind: 'alert' });
const A = it_('A', 3, '2026-11-10T00:00:00Z');
const B = it_('B', 3, '2026-11-12T00:00:00Z');
const C = it_('C', 2, '2026-11-18T00:00:00Z');
const D = it_('D', 1, '2026-11-19T00:00:00Z');
const E = it_('E', null, '2026-11-19T01:00:00Z');

describe('bestAlerts', () => {
  it('highest severity first, then newest, three of them', () => {
    expect(bestAlerts([D, A, C, B, E]).map((x) => x.title)).toEqual(['B', 'A', 'C']);
  });
  it('a missing severity counts as the lowest (1) and ties go newest first', () => {
    expect(defaultRank([D, E]).map((x) => x.title)).toEqual(['E', 'D']);
  });
  it('fewer than three in, fewer out; none in, none out', () => {
    expect(bestAlerts([A])).toEqual([A]);
    expect(bestAlerts([])).toEqual([]);
  });
  it('the rank hook receives the default order and its order wins', () => {
    let seen: string[] = [];
    const out = bestAlerts([D, A, C, B], (items) => {
      seen = items.map((x) => x.title);
      return [...items].reverse();
    });
    expect(seen).toEqual(['B', 'A', 'C', 'D']);
    expect(out.map((x) => x.title)).toEqual(['D', 'C', 'A']);
  });
  it('the hook cannot add items: unknown ones are dropped, left-out ones are appended in default order', () => {
    const stranger = it_('X', 3, '2026-11-19T00:00:00Z');
    const out = bestAlerts([A, B, C, D], () => [stranger, C, C]);
    expect(out.map((x) => x.title)).toEqual(['C', 'B', 'A']);
  });
  it('a hook that throws or returns garbage falls back to the default order', () => {
    expect(bestAlerts([A, B, C], () => { throw new Error('ai down'); }).map((x) => x.title)).toEqual(['B', 'A', 'C']);
    expect(bestAlerts([A, B, C], (() => null) as never).map((x) => x.title)).toEqual(['B', 'A', 'C']);
  });
  it('does not mutate its input', () => {
    const input = [D, A, C, B];
    bestAlerts(input);
    expect(input).toEqual([D, A, C, B]);
  });
});
