// Round 17 integration: the two units meet in two places. (1) The owner's quality page and JSON carry BOTH the stage unit's duplicate
// rate and the AI unit's coverage line. (2) A permit stage-update email keeps the AI "why it may matter" line AND the stage line,
// with the update wording (never "new", never "N days ago"), and neither line breaks the wording rules.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { renderDigest } from '@/lib/email/templates';
import { wordingViolations } from '@/lib/ai/note-rules';

const NOW = new Date('2026-11-22T12:00:00Z');

describe('quality dashboard shows the duplicate rate and the AI coverage together', () => {
  afterEach(() => vi.unstubAllEnvs());
  async function load(db: FakeDb) {
    vi.resetModules();
    vi.stubEnv('CRON_SECRET', 's3cret');
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));
    return (await import('../../app/api/admin/quality/route')).GET;
  }
  const req = (qs = '') => new Request(`http://x.test/api/admin/quality${qs}`, { headers: { authorization: 'Bearer s3cret' } });

  it('JSON carries `duplicates` (stage unit) and `aiCoverage` (AI unit) side by side', async () => {
    const db = new FakeDb({});
    const GET = await load(db);
    const body = await (await GET(req())).json();
    expect(body.duplicates).toMatchObject({ windowDays: 7, status: 'ok' });
    expect(body.aiCoverage).toMatchObject({ status: expect.any(String), windowHours: 24 });
    expect(body.all).toBeDefined();
    expect(db.calls.every((c) => c.endsWith('.select'))).toBe(true);
  });

  it('the HTML page has both the AI coverage line and the duplicate table section', async () => {
    const GET = await load(new FakeDb({}));
    const res = await GET(req('?format=html'));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Duplicate listings per source');
    expect(html).toMatch(/AI|classified|permit or civic|permit and civic/i);
    expect(html).not.toContain('<script');
  });

  it('with the stage tables missing and the AI tables missing, both are blank, never zero', async () => {
    const db = new FakeDb({ holler_signals: [{ id: 1, kind: 'permit', source: 'x', created_at: new Date().toISOString(), occurred_at: new Date().toISOString() }] });
    db.failOn['holler_dedupe_drops.select'] = 'relation "holler_dedupe_drops" does not exist';
    db.failOn['holler_signal_ai.select'] = 'relation "holler_signal_ai" does not exist';
    const GET = await load(db);
    const html = await (await GET(req('?format=html'))).text();
    expect(html).toMatch(/Not recorded/);
    expect(html).toMatch(/unavailable/i);
  });
});

describe('a stage-update email keeps the AI note and the stage line', () => {
  const note = 'Landscaping may be needed once the building work is done.';
  const item = {
    kind: 'permit', source: 'socrata-norfolk-permits', subtype: 'permit', title: 'New construction permit in Norfolk', summary: 'New Construction | 100 EXAMPLE AVE',
    place: 'Norfolk, VA', occurredAt: '2026-10-10T00:00:00Z', sourceUrl: null, label: 'coming_soon' as const, trade: 'landscaping',
    permitStage: 'final_inspection', permitStageAt: NOW.toISOString(), permitStageUpdate: true, note,
  };
  const mail = renderDigest({ businessName: 'Green Lawn Co', appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: NOW, items: [item] });

  it('shows "Why it may matter" and "Stage update", with update wording', () => {
    expect(mail.subject).toBe('Update: final inspection on a permit near you');
    expect(mail.text).toContain(`Why it may matter: ${note}`);
    expect(mail.text).toContain('Stage update: final inspection, listed by the public source on Nov 22, 2026.');
    expect(mail.html).toContain('Why it may matter');
    expect(mail.text).not.toMatch(/\d+ days? ago/i);
  });

  it('the same note passes the read-time wording check for a permit, and a stage word in a note would not turn it into a vendor claim', () => {
    expect(wordingViolations(note, { kind: 'permit' })).toEqual([]);
    expect(wordingViolations('The permit is at final inspection, so the contractor already has the job.', { kind: 'permit' }).length).toBeGreaterThan(0);
  });

  it('nothing in the email breaks the wording rules', () => {
    expect(mail.text).not.toMatch(/official record|\bleads?\b|guaranteed|you will win|they need you/i);
  });
});
