/**
 * Round 33 review fix: HOLLER_SAM_LABELS_ENABLED is OFF by default, and with it off every card, email and app answer for a federal notice is
 * what it was before round 33 (no set-aside line, no early-notice line, sole-source and hyphenated notices routed as before, the old
 * closing line in the email).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/lib/i18n/en';
import { labelFor } from '@/lib/signals/lead-rules';
import { intentLine } from '@/lib/signals/intent';
import { samLabelsEnabled, SAM_LABELS_FLAG } from '@/lib/signals/sam-labels-switch';
import { hasSetAsideLine, samCardLine } from '@/lib/signals/sam-notice';
import { buildAlerts, type MatchRow } from '@/lib/mobile/feed';
import { digestHonesty, renderDigest, type DigestItem } from '@/lib/email/templates';
import { ENV_KEYS } from '@/lib/env';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('server-only', () => ({}));
afterEach(() => vi.unstubAllEnvs());

const NOW = new Date('2026-11-25T15:00:00Z');
const sam = (id: number, summary: string, extra: Record<string, unknown> = {}) => ({
  id, source: 'sam-gov', kind: 'contract', subtype: null, title: 'Federal bid in Atlanta, GA: Grounds maintenance', summary,
  url: 'https://sam.gov/opp/x/view', city: 'Atlanta', state: 'GA', county: null, zip: null, lat: 33.749, lon: -84.388, severity: 2, categories: ['landscaping'],
  occurred_at: '2026-11-24T00:00:00.000Z', expires_at: '2026-12-15T12:00:00.000Z', ...extra,
});
const row = (id: number, signal: Record<string, unknown>): MatchRow => ({ id, status: 'new', distance_mi: 3, draft: null, created_at: '2026-11-25T14:00:00Z', signal }) as unknown as MatchRow;
const deps = { userId: 'u1', locked: false, db: {} as never, admin: null, siteUrl: 'https://localholler.com', now: NOW.getTime(), trades: ['landscaping'] };

describe('the switch', () => {
  it('is off unless 1, true, on or yes, and is a listed env key', () => {
    expect(SAM_LABELS_FLAG).toBe('HOLLER_SAM_LABELS_ENABLED');
    expect(samLabelsEnabled(undefined)).toBe(false);
    expect(samLabelsEnabled('')).toBe(false);
    expect(samLabelsEnabled('0')).toBe(false);
    for (const v of ['1', 'true', 'ON', ' yes ']) expect(samLabelsEnabled(v)).toBe(true);
    expect(ENV_KEYS as readonly string[]).toContain('HOLLER_SAM_LABELS_ENABLED');
    const launch = readFileSync(join(__dirname, '../../LAUNCH.md'), 'utf8');
    expect(launch).toContain('HOLLER_SAM_LABELS_ENABLED');
  });
});

describe('switch OFF (the default): nothing a member reads changes', () => {
  it('samCardLine returns null for every kind of notice', () => {
    for (const summary of ['Sources Sought | VA', 'Presolicitation | GSA', 'Solicitation | GSA', 'Combined Synopsis/Solicitation | ARMY']) {
      for (const setAside of ['SBA', '8AN', 'LAS', undefined]) expect(samCardLine({ source: 'sam-gov', summary, setAside }, 'en')).toBeNull();
    }
  });
  it('the app feed card has no line and the intent line is the old one, even for a sources-sought notice', async () => {
    const [a] = await buildAlerts([row(1, sam(1, 'Sources Sought | VA | NAICS 561730', { samSetAside: 'SBA' }))], { ...deps, lang: 'es' });
    expect(a.bidLine).toBeNull();
    expect(a.intent.line).toBe('This work is out for bid. No contract has been awarded yet.');
    expect(a.label).toBe('coming_soon'); // routing for Sources Sought was already a heads-up on main
  });
  it('routing is main routing: a sole-source notice stays act_now, a hyphenated presolicitation too', () => {
    const base = { source: 'sam-gov', kind: 'contract', title: 'Federal bid in Denver, CO: Janitorial services', state: 'CO', lat: 39.7, lon: -104.9 };
    expect(labelFor({ ...base, summary: 'Solicitation | GSA', setAside: '8AN' }, 'janitorial-commercial')).toBe('act_now');
    expect(labelFor({ ...base, summary: 'Pre-solicitation | GSA' }, 'janitorial-commercial')).toBe('act_now');
    expect(labelFor({ ...base, summary: 'Presolicitation | GSA' }, 'janitorial-commercial')).toBe('coming_soon');
  });
  it('the email keeps its old closing line and prints no set-aside or early-notice words', () => {
    const item: DigestItem = { kind: 'contract', source: 'sam-gov', title: 'Federal bid in Atlanta, GA: Grounds', summary: 'Sources Sought | VA', place: 'Atlanta, GA', occurredAt: NOW.toISOString(), sourceUrl: 'https://sam.gov/opp/x/view', label: 'coming_soon', deadline: null, bidLine: null } as DigestItem;
    expect(digestHonesty([item], 'en')).toContain(en['email.honesty.bid']);
    expect(digestHonesty([item], 'en')).not.toContain('set-aside');
    const mail = renderDigest({ businessName: 'Acme', items: [item], totalCount: 1, appUrl: 'https://x.test/app', unsubscribeUrl: 'https://x.test/u', now: NOW, lang: 'en' } as never);
    for (const body of [mail.html, mail.text]) {
      expect(body).not.toMatch(/Early notice|Set aside|set-aside/);
      expect(body).toContain(en['email.honesty.bid']);
    }
  });
  it('the intent line function with the switch off never reads the summary', () => {
    expect(intentLine({ kind: 'contract', source: 'sam-gov', summary: 'Presolicitation | GSA' })).toBe('This work is out for bid. No contract has been awarded yet.');
  });
});

describe('switch ON: the closing email line changes only when a set-aside line is shown', () => {
  it('uses the set-aside closing line (EN and ES) for a card with a set-aside, the old one otherwise', () => {
    vi.stubEnv('HOLLER_SAM_LABELS_ENABLED', '1');
    const plain = { kind: 'contract', source: 'sam-gov', title: 'x', summary: 'Solicitation | GSA', place: 'Atlanta, GA', occurredAt: NOW.toISOString(), label: 'act_now' } as DigestItem;
    const withAside = { ...plain, hasSetAside: true, bidLine: 'Set aside for small businesses.' } as DigestItem;
    expect(digestHonesty([plain], 'en')).toContain(en['email.honesty.bid']);
    const text = digestHonesty([withAside], 'en');
    expect(text).not.toContain('does not show who may respond');
    expect(text).toContain('A set-aside limits who may respond');
    expect(digestHonesty([withAside], 'es')).toContain('Una reserva limita quién puede responder');
  });
});

describe('the email closing line follows the switch (app/api/cron/notify/route.ts, hasSetAside)', () => {
  const route = readFileSync(join(__dirname, '../../app/api/cron/notify/route.ts'), 'utf8');
  it('the route decides hasSetAside through hasSetAsideLine, and passes nothing that would override the switch', () => {
    const m = route.match(/hasSetAside:\s*([^\n]+)/);
    expect(m, 'hasSetAside is set in the notify route').not.toBeNull();
    // exactly the helper, three arguments (source, stored code, language); a fourth argument would be an "on" override
    expect(m![1].trim()).toBe('hasSetAsideLine(s.source, s.samSetAside, lang),');
  });
  it('hasSetAsideLine is false with the switch off for every code, true with it on for a federal notice only', () => {
    for (const code of ['SBA', '8AN', 'LAS', 'OTHER']) {
      vi.stubEnv('HOLLER_SAM_LABELS_ENABLED', '');
      expect(hasSetAsideLine('sam-gov', code, 'en')).toBe(false);
      expect(hasSetAsideLine('sam-gov', code, 'es')).toBe(false);
      vi.stubEnv('HOLLER_SAM_LABELS_ENABLED', '1');
      expect(hasSetAsideLine('sam-gov', code, 'en')).toBe(true);
      expect(hasSetAsideLine('sam-gov', code, 'es')).toBe(true);
      expect(hasSetAsideLine('permits', code, 'en')).toBe(false);
    }
    vi.stubEnv('HOLLER_SAM_LABELS_ENABLED', '1');
    expect(hasSetAsideLine('sam-gov', null, 'en')).toBe(false);
    expect(hasSetAsideLine('sam-gov', 'NONE', 'en')).toBe(false);
  });
  it('the helper reads the switch itself by default (a source check: dropping samLabelsEnabled() there fails this)', () => {
    const src = readFileSync(join(__dirname, '../../lib/signals/sam-notice.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function hasSetAsideLine'));
    expect(fn.slice(0, fn.indexOf('\n}\n'))).toMatch(/on: boolean = samLabelsEnabled\(\)[\s\S]*return on && source === 'sam-gov'/);
  });
});
