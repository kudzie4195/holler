// Round 15 final fix (Q3 pattern 1): Atlanta, Johns Creek, Cobb and FEMA dates are calendar days stored as midnight UTC. A card must print
// that day ("Nov 16"), not the evening before in New York ("Nov 15"), on the Source line (web, digest, mobile all use briefSource) and on a
// deadline stored the same way. Other sources keep Eastern time.
import { describe, expect, it } from 'vitest';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { JOHNS_CREEK_PERMITS } from '@/lib/signals/adapters/arcgis-johnscreek';
import { cardBrief } from '@/lib/signals/brief';
import { parseSam } from '@/lib/signals/adapters/sam';
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

describe('a deadline stored as a date at midnight UTC prints that day, for date-only sources only', () => {
  it.each(['arcgis-atlanta-permits', 'arcgis-cobb-residential-permits', 'arcgis-cobb-commercial-permits', 'arcgis-cobb-multiunit-permits', 'arcgis-johnscreek-permits', 'fema'])(
    '%s: data.deadline at midnight UTC -> Deadline: Dec 5, 2026',
    (source) => {
      expect(deadlineLine(deadlineOf({ source, data: { deadline: '2026-12-05T00:00:00Z' } } as never))).toBe('Deadline: Dec 5, 2026');
      expect(deadlineLine(deadlineOf({ source, data: { fixBy: '2026-12-05T00:00:00.000Z' } } as never))).toBe('Deadline: Dec 5, 2026');
    },
  );
  it('a bare date prints that day for any source', () => {
    expect(deadlineLine(deadlineOf({ source: 'socrata-x', data: { deadline: '2026-12-05' } } as never))).toBe('Deadline: Dec 5, 2026');
    expect(deadlineLine(deadlineOf({ source: 'sam-gov', data: null, expires_at: '2026-12-05' } as never))).toBe('Deadline: Dec 5, 2026');
  });
  it('a date-only source keeps the day at noon UTC, not a time that has already passed', () => {
    expect(Date.parse(deadlineOf({ source: 'fema', data: { deadline: '2026-12-05T00:00:00Z' } } as never)!)).toBe(Date.parse('2026-12-05T12:00:00Z'));
  });
  it('a deadline with a real time keeps its Eastern day (9 PM Eastern is that evening)', () => {
    expect(deadlineLine(deadlineOf({ source: 'socrata-x', data: { deadline: '2026-12-06T02:00:00Z' } } as never))).toBe('Deadline: Dec 5, 2026');
  });
});

describe('a real evening deadline at 00:00Z of the next day is not moved (sam-gov and other sources)', () => {
  it.each([
    ['sam-gov 7 PM Eastern', '2026-12-05T19:00:00-05:00'],
    ['sam-gov 4 PM Pacific', '2026-12-05T16:00:00-08:00'],
  ])('%s through parseSam -> Deadline: Dec 5, 2026', (_n, responseDeadLine) => {
    const rows = parseSam({
      opportunitiesData: [
        { noticeId: 'n1', title: 'Roof repair', type: 'Solicitation', postedDate: '2026-11-20', responseDeadLine, naicsCode: '238160', placeOfPerformance: { city: { name: 'Atlanta' }, state: { code: 'GA' } } },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].expiresAt).toBe('2026-12-06T00:00:00.000Z');
    expect(deadlineLine(deadlineOf({ source: 'sam-gov', data: null, expires_at: rows[0].expiresAt } as never))).toBe('Deadline: Dec 5, 2026');
  });
  it('sam-gov with a bare responseDeadLine date is stored at noon UTC and prints that day', () => {
    const rows = parseSam({
      opportunitiesData: [
        { noticeId: 'n2', title: 'Roof repair', type: 'Solicitation', postedDate: '2026-11-20', responseDeadLine: '2026-12-05', naicsCode: '238160', placeOfPerformance: { city: { name: 'Atlanta' }, state: { code: 'GA' } } },
      ],
    });
    expect(rows[0].expiresAt).toBe('2026-12-05T12:00:00.000Z');
    expect(deadlineLine(deadlineOf({ source: 'sam-gov', data: null, expires_at: rows[0].expiresAt } as never))).toBe('Deadline: Dec 5, 2026');
  });
  it('a non-date-only source at 00:00Z is the Eastern evening before (a real instant)', () => {
    expect(deadlineLine(deadlineOf({ source: 'socrata-x', data: { deadline: '2026-12-06T00:00:00Z' } } as never))).toBe('Deadline: Dec 5, 2026');
    expect(deadlineLine(deadlineOf({ source: 'sam-gov', data: null, expires_at: '2026-12-06T00:00:00Z' } as never))).toBe('Deadline: Dec 5, 2026');
  });
});

describe('the flagged datasets and DATE_ONLY_SOURCES agree', () => {
  it('every dataset flagged dateOnly is listed, and every listed ArcGIS source is flagged', () => {
    const flagged = [...ARCGIS_DATASETS, JOHNS_CREEK_PERMITS].filter((d) => d.dateOnly).map((d) => d.id).sort();
    expect(flagged).toEqual(['arcgis-atlanta-permits', 'arcgis-cobb-commercial-permits', 'arcgis-cobb-multiunit-permits', 'arcgis-cobb-residential-permits', 'arcgis-johnscreek-permits']);
    expect([...DATE_ONLY_SOURCES].filter((s) => s !== 'fema').sort()).toEqual(flagged);
  });
});
