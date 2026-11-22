// Round 18 ROUTES review probe (logs/REV-ROUTES-probe-tests), kept as a permanent regression test (redo 1). With REV_OUT set it also
// writes its table to that path; without it it writes nothing.
/* eslint-disable @typescript-eslint/no-explicit-any */
/** REV-ROUTES probe 11: the quality dashboard line "Alerts with a contact path (last 7 days)". */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FakeDb } from '../../ops/fakedb';
import { buildContactPathReport, loadContactPathReport } from '@/lib/admin/contact-path';
import { renderQualityHtml } from '@/lib/admin/quality-html';
import { buildQualityReport } from '@/lib/admin/quality';
import { labelFor } from '@/lib/signals/lead-rules';
import { carriedTrades } from '@/lib/signals/permit-routing';
import { CATEGORIES } from '@/lib/signals/categories';

const NOW = new Date('2026-11-22T12:00:00Z');
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const sig = (id: number, over: any = {}) => ({ id, source: 'arcgis-atlanta-permits', kind: 'permit', title: 'New home permit in Atlanta', summary: 'New Construction', subtype: 'permit', data: { subtype: 'permit' }, ...over });
const al = (signal_id: number, trade: string, h = 2, over: any = {}) => ({ id: signal_id * 100 + trade.length, user_id: 'u', signal_id, source: 's', kind: 'permit', subtype: 'permit', trade, created_at: ago(h), emailed_at: null, ...over });
const emptyReport: any = buildQualityReport({ now: NOW, alerts: [], signals: [], feedback: [], profiles: [], matches: [] });

describe('REV-ROUTES 11: contact path share', () => {
  it('is computed correctly on a mixed week', () => {
    const signals = [
      sig(1), // permit, business contact
      sig(2, { summary: 'New Construction | 250 SYCAMORE ST' }), // permit, site in summary
      sig(3), // permit, nothing
      sig(4, { source: 'socrata-nyc-311', kind: 'civic', subtype: '311', title: '311 request in New York City: HEAT/HOT WATER / ENTIRE BUILDING', summary: null }), // alert, no contact
      sig(5, { source: 'socrata-chicago-violations', kind: 'civic', subtype: 'violation', title: 'Code violation in Chicago: ROOF', summary: null }), // site contact
      sig(6, { title: 'Roof permit in Atlanta', summary: 'Residential Alteration | 9 OAK ST' }), // own trade: market insight, not an alert
      sig(7), // alert older than the window
    ];
    const contacts = [{ signal_id: 1, role: 'contractor', name: 'Peach Builders LLC', address: null }, { signal_id: 5, role: 'site', name: '', address: '2150 N DAMEN' }, { signal_id: 3, role: 'site', name: '', address: 'MAIN ST' }];
    const alerts = [al(1, 'landscaping'), al(2, 'landscaping'), al(3, 'landscaping'), al(4, 'plumbing'), al(5, 'roofing'), al(6, 'roofing'), al(7, 'landscaping', 24 * 8), al(99, 'landscaping')];
    const r = buildContactPathReport({ now: NOW, alerts: alerts as any, signals: signals as any, contacts: contacts as any });
    console.log(JSON.stringify({ all: r.all, trades: r.trades }));
    expect(r.all).toEqual({ trade: 'all trades', alerted: 5, withPath: 3, share: 0.6 });
    expect(r.trades.find((t) => t.trade === 'landscaping')).toEqual({ trade: 'landscaping', alerted: 3, withPath: 2, share: 2 / 3 });
    expect(r.trades.find((t) => t.trade === 'plumbing')).toEqual({ trade: 'plumbing', alerted: 1, withPath: 0, share: 0 });
    expect(r.trades.find((t) => t.trade === 'roofing')).toEqual({ trade: 'roofing', alerted: 1, withPath: 1, share: 1 });
  });
  it('stays blank, never 0% or 100%, when data is missing', async () => {
    const cases: Array<[string, FakeDb]> = [];
    const full = () => new FakeDb({ holler_alert_log: [al(1, 'landscaping')], holler_signals: [sig(1)], holler_signal_contacts: [] });
    const a = full(); a.failOn = { 'holler_alert_log.select': 'relation "public.holler_alert_log" does not exist' }; cases.push(['alert log missing', a]);
    const b = full(); b.failOn = { 'holler_signals.select': 'timeout' }; cases.push(['signals read fails', b]);
    const c = full(); c.failOn = { 'holler_signal_contacts.select': "Could not find the table 'public.holler_signal_contacts' in the schema cache" }; cases.push(['contacts table missing', c]);
    cases.push(['no alert rows at all', new FakeDb({ holler_alert_log: [], holler_signals: [], holler_signal_contacts: [] })]);
    cases.push(['alerts logged but every signal pruned', new FakeDb({ holler_alert_log: [al(1, 'landscaping')], holler_signals: [], holler_signal_contacts: [] })]);
    cases.push(['only market-insight rows logged', new FakeDb({ holler_alert_log: [al(6, 'roofing')], holler_signals: [sig(6, { title: 'Roof permit in Atlanta' })], holler_signal_contacts: [] })]);
    for (const [name, db] of cases) {
      const r = await loadContactPathReport(db as any, NOW);
      const html = renderQualityHtml(emptyReport, undefined, r);
      const block = html.slice(html.indexOf('Alerts with a contact path'));
      const text = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 140);
      console.log(`${name}: status=${r.status} alerted=${r.all.alerted} share=${r.all.share} | ${text}`);
      expect(r.all.share, name).toBeNull();
      expect(/\b(?:0|100)(?:\.0)?%/.test(block), name).toBe(false);
    }
  });
  it('the label the line uses (no summary) against the label the matcher used (with summary), on the real stored permit rows', () => {
    const rows = JSON.parse(readFileSync('tests/signals/__data__/review-f-sample-156.json', 'utf8')) as any[];
    let pairs = 0;
    const diff: string[] = [];
    for (const r of rows) {
      if (!/permits$/.test(r[1])) continue;
      const base = { source: r[1], kind: 'permit', subtype: 'permit', title: r[2] };
      for (const c of CATEGORIES) {
        if (!carriedTrades({ ...base, summary: r[3] }, r[5]).includes(c.id) && !carriedTrades(base, r[5]).includes(c.id)) continue;
        pairs++;
        const withS = labelFor({ ...base, summary: r[3], categories: r[5] } as any, c.id as any);
        const without = labelFor(base as any, c.id as any);
        if (withS !== without) diff.push(`${r[0]} ${r[1]} "${r[2]}" [${r[3]}] ${c.id}: matcher ${withS}, dashboard ${without}`);
      }
    }
    console.log(`label pairs ${pairs}, differing ${diff.length}`);
    for (const d of diff.slice(0, 12)) console.log('  ' + d);
    expect(pairs).toBeGreaterThan(100);
  });
  it('redo 1 (review P2-5): the line labels each card with its summary, as the matcher does', () => {
    const rows = JSON.parse(readFileSync('tests/signals/__data__/review-f-sample-156.json', 'utf8')) as any[];
    let checked = 0;
    for (const r of rows) {
      if (!/permits$/.test(r[1])) continue;
      const base = { source: r[1], kind: 'permit', subtype: 'permit', title: r[2] };
      for (const c of CATEGORIES) {
        const withS = labelFor({ ...base, summary: r[3] } as any, c.id as any);
        const without = labelFor(base as any, c.id as any);
        if (withS === without) continue;
        const rep = buildContactPathReport({
          now: new Date('2026-11-22T12:00:00Z'),
          alerts: [{ user_id: 'u', signal_id: r[0], source: null, kind: null, subtype: null, trade: c.id, created_at: '2026-11-21T12:00:00Z', emailed_at: null }],
          signals: [{ id: r[0], source: r[1], kind: 'permit', title: r[2], summary: r[3], subtype: 'permit' }],
          contacts: [],
        });
        expect(rep.all.alerted, `${r[0]} ${c.id}`).toBe(withS === 'act_now' || withS === 'coming_soon' ? 1 : 0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});
