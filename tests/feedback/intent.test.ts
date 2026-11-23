import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { CARTO_DATASETS } from '@/lib/signals/adapters/carto-datasets';
import { NON_ADAPTER_SOURCES } from '@/lib/signals/source-meta';
import { INTENTS, INTENT_LABEL, INTENT_NOTE, intentLine, intentOf, type Intent } from '@/lib/signals/intent';
import { IntentNote } from '@/components/feed/intent-note';
import { renderDigest } from '@/lib/email/templates';

const SUBTYPE_INTENT: Record<string, Intent> = {
  permit: 'spending',
  business: 'spending',
  'event-permit': 'spending',
  '311': 'demand',
  violation: 'demand',
  inspection: 'demand',
};

// Every adapter that is not a dataset-driven one, with the intent a reader should see.
const FIXED: Record<string, Intent> = {
  nws: 'demand',
  spc: 'demand',
  fema: 'demand',
  usgs: 'demand',
  faa: 'demand',
  usaspending: 'spending',
  'sam-gov': 'spending',
  'bids-sf': 'spending',
  'bids-la': 'spending',
  'bids-batonrouge': 'spending',
  'bids-gwinnett': 'spending',
  'bids-rockdale': 'spending',
  'bids-tucker': 'spending',
  'bids-dunwoody': 'spending',
  ticketmaster: 'demand',
  bluesky: 'asking',
  'websearch-brave': 'asking',
  'websearch-serper': 'asking',
  'holler-request': 'asking',
  'arcgis-johnscreek-permits': 'spending',  // COVERAGE round 7: a dedicated adapter (kind permit), not in the dataset tables
  'html-houston-permits': 'spending', // Round 20 NEXT: the Houston permit report page reader (kind permit), not in the dataset tables
};

const datasets = new Map<string, { subtype: string; kind: string }>([
  ...SOCRATA_DATASETS.map((d) => [d.id, d] as const),
  ...ARCGIS_DATASETS.map((d) => [d.id, d] as const),
  ...CARTO_DATASETS.map((d) => [d.id, d] as const),
]);

describe('intentOf: every registered source', () => {
  it('has an expected intent for every adapter id and every non-adapter source', () => {
    const ids = [...ALL_ADAPTERS.map((a) => a.id), ...NON_ADAPTER_SOURCES];
    expect(ids.length).toBeGreaterThan(40);
    for (const id of ids) expect(id in FIXED || datasets.has(id), `no expectation for source ${id}`).toBe(true);
  });

  it('maps each adapter (kind and data.subtype as the adapter writes them) to the expected intent', () => {
    for (const a of ALL_ADAPTERS) {
      const ds = datasets.get(a.id);
      const subtype = ds?.subtype ?? null;
      const expected = ds ? SUBTYPE_INTENT[ds.subtype] : FIXED[a.id];
      expect(expected, `expectation for ${a.id}`).toBeDefined();
      expect(intentOf({ kind: a.kind, subtype, source: a.id }), `${a.id} (${a.kind}/${subtype})`).toBe(expected);
    }
    for (const id of NON_ADAPTER_SOURCES) expect(intentOf({ kind: 'ask', source: id })).toBe(FIXED[id]);
  });

  it('covers every subtype the Socrata and ArcGIS datasets use', () => {
    for (const d of datasets.values()) expect(SUBTYPE_INTENT[d.subtype], `subtype ${d.subtype}`).toBeDefined();
  });

  it('maps the plain-language groups from the spec', () => {
    const demand = [
      ['alert', 'nws'], ['report', 'spc'], ['disaster', 'fema'], ['quake', 'usgs'],
      ['civic', 'socrata-nyc-311', '311'], ['civic', 'socrata-chicago-violations', 'violation'], ['civic', 'socrata-chicago-inspections', 'inspection'],
    ] as const;
    for (const [kind, source, subtype] of demand) expect(intentOf({ kind, source, subtype }), source).toBe('demand');
    const spending = [
      ['permit', 'socrata-chicago-permits', 'permit'], ['civic', 'socrata-sf-business', 'business'],
      ['contract', 'usaspending', null], ['event', 'socrata-nyc-events', 'event-permit'],
    ] as const;
    for (const [kind, source, subtype] of spending) expect(intentOf({ kind, source, subtype }), source).toBe('spending');
    expect(intentOf({ kind: 'ask', source: 'holler-request' })).toBe('asking');
  });

  it('falls back to demand for unknown kinds, subtypes and sources', () => {
    expect(intentOf({ kind: 'mystery', source: 'nowhere' })).toBe('demand');
    expect(intentOf({ kind: 'civic', subtype: 'new-thing', source: 'x' })).toBe('demand');
    expect(intentOf({ kind: '', source: '' })).toBe('demand');
    expect(intentOf({ kind: 'civic', subtype: null, source: 'socrata-nyc-311' })).toBe('demand');
    // @ts-expect-error runtime guard for bad data
    expect(intentOf({ kind: undefined, source: undefined })).toBe('demand');
  });
});

describe('intent copy', () => {
  it('uses the exact labels and lines', () => {
    expect(INTENT_LABEL).toEqual({ demand: 'Might need work', spending: 'Money being spent', asking: 'Someone asked' });
    expect(INTENT_NOTE.demand).toBe('The event is on record. Whether anyone needs work is not confirmed.');
    expect(INTENT_NOTE.spending).toBe('Money is being spent here. The main contractor may already be chosen.');
    expect(INTENT_NOTE.asking).toBe('A resident asked for this service.');
  });

  it('gives open federal bids, licences and public posts their own line, and keeps the label', () => {
    const bid = { kind: 'contract', source: 'sam-gov', subtype: null };
    expect(intentOf(bid)).toBe('spending');
    expect(INTENT_LABEL[intentOf(bid)]).toBe('Money being spent');
    expect(intentLine(bid)).toBe('This work is out for bid. No contract has been awarded yet.');
    expect(intentLine({ kind: 'contract', source: 'usaspending' })).toBe(INTENT_NOTE.spending);
    expect(intentLine({ kind: 'civic', source: 'socrata-sf-business', subtype: 'business' })).toBe('A new business registered here. It may need services as it opens.');
    expect(intentLine({ kind: 'permit', source: 'socrata-chicago-permits', subtype: 'permit' })).toBe(INTENT_NOTE.spending);
    for (const source of ['bluesky', 'websearch-brave', 'websearch-serper']) {
      for (const kind of ['ask', 'civic']) {
        const sig = { kind, source, subtype: null };
        expect(intentOf(sig)).toBe('asking');
        expect(INTENT_LABEL[intentOf(sig)]).toBe('Someone asked');
        expect(intentLine(sig), source).toBe('A public post asked about this. Holler has not checked who wrote it.');
      }
    }
    expect(intentLine({ kind: 'ask', source: 'holler-request' })).toBe('A resident asked for this service.');
    expect(intentLine({ kind: 'alert', source: 'nws' })).toBe(INTENT_NOTE.demand);
    expect(intentLine({ kind: 'x', source: 'y' })).toBe(INTENT_NOTE.demand);
  });

  it('follows the copy rules: no em or en dashes, none of the banned words', () => {
    const lines = [
      intentLine({ kind: 'contract', source: 'sam-gov' }),
      intentLine({ kind: 'civic', source: 's', subtype: 'business' }),
      intentLine({ kind: 'ask', source: 'bluesky' }),
    ];
    const all = [...INTENTS.flatMap((i) => [INTENT_LABEL[i], INTENT_NOTE[i]]), ...lines].join(' ');
    expect(all).not.toMatch(/[–—]/);
    expect(all).not.toMatch(/delve|robust|seamless|elevate|unlock|empower|journey|landscape|leverage|not only|more than just|worth noting/i);
  });

  it('renders in the feed card component', () => {
    const html = renderToStaticMarkup(createElement(IntentNote, { item: { kind: 'permit', source: 'socrata-nyc-permits', subtype: 'permit' } }));
    expect(html).toContain('Money being spent');
    expect(html).toContain('Money is being spent here. The main contractor may already be chosen.');
    const bid = renderToStaticMarkup(createElement(IntentNote, { item: { kind: 'contract', source: 'sam-gov' } }));
    expect(bid).toContain('Money being spent');
    expect(bid).toContain('This work is out for bid. No contract has been awarded yet.');
    expect(bid).not.toContain('contractor may already be chosen');
  });

  it('the alert email no longer prints the intent block (changed deliberately, brief card v1 redo); the brief carries what it said', () => {
    const mail = renderDigest({
      businessName: 'Acme',
      appUrl: 'https://holler.test/app',
      unsubscribeUrl: 'https://holler.test/u',
      now: new Date('2026-11-17T12:00:00Z'),
      items: [
        { kind: 'alert', source: 'nws', title: 'Hail', occurredAt: '2026-11-17T11:00:00Z' },
        { kind: 'civic', source: 'socrata-sf-business', subtype: 'business', title: 'New cafe', occurredAt: '2026-11-17T11:00:00Z' },
        { kind: 'ask', source: 'holler-request', title: 'Need a plumber', occurredAt: '2026-11-17T11:00:00Z', label: 'act_now', trade: 'plumbing' },
        { kind: 'contract', source: 'sam-gov', title: 'Federal bid in Macon', occurredAt: '2026-11-17T11:00:00Z', label: 'act_now', trade: 'roofing' },
        { kind: 'ask', source: 'bluesky', title: 'Anyone recommend a roofer', occurredAt: '2026-11-17T11:00:00Z', label: 'act_now', trade: 'roofing' },
      ],
    });
    for (const out of [mail.html, mail.text]) {
      for (const gone of ['Might need work', 'Money being spent', 'Someone asked', 'A resident asked for this service.', 'A new business registered here. It may need services as it opens.', 'This work is out for bid. No contract has been awarded yet.', 'A public post asked about this. Holler has not checked who wrote it.']) {
        expect(out).not.toContain(gone);
      }
      // what the intent lines said is in the brief: the open-bid, the public-post and the resident-request cases
      expect(out).toContain('nothing is awarded');
      expect(out).toContain('Low confidence');
      expect(out).toContain('A resident asked on Holler');
    }
    expect(mail.html).not.toMatch(/[–—]/);
  });
});
