import { describe, expect, it } from 'vitest';
import { summarize, emptyPlaceData, type SignalRowDb } from '../../lib/seo/summarize';
import { MAX_SUMMARY_TYPES, buildSummarySentence, citySummary, sevenDayPeriod, summaryParts, weekPeriod } from '../../lib/seo/week-summary';

const NOW = '2026-11-17T12:00:00.000Z';
const DAY = 86_400_000;
const raleigh = { name: 'Raleigh', state: 'NC', slug: 'raleigh-nc' };

let n = 0;
function row(kind: string, subtype: string | null, daysAgo: number, extra: Partial<SignalRowDb> = {}): SignalRowDb {
  n += 1;
  return {
    id: n, source: 'test', kind, title: `${kind} ${n}`, summary: null, url: 'https://example.gov/x', categories: ['roofing'], severity: 1,
    occurred_at: new Date(Date.parse(NOW) - daysAgo * DAY).toISOString(), expires_at: null, subtype, ...extra,
  };
}
const many = (count: number, kind: string, subtype: string | null, daysAgo = 1) => Array.from({ length: count }, () => row(kind, subtype, daysAgo));

describe('buildSummarySentence', () => {
  const base = { place: 'Raleigh, NC', slug: 'raleigh-nc', period: sevenDayPeriod(NOW) };
  it('writes the quotable sentence from real counts, in title priority order', () => {
    expect(buildSummarySentence({ ...base, counts: { alerts: 1, storm: 3, permits: 42 } })).toBe(
      'In the 7 days to Nov 17, 2026, Raleigh, NC had 42 building permits, 3 storm reports and 1 weather alert.',
    );
  });
  it('names only types with a count above zero', () => {
    expect(buildSummarySentence({ ...base, counts: { permits: 0, storm: 2, requests311: 0 } })).toBe('In the 7 days to Nov 17, 2026, Raleigh, NC had 2 storm reports.');
    expect(buildSummarySentence({ ...base, counts: { storm: 1, permits: 1 } })).toBe('In the 7 days to Nov 17, 2026, Raleigh, NC had 1 building permit and 1 storm report.');
  });
  it('names at most four types, the first four by priority', () => {
    const counts = { permits: 5, storm: 4, alerts: 3, requests311: 2, inspections: 9, business: 9, violations: 9, contracts: 9, events: 9 };
    expect(MAX_SUMMARY_TYPES).toBe(4);
    expect(summaryParts({ counts })).toEqual(['5 building permits', '4 storm reports', '3 weather alerts', '2 311 requests']);
  });
  it('returns null when there is nothing to count, so the page leaves the sentence out', () => {
    expect(buildSummarySentence({ ...base, counts: {} })).toBeNull();
    expect(buildSummarySentence({ ...base, counts: { permits: 0 } })).toBeNull();
    // types outside the title list (disasters, airport, asks) are not counted either
    expect(buildSummarySentence({ ...base, counts: { disasters: 4, airport: 1, asks: 2 } })).toBeNull();
  });
  it('says "area" for county feeds, as titles.ts does', () => {
    const s = buildSummarySentence({ place: 'Atlanta, GA', slug: 'atlanta-ga', period: sevenDayPeriod(NOW), counts: { permits: 12, storm: 1 } });
    expect(s).toBe('In the 7 days to Nov 17, 2026, Atlanta, GA had 12 area building permits and 1 storm report.');
    expect(buildSummarySentence({ place: 'Atlanta, GA', slug: 'atlanta-ga', period: 'In the week', counts: { permits: 1 } })).toBe('In the week, Atlanta, GA had 1 area building permit.');
    // storm reports are national, never "area"; a city with its own feed is not "area" either
    expect(buildSummarySentence({ ...base, counts: { permits: 2 } })).not.toContain('area');
  });
  it('formats large counts and marks lower bounds', () => {
    expect(buildSummarySentence({ ...base, counts: { requests311: 1234 } })).toContain('1,234 311 requests');
    expect(buildSummarySentence({ ...base, counts: { permits: 1000, storm: 3 }, lowerBound: true })).toBe(
      'In the 7 days to Nov 17, 2026, Raleigh, NC had at least 1,000 building permits and at least 3 storm reports.',
    );
  });
  it('never contains an em dash', () => {
    const s = buildSummarySentence({ ...base, counts: { permits: 5, storm: 4, alerts: 3, requests311: 2 } }) ?? '';
    expect(s).not.toContain('—');
    expect(s).not.toContain('–');
  });
});

describe('citySummary counts the past only', () => {
  it('counts the last 7 days and ignores older records and events dated ahead', () => {
    const rows = [...many(3, 'permit', 'permit', 2), ...many(5, 'permit', 'permit', 20), row('report', null, 1), row('event', 'event-permit', -3), row('event', 'event-permit', 1)];
    const d = summarize('raleigh-nc', rows, NOW);
    // the future event is in weekCounts (upcoming list) but must not be in the sentence
    expect(d.weekCounts.events).toBe(2);
    expect(d.pastWeekCounts).toEqual({ permits: 3, storm: 1, events: 1 });
    expect(citySummary(raleigh, d)).toBe('In the 7 days to Nov 17, 2026, Raleigh, NC had 3 building permits, 1 storm report and 1 event.');
  });
  it('counts expired alerts: they were issued in the period', () => {
    const d = summarize('raleigh-nc', [row('alert', null, 2, { expires_at: new Date(Date.parse(NOW) - DAY).toISOString() })], NOW);
    expect(citySummary(raleigh, d)).toBe('In the 7 days to Nov 17, 2026, Raleigh, NC had 1 weather alert.');
  });
  it('omits the sentence with nothing in 7 days, with no data, or when the read failed', () => {
    expect(citySummary(raleigh, summarize('raleigh-nc', many(4, 'permit', 'permit', 30), NOW))).toBeNull();
    expect(citySummary(raleigh, emptyPlaceData('raleigh-nc', NOW, true))).toBeNull();
    expect(citySummary(raleigh, emptyPlaceData('raleigh-nc', NOW, false))).toBeNull();
  });
  it('uses lower bounds when the row cap cut the week short', () => {
    const rows = many(3, 'permit', 'permit', 2);
    const cut = summarize('raleigh-nc', rows, NOW, { truncated: true });
    expect(cut.pastWeekExact).toBe(false);
    expect(citySummary(raleigh, cut)).toContain('at least 3 building permits');
    const ok = summarize('raleigh-nc', [...rows, row('permit', 'permit', 30)], NOW, { truncated: true });
    expect(ok.pastWeekExact).toBe(true);
    expect(citySummary(raleigh, ok)).toContain('had 3 building permits');
  });
});

describe('weekPeriod', () => {
  const t = (s: string) => Date.parse(s);
  it('a finished week reads as a Monday to Sunday range', () => {
    expect(weekPeriod(t('2026-11-09T00:00:00Z'), t(NOW))).toBe('In the week of Nov 9 to Nov 15, 2026');
  });
  it('spans months and years', () => {
    expect(weekPeriod(t('2026-10-26T00:00:00Z'), t(NOW))).toBe('In the week of Oct 26 to Nov 1, 2026');
    expect(weekPeriod(t('2026-12-28T00:00:00Z'), t('2027-02-01T00:00:00Z'))).toBe('In the week of Dec 28, 2026 to Jan 3, 2027');
  });
  it('the current week runs to the day the counts were computed', () => {
    expect(weekPeriod(t('2026-11-16T00:00:00Z'), t(NOW))).toBe('From Nov 16 to Nov 17, 2026');
    expect(weekPeriod(t('2026-11-16T00:00:00Z'), t('2026-11-16T09:00:00Z'))).toBe('On Nov 16, 2026');
  });
  it('builds a full weekly sentence', () => {
    const s = buildSummarySentence({ place: 'Raleigh, NC', slug: 'raleigh-nc', period: weekPeriod(t('2026-11-09T00:00:00Z'), t(NOW)), counts: { permits: 14, alerts: 2 } });
    expect(s).toBe('In the week of Nov 9 to Nov 15, 2026, Raleigh, NC had 14 building permits and 2 weather alerts.');
  });
});
