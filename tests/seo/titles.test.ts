import { describe, expect, it } from 'vitest';
import { emptyPlaceData, summarize, type SignalRowDb } from '../../lib/seo/summarize';
import { buildH1, buildSearchDescription, buildTitle, neutralTitle, titleTypes } from '../../lib/seo/titles';
import { buildFaq, buildIntro } from '../../lib/seo/view';
import { sectionFor } from '../../lib/seo/sections';

const NOW = '2026-11-16T12:00:00.000Z';
const city = { name: 'Chicago', state: 'IL', slug: 'chicago-il' };

let n = 0;
function row(kind: string, subtype: string | null, daysAgo = 2, extra: Partial<SignalRowDb> = {}): SignalRowDb {
  n += 1;
  return {
    id: n, source: 'socrata-test', kind, title: `${kind} ${n}`, summary: null, url: 'https://example.gov/x',
    categories: ['roofing'], severity: 1,
    occurred_at: new Date(Date.parse(NOW) - daysAgo * 86_400_000).toISOString(),
    expires_at: null, subtype, ...extra,
  };
}
const data = (rows: SignalRowDb[]) => summarize('chicago-il', rows, NOW);

describe('title builder: county feeds', () => {
  it('Atlanta has no city permit feed (DeKalb County permits land on it), so the title says "area"', () => {
    const atl = { name: 'Atlanta', state: 'GA', slug: 'atlanta-ga' };
    const d = summarize('atlanta-ga', [row('permit', 'permit'), row('report', null)], NOW);
    expect(buildTitle(atl, d)).toBe('Atlanta, GA area building permits and storm reports this week');
    expect(buildH1(atl, d)).toBe('Area building permits and storm reports in Atlanta, GA');
    // Chicago's permits come from its own city portal, so no "area".
    expect(buildTitle({ ...city }, summarize('chicago-il', [row('permit', 'permit')], NOW))).toBe('Chicago, IL building permits this week | Holler');
  });
});

describe('title builder', () => {
  it('names only record types the city has, in priority order', () => {
    const d = data([row('civic', '311'), row('report', null), row('permit', 'permit'), row('permit', 'permit')]);
    expect(titleTypes(d)).toEqual(['building permits', 'storm reports', '311 requests']);
    expect(buildTitle(city, d)).toBe('Chicago, IL building permits, storm reports and 311 requests this week');
    expect(buildTitle(city, data([row('permit', 'permit')]))).toBe('Chicago, IL building permits this week | Holler');
  });

  it('never promises a type with no data', () => {
    const d = data([row('report', null), row('contract', null)]);
    const t = buildTitle(city, d);
    expect(t).toContain('storm reports and federal contracts');
    expect(t).not.toContain('permits');
    expect(t).not.toContain('311');
    expect(buildH1(city, d)).toBe('Storm reports and federal contracts in Chicago, IL');
  });

  it('names at most three types', () => {
    const d = data([
      row('permit', 'permit'), row('report', null), row('civic', '311'), row('civic', 'inspection'),
      row('civic', 'business'), row('civic', 'violation'), row('contract', null), row('event', 'event-permit'),
    ]);
    expect(titleTypes(d)).toHaveLength(3);
    expect(buildTitle(city, d)).not.toContain('inspections');
  });

  it('covers every type in the documented order when taken alone', () => {
    const cases: [SignalRowDb, string][] = [
      [row('permit', 'permit'), 'building permits'],
      [row('report', null), 'storm reports'],
      [row('alert', null, 1, { expires_at: '2026-11-20T00:00:00.000Z' }), 'weather alerts'],
      [row('civic', '311'), '311 requests'],
      [row('civic', 'inspection'), 'inspections'],
      [row('civic', 'business'), 'new businesses'],
      [row('civic', 'violation'), 'code violations'],
      [row('contract', null), 'federal contracts'],
      [row('event', 'event-permit'), 'events'],
    ];
    for (const [r, phrase] of cases) expect(titleTypes(data([r])), phrase).toEqual([phrase]);
  });

  it('counts an expired alert as a weather alerts record in the 60-day window', () => {
    const d = data([row('alert', null, 10, { expires_at: '2026-11-07T00:00:00.000Z' })]);
    expect(titleTypes(d)).toEqual(['weather alerts']);
  });

  it('says "in the last 60 days" when a named type has nothing this week', () => {
    const d = data([row('permit', 'permit', 20)]);
    expect(buildTitle(city, d)).toBe('Chicago, IL building permits in the last 60 days | Holler');
  });

  it('drops the suffix when the title would be too long', () => {
    const d = data([row('permit', 'permit'), row('report', null), row('alert', null, 1, { expires_at: '2026-11-20T00:00:00.000Z' })]);
    const t = buildTitle({ name: 'Winston-Salem', state: 'NC' }, d);
    expect(t.endsWith('| Holler')).toBe(false);
  });

  it('falls back to a neutral title with no data', () => {
    const d = emptyPlaceData('chicago-il', NOW, true);
    expect(buildTitle(city, d)).toBe("What's happening in Chicago, IL | Holler");
    expect(buildH1(city, d)).toBe(neutralTitle(city));
    expect(buildTitle(city, emptyPlaceData('chicago-il', NOW, false))).toBe("What's happening in Chicago, IL | Holler");
  });

  it('falls back to neutral when records exist but none are a titled type', () => {
    const d = data([row('travel', null), row('ask', null)]);
    expect(d.total).toBe(2);
    expect(buildTitle(city, d)).toBe("What's happening in Chicago, IL | Holler");
  });

  it('keeps the description within 155 characters and states real counts', () => {
    const d = data([row('permit', 'permit'), row('report', null)]);
    const desc = buildSearchDescription(city, d);
    expect(desc.length).toBeLessThanOrEqual(155);
    expect(desc).toContain('2 public records');
    expect(buildSearchDescription(city, emptyPlaceData('chicago-il', NOW, true)).length).toBeLessThanOrEqual(155);
  });
});

describe('new subtypes', () => {
  it('maps civic business and violation, and keeps event-permit in events', () => {
    expect(sectionFor('civic', 'x', 't', 'business')).toBe('business');
    expect(sectionFor('civic', 'x', 't', 'violation')).toBe('violations');
    expect(sectionFor('event', 'x', 't', 'event-permit')).toBe('events');
  });
  it('shows the new sections with their titles', () => {
    const d = data([row('civic', 'business'), row('civic', 'violation')]);
    expect(Object.keys(d.sections).sort()).toEqual(['business', 'violations']);
  });
});

describe('no em dashes in generated strings', () => {
  it('titles, descriptions, intro and faq contain none', () => {
    const variants = [
      data([row('permit', 'permit'), row('report', null), row('civic', 'business'), row('civic', 'violation')]),
      emptyPlaceData('chicago-il', NOW, true),
    ];
    for (const slug of ['chicago-il', 'atlanta-ga', 'austin-tx', 'miami-fl']) {
      for (const d of variants) {
        const c = { name: 'Place', state: 'ZZ', slug };
        const all = [
          buildTitle(c, d), buildH1(c, d), buildSearchDescription(c, d), buildIntro(c, d),
          ...buildFaq(c, d).flatMap((f) => [f.q, f.a]),
        ];
        for (const s of all) expect(s).not.toMatch(/[—–]/);
      }
    }
  });
});
