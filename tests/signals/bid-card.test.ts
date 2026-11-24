import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BID_LABEL, BID_PORTAL_LINK_LABEL, BID_SOURCE_LINK_LABEL, bidSourceLinkLabel, bidCardLine, bidDueText, daysLeftText, formatDueDate } from '@/lib/signals/bid-card';
import { INTENT_LABEL, intentLabel, intentLine, intentLineKey, intentOf } from '@/lib/signals/intent';
import { BID_DATASETS, parseBids } from '@/lib/signals/adapters/city-bids';

const NOW = new Date('2026-11-21T22:00:00Z');

describe('open bid card wording', () => {
  it('says Open bid, the buyer, the due date with the days left, and Open the public source', () => {
    expect(BID_LABEL).toBe('Open bid');
    expect(BID_SOURCE_LINK_LABEL).toBe('Open the public source');
    expect(bidCardLine({ buyer: 'Water & Power', dueDate: '2026-12-10', expiresAt: '2026-12-10T22:00:00.000Z' }, NOW)).toBe('Buyer: Water & Power. Due Dec 10, 2026, 19 days left.');
  });

  it('counts days left, rounding up, and says so inside the last day or after', () => {
    expect(daysLeftText('2026-11-23T14:00:00.000Z', NOW)).toBe('2 days left');
    expect(daysLeftText('2026-11-22T22:00:00.000Z', NOW)).toBe('1 day left');
    expect(daysLeftText('2026-11-22T23:00:00.000Z', NOW)).toBe('2 days left');
    expect(daysLeftText('2026-11-22T21:00:00.000Z', NOW)).toBe('closes within 24 hours');
    expect(daysLeftText('2026-11-21T21:00:00.000Z', NOW)).toBe('closed');
    expect(daysLeftText(null, NOW)).toBeNull();
    expect(daysLeftText('garbage', NOW)).toBeNull();
  });

  it('says No due date published when the record has none', () => {
    expect(bidDueText({}, NOW)).toBe('No due date published');
    expect(bidCardLine({ buyer: 'Purchasing', dueDate: null, expiresAt: null }, NOW)).toBe('Buyer: Purchasing. No due date published.');
    expect(bidCardLine({}, NOW)).toBe('No due date published.');
  });

  it('formats the due day without a time zone shift', () => {
    expect(formatDueDate('2026-12-07')).toBe('Dec 7, 2026');
    expect(formatDueDate('12/07/2026')).toBeNull();
    expect(formatDueDate(null)).toBeNull();
  });

  it('city bids get the Open bid label and the federal-bid line; federal bids keep theirs', () => {
    const city = { kind: 'contract', subtype: 'bid', source: 'bids-sf' };
    expect(intentLabel(city)).toBe('Open bid');
    expect(intentLineKey(city)).toBe('open-bid');
    expect(intentLine(city)).toBe('This work is out for bid. No contract has been awarded yet.');
    expect(intentOf(city)).toBe('spending');
    const fed = { kind: 'contract', subtype: null, source: 'sam-gov' };
    expect(intentLabel(fed)).toBe(INTENT_LABEL.spending);
    expect(intentLineKey(fed)).toBe('open-bid');
    expect(intentLabel({ kind: 'permit', subtype: 'permit', source: 'x' })).toBe(INTENT_LABEL.spending);
    expect(intentLabel({ kind: 'civic', subtype: '311', source: 'x' })).toBe(INTENT_LABEL.demand);
  });

  it('no string a member sees on a bid card, built from the live rows, says lead, win, eligible, guaranteed or official record', () => {
    const forbidden = /\blead\b|\bwin\b|\bwon\b|eligible|eligibility|qualif|guarantee|official record|they need you|you will|you can|set[- ]aside/i;
    for (const [id, f] of [['bids-sf', 'sf'], ['bids-la', 'la'], ['bids-batonrouge', 'batonrouge']] as const) {
      const rows = JSON.parse(readFileSync(join(__dirname, 'adapters', 'fixtures', `bids-${f}-live-2026-11-21.json`), 'utf8'));
      for (const s of parseBids(rows, BID_DATASETS.find((d) => d.id === id)!, NOW).items) {
        const d = s.data as { buyer: string; dueDate: string | null };
        const text = [s.title, s.summary, intentLine({ kind: s.kind, subtype: 'bid', source: s.source }), intentLabel({ kind: s.kind, subtype: 'bid', source: s.source }), bidCardLine({ buyer: d.buyer, dueDate: d.dueDate, expiresAt: s.expiresAt }, NOW)].join(' ');
        expect(text, `${id} ${s.externalId}`).not.toMatch(forbidden);
      }
    }
  });
});

describe('source link text (review P2-8)', () => {
  it('Baton Rouge rows link to the shared bid portal and say so; every other source says Open the source', () => {
    expect(bidSourceLinkLabel('bids-batonrouge')).toBe(BID_PORTAL_LINK_LABEL);
    expect(BID_PORTAL_LINK_LABEL).toBe('Open the bid portal');
    for (const s of ['bids-sf', 'bids-la', 'bids-nyc', 'spc', null, undefined]) expect(bidSourceLinkLabel(s)).toBe(BID_SOURCE_LINK_LABEL);
  });
});
