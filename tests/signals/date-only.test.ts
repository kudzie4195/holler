// Round 15 final fix (Q3 pattern 1): Atlanta, Johns Creek, Cobb and FEMA dates are calendar days stored as midnight UTC. A card must print
// that day ("Nov 16"), not the evening before in New York ("Nov 15"), on the Source line (web, digest, mobile all use briefSource) and on a
// deadline stored the same way. Other sources keep Eastern time.
import { describe, expect, it } from 'vitest';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { JOHNS_CREEK_PERMITS } from '@/lib/signals/adapters/arcgis-johnscreek';
import { cardBrief } from '@/lib/signals/brief';
import { DATE_ONLY_SOURCES, deadlineLine, deadlineOf, formatDeadlineDate, formatRecordDate } from '@/lib/signals/lead-rules';
import { renderDigest } from '@/lib/email/templates';

const permit = (source: string, occurredAt: string) => ({ source, kind: 'permit', subtype: 'permit', title: 'New construction permit in Atlanta', occurredAt, label: 'coming_soon' as const, trade: 'landscaping' });

describe('record date on the Source line', () => {
  it.each([
    ['arcgis-atlanta-permits', '2026-11-16T00:00:00.000Z', 'Nov 16, 2026'],
    ['arcgis-johnscreek-permits', '2026-11-17T00:00:00.000Z', 'Nov 17, 2026'],
    ['arcgis-cobb-residential-permits', '2026-11-13T00:00:00Z', 'Nov 13, 2026'],
    ['arcgis-cobb-commercial-permits', '2026-11-13T00:00:00.000Z', 'Nov 13, 2026'],
    ['arcgis-cobb-multiunit-permits', '2026-11-13T00:00:00.000+00:00', 'Nov 13, 2026'],
    ['fema', '2026-10-27T00:00:00.000Z', 'Oct 27, 2026'],
  ])('%s at %s prints %s', (source, at, want) => {
    expect(cardBrief(permit(source, at)).source.dateText).toBe(want);
    expect(formatRecordDate(at, source)).toBe(want);
  });

  it('the old behaviour was a day early (what the grader saw)', () => {
    expect(formatDeadlineDate('2026-11-16T00:00:00.000Z')).toBe('Nov 15, 2026');
  });

  it('every other source keeps Eastern time, even at midnight UTC (a weather alert, a Chicago permit)', () => {
    expect(cardBrief(permit('nws', '2026-11-16T00:00:00Z')).source.dateText).toBe('Nov 15, 2026');
    expect(cardBrief(permit('socrata-chicago-permits', '2026-11-16T00:00:00Z')).source.dateText).toBe('Nov 15, 2026');
  });

  it('a date-only source with a real time of day keeps Eastern time', () => {
    expect(cardBrief(permit('arcgis-atlanta-permits', '2026-11-16T15:30:00Z')).source.dateText).toBe('Nov 16, 2026');
    expect(cardBrief(permit('arcgis-atlanta-permits', '2026-11-16T03:30:00Z')).source.dateText).toBe('Nov 15, 2026');
  });

  it('the digest prints the same day', () => {
    const { html, text } = renderDigest({
      businessName: 'X', appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: new Date('2026-11-18T12:00:00Z'),
      items: [{ kind: 'permit', source: 'arcgis-atlanta-permits', subtype: 'permit', title: 'New construction permit in Atlanta', summary: null, place: 'Atlanta, GA', occurredAt: '2026-11-16T00:00:00.000Z', sourceUrl: null, label: 'coming_soon', trade: 'landscaping' }],
    });
    expect(html).toContain('Nov 16, 2026');
    expect(html).not.toContain('Nov 15, 2026');
    expect(text).toContain('Nov 16, 2026');
  });
});

describe('a deadline stored as a date at midnight UTC prints that day', () => {
  it.each([
    ['data.deadline as a bare date', { source: 'socrata-x', data: { deadline: '2026-12-05' } }],
    ['data.deadline at midnight UTC', { source: 'socrata-x', data: { deadline: '2026-12-05T00:00:00Z' } }],
    ['data.fixBy at midnight UTC with milliseconds', { source: 'socrata-x', data: { fixBy: '2026-12-05T00:00:00.000Z' } }],
    ['sam-gov expires_at at midnight UTC', { source: 'sam-gov', data: null, expires_at: '2026-12-05T00:00:00Z' }],
  ])('%s -> Deadline: Dec 5, 2026', (_n, sig) => {
    expect(deadlineLine(deadlineOf(sig as never))).toBe('Deadline: Dec 5, 2026');
  });
  it('a deadline with a real time keeps its Eastern day (9 PM Eastern is that evening)', () => {
    expect(deadlineLine(deadlineOf({ source: 'socrata-x', data: { deadline: '2026-12-06T02:00:00Z' } } as never))).toBe('Deadline: Dec 5, 2026');
  });
  it('the fix does not turn the deadline into a time that has already passed in the Eastern evening', () => {
    expect(Date.parse(deadlineOf({ source: 'socrata-x', data: { deadline: '2026-12-05T00:00:00Z' } } as never)!)).toBe(Date.parse('2026-12-05T12:00:00Z'));
  });
});

describe('the flagged datasets and DATE_ONLY_SOURCES agree', () => {
  it('every dataset flagged dateOnly is listed, and every listed ArcGIS source is flagged', () => {
    const flagged = [...ARCGIS_DATASETS, JOHNS_CREEK_PERMITS].filter((d) => d.dateOnly).map((d) => d.id).sort();
    expect(flagged).toEqual(['arcgis-atlanta-permits', 'arcgis-cobb-commercial-permits', 'arcgis-cobb-multiunit-permits', 'arcgis-cobb-residential-permits', 'arcgis-johnscreek-permits']);
    expect([...DATE_ONLY_SOURCES].filter((s) => s !== 'fema').sort()).toEqual(flagged);
  });
});
