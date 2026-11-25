import { describe, expect, it } from 'vitest';
import { buildManualBid } from '@/lib/signals/manual-bids/record';
import { matchSignals, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { bidHidden, isBidSignal } from '@/lib/signals/bid-sources';
import { hasApproxLocation, approxLocationNote } from '@/lib/signals/approx-location';
import { deadlineOf, labelFor } from '@/lib/signals/lead-rules';
import { intentOf } from '@/lib/signals/intent';
import { sourceLabelLang } from '@/lib/signals/source-label-i18n';
import { briefSource } from '@/lib/signals/brief';
import { sourceInfo } from '@/lib/seo/sources';
import { localizeTitle } from '@/lib/signals/title-i18n';
import type { CategoryId } from '@/lib/signals/categories';
import type { SignalInput } from '@/lib/signals/types';

const NOW = new Date('2026-11-25T15:00:00Z');

function built(title: string, trade?: string): SignalInput {
  const r = buildManualBid(
    { url: `https://mariettaga.gov/Bids.aspx?bidID=${title.length}`, title, agency: 'City of Marietta', dueDate: '2026-12-15', place: '30060', ...(trade ? { trade } : {}) },
    { now: NOW, served: () => true },
  );
  if (!r.ok) throw new Error(`not built: ${r.problem}`);
  return r.signal;
}

function asMatch(s: SignalInput, id: number): MatchSignal {
  return { id, categories: s.categories, lat: s.lat ?? null, lon: s.lon ?? null, state: s.state ?? null, severity: s.severity, occurred_at: s.occurredAt, source: s.source, title: s.title, summary: s.summary ?? null, data: s.data as MatchSignal['data'] };
}

// Smyrna, GA (about 5 miles from the Marietta ZIP centroid), 10 mile radius.
const member = (user_id: string, categories: CategoryId[]): MatchProfile => ({ user_id, categories, lat: 33.884, lon: -84.514, state: 'GA', radius_mi: 10 });

describe('hand-added bids route to the trades the bid routing picks, like any bid', () => {
  it.each([
    ['Roof replacement at Fire Station 3', ['roofing']],
    ['HVAC chiller replacement, Public Works building', ['hvac']],
    ['Janitorial services for City Hall', ['janitorial-commercial', 'cleaning']],
    ['Annual mowing and grounds maintenance', ['landscaping', 'lawn-care']],
    ['Sidewalk and curb repair, Church Street', ['concrete-paving']],
    ['Tree removal along Kennesaw Avenue', ['tree-service']],
  ])('%s -> %j', (title, trades) => {
    expect(built(title).categories).toEqual(trades);
  });

  it('a supply purchase or paper work gets no trade (same rule as every bid feed), unless the owner picks one', () => {
    expect(buildManualBid({ url: 'https://x.gov/1', title: 'Purchase of HVAC filters', agency: 'City of Marietta', dueDate: '2026-12-15', place: '30060' }, { now: NOW, served: () => true })).toEqual({ ok: false, problem: 'no_trade' });
    expect(buildManualBid({ url: 'https://x.gov/2', title: 'Roofing consultant services', agency: 'City of Marietta', dueDate: '2026-12-15', place: '30060' }, { now: NOW, served: () => true })).toEqual({ ok: false, problem: 'no_trade' });
    expect(built('Purchase of HVAC filters', 'hvac').categories).toEqual(['hvac']);
  });

  it('reaches the matching member and nobody else, only while HOLLER_BIDS_ENABLED is on', () => {
    const roof = asMatch(built('Roof replacement at Fire Station 3'), 1);
    const janitor = asMatch(built('Janitorial services for City Hall'), 2);
    const roofer = member('roofer', ['roofing']);
    const plumber = member('plumber', ['plumbing']);
    const cleaner = member('cleaner', ['janitorial-commercial']);
    const far = { ...member('far-roofer', ['roofing']), lat: 29.76, lon: -95.37, state: 'TX' };
    const rows = matchSignals([roof, janitor], [roofer, plumber, cleaner, far], undefined, NOW, true);
    expect(rows.map((r) => `${r.user_id}:${r.signal_id}`).sort()).toEqual(['cleaner:2', 'roofer:1']);
    expect(matchSignals([roof, janitor], [roofer, cleaner], undefined, NOW, false)).toEqual([]);
  });

  it('reads as a bid everywhere: act now, due date as the deadline, spending intent, buyer note, no distance, closed after the due day', () => {
    const s = built('Roof replacement at Fire Station 3');
    expect(isBidSignal(s)).toBe(true);
    expect(hasApproxLocation({ source: s.source })).toBe(true);
    expect(labelFor({ source: s.source, kind: s.kind, title: s.title, subtype: 'bid' }, 'roofing')).toBe('act_now');
    expect(deadlineOf({ source: s.source, expiresAt: s.expiresAt, data: s.data })).toBe('2026-12-15T12:00:00.000Z');
    expect(intentOf({ kind: s.kind, subtype: 'bid', source: s.source })).toBe('spending');
    expect(approxLocationNote({ city: s.city, source: s.source })).toBe('Buyer in Marietta. A bid names the buyer, not a job site, so no distance is shown.');
    const row = { source: s.source, data: s.data as { subtype?: unknown; dueDate?: unknown }, expires_at: s.expiresAt };
    expect(bidHidden(row, true, NOW.getTime())).toBe(false);
    expect(bidHidden(row, true, Date.parse('2026-12-16T05:00:00Z'))).toBe(true);
    expect(bidHidden(row, false, NOW.getTime())).toBe(true);
  });

  it('members see the source in English and Spanish, and the link goes to the agency page as the public source', () => {
    expect(sourceLabelLang('bids-manual', 'en')).toBe('Government bid pages checked by Holler');
    expect(sourceLabelLang('bids-manual', 'es')).toBe('Páginas de licitaciones del gobierno revisadas por Holler');
    expect(sourceInfo('bids-manual').label).toBe('Government bid pages checked by Holler');
    const b = briefSource({ source: 'bids-manual', url: 'https://mariettaga.gov/Bids.aspx?bidID=412', occurredAt: NOW.toISOString() });
    expect(b).toMatchObject({ label: 'Government bid pages checked by Holler', href: 'https://mariettaga.gov/Bids.aspx?bidID=412', linkText: 'Open the public source', recordLink: true });
    expect(localizeTitle('Open bid in Marietta: Roof replacement at Fire Station 3', 'es', 'bids-manual')).toMatch(/^Licitación abierta en Marietta: Roof replacement/);
  });
});
