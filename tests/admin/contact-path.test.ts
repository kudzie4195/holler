/**
 * Round 18 ROUTES, item 3: the quality dashboard line "share of alerted cards in the last 7 days that had a contact path, per trade".
 * Read only; a failed read is blank (unavailable), never zero.
 */
import { describe, expect, it } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { buildContactPathReport, loadContactPathReport } from '@/lib/admin/contact-path';
import { renderQualityHtml } from '@/lib/admin/quality-html';
import { buildQualityReport } from '@/lib/admin/quality';
import type { Db } from '@/lib/signals/store';

const NOW = new Date('2026-11-22T12:00:00Z');
const D = 86_400_000;
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * D).toISOString();
const alert = (signal_id: number, trade: string | null, daysAgo: number) => ({ user_id: 'u1', signal_id, source: null, kind: null, subtype: null, trade, created_at: at(daysAgo), emailed_at: null });
const SIGNALS = [
  { id: 1, source: 'arcgis-dekalb-permits', kind: 'permit', title: 'New home permit in DeKalb County', summary: 'New Construction | Single Family Dwelling | Issued', subtype: 'permit' },
  { id: 2, source: 'socrata-orlando-permits', kind: 'permit', title: 'New home permit in Orlando', summary: 'Building Permit | New | 55 W Colonial Dr', subtype: 'permit' },
  { id: 3, source: 'bids-sf', kind: 'contract', title: 'Landscape maintenance', summary: null, subtype: 'bid' },
  { id: 4, source: 'arcgis-dekalb-permits', kind: 'permit', title: 'Landscaping permit in DeKalb County', summary: 'Landscaping | Issued', subtype: 'permit' },
];
const CONTACTS = [{ signal_id: 3, role: 'buyer', name: 'City of San Francisco', address: null }];

describe('buildContactPathReport', () => {
  it('counts only alerted cards of the last 7 days, per trade, and the share that named a business or a site address', () => {
    const r = buildContactPathReport({
      now: NOW,
      alerts: [alert(1, 'moving', 1), alert(2, 'moving', 2), alert(3, 'landscaping', 3), alert(1, 'moving', 9) /* outside the window */, alert(4, 'landscaping', 1) /* own trade: market insight, not an alert */],
      signals: SIGNALS,
      contacts: CONTACTS,
    });
    expect(r.status).toBe('ok');
    expect(r.windowDays).toBe(7);
    expect(r.all).toEqual({ trade: 'all trades', alerted: 3, withPath: 2, share: 2 / 3 });
    expect(r.trades).toEqual([
      { trade: 'moving', alerted: 2, withPath: 1, share: 0.5 },
      { trade: 'landscaping', alerted: 1, withPath: 1, share: 1 },
    ]);
  });
  it('nothing alerted is a blank share, not zero', () => {
    const r = buildContactPathReport({ now: NOW, alerts: [], signals: [], contacts: [] });
    expect(r.all.share).toBeNull();
  });
});

describe('loadContactPathReport', () => {
  const seeded = () =>
    new FakeDb({
      holler_alert_log: [alert(1, 'moving', 1), alert(2, 'moving', 2), alert(3, 'landscaping', 3)].map((a, i) => ({ id: i + 1, ...a })),
      holler_signals: SIGNALS,
      holler_signal_contacts: CONTACTS,
    });
  it('reads only (selects on holler_ tables) and builds the same line', async () => {
    const db = seeded();
    const r = await loadContactPathReport(db as unknown as Db, NOW);
    expect(r.all).toMatchObject({ alerted: 3, withPath: 2 });
    expect(db.calls.every((c) => c.endsWith('.select') && c.startsWith('holler_'))).toBe(true);
  });
  it('a failed read (a missing contacts table) is unavailable, never zero, and carries no error text', async () => {
    const db = seeded();
    db.failOn['holler_signal_contacts.select'] = 'relation "holler_signal_contacts" does not exist: secret';
    const r = await loadContactPathReport(db as unknown as Db, NOW);
    expect(r.status).toBe('unavailable');
    expect(JSON.stringify(r)).not.toMatch(/secret|relation/);
  });
  it('the HTML page shows the line, and says "Unavailable" when it could not be read', async () => {
    const base = buildQualityReport({ now: NOW, alerts: [], signals: [], feedback: [], profiles: [], matches: [] });
    const ok = renderQualityHtml(base, undefined, await loadContactPathReport(seeded() as unknown as Db, NOW));
    expect(ok).toContain('Alerts with a contact path (last 7 days)');
    expect(ok).toContain('<th scope="row">moving</th><td>2</td><td>1</td><td>50%</td>');
    const bad = seeded();
    bad.failOn['holler_alert_log.select'] = 'boom';
    expect(renderQualityHtml(base, undefined, await loadContactPathReport(bad as unknown as Db, NOW))).toContain('Unavailable (blank, not zero).');
    // Without the line the page is exactly as before.
    expect(renderQualityHtml(base)).not.toContain('contact path');
  });
});
