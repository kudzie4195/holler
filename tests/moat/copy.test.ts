import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FOLLOWUP_INTRO, FOLLOWUP_OUTRO, FOLLOWUP_SUBJECT, renderFollowUp } from '@/lib/moat/email';

const BANNED = ['delve', 'robust', 'seamless', 'elevate', 'unlock', 'empower', 'journey', 'landscape', 'leverage', 'not only', 'more than just', "it's worth noting", "whether you're"];
const now = new Date('2026-11-19T12:00:00Z');
const items = [1, 2, 3].map((i) => ({ title: `Hail alert ${i}`, kind: 'alert', place: 'Marietta, GA', occurredAt: '2026-11-10T12:00:00Z', yesUrl: `https://x.test/y${i}`, noUrl: `https://x.test/n${i}` }));

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

describe('follow-up email copy', () => {
  const mail = renderFollowUp({ businessName: 'Acme Roofing', items, unsubscribeUrl: 'https://x.test/u', now });
  const prose = [...FOLLOWUP_INTRO, ...FOLLOWUP_OUTRO].join(' ');
  it('promises nothing the product does not do yet (no "more of those", review r4)', () => {
    const all = FOLLOWUP_INTRO.join(' ');
    expect(all).not.toMatch(/more of those|fewer of the rest/i);
    expect(all).toContain('Your answers help us learn which kinds of alerts pay off for people in your trade.');
  });

  it('has no em or en dashes and no banned words', () => {
    for (const s of [mail.subject, mail.html, mail.text, prose]) {
      expect(s).not.toMatch(/[–—]/);
      for (const b of BANNED) expect(s.toLowerCase()).not.toContain(b);
    }
  });
  it('meets the sentence rhythm rules (prose plus the fixed footer lines)', () => {
    const body = `${prose} You get this because email alerts are on for your Holler account. Turn off email alerts. Holler is run by ColorLabPro, Inc., 2535 Dallas Highway SW STE B #1036, Marietta, GA 30064, USA.`;
    const lens = sentences(body).map((s) => s.split(/\s+/).length);
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
    expect(mean).toBeGreaterThanOrEqual(12);
    expect(mean).toBeLessThanOrEqual(22);
    expect(sd / mean).toBeGreaterThanOrEqual(0.55);
    expect(lens.filter((n) => n < 8).length / lens.length).toBeGreaterThanOrEqual(0.12);
    expect(FOLLOWUP_SUBJECT.length).toBeLessThan(80);
  });
  it('carries the postal footer, the unsubscribe link and at most 5 alerts', () => {
    expect(mail.html).toContain('ColorLabPro, Inc.');
    expect(mail.text).toContain('Turn off email alerts: https://x.test/u');
    const six = renderFollowUp({ businessName: 'A', items: [...items, ...items], unsubscribeUrl: 'https://x.test/u', now });
    expect((six.text.match(/^Yes: /gm) ?? []).length).toBe(5);
  });
  it('escapes a hostile title and business name', () => {
    const m = renderFollowUp({ businessName: '<script>x</script>', items: [{ ...items[0], title: '<img src=x onerror=alert(1)>' }], unsubscribeUrl: 'https://x.test/u', now });
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<img');
  });
});

describe('migration 0015 text', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/0015_holler_moat.sql'), 'utf8');
  it('the archive copies only the allowed columns', () => {
    const body = sql.slice(sql.indexOf('insert into public.holler_signal_archive'), sql.indexOf('from public.holler_signals s'));
    for (const forbidden of ['title', 'summary', 's.url', 'lat', 'lon', 's.data,', 'place_slug', 'external_id']) expect(body).not.toContain(forbidden);
  });
  it('is idempotent, RLS on and service role only for internal tables', () => {
    for (const t of ['holler_signal_archive', 'holler_alert_log', 'holler_outcome_asks']) {
      expect(sql).toContain(`alter table public.${t} enable row level security`);
      expect(sql).toContain(`revoke all on table public.${t} from public, anon, authenticated`);
    }
    expect(sql).not.toMatch(/grant [^;]*holler_(signal_archive|alert_log)[^;]* to (anon|authenticated)/i);
    expect(sql).not.toMatch(/create (unique )?index (?!if not exists)/i);
    expect(sql).not.toMatch(/create table (?!if not exists)/i);
  });
});
