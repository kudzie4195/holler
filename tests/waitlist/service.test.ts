// "Coming to your area" waitlist: validation, rate limits, no enumeration, double opt-in, privacy of what is stored.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AreaWaitlist } from '../../components/area-waitlist';
import { renderWaitlistConfirm } from '../../lib/email/templates';
import { signScopedToken, verifyScopedToken } from '../../lib/email/token';
import {
  WAITLIST_CONFIRM_PURPOSE,
  WAITLIST_CONSENT_VERSION,
  cleanEmail,
  cleanTrade,
  cleanZip,
  confirmWaitlist,
  joinWaitlist,
  type WaitlistDeps,
  type WaitlistRow,
} from '../../lib/waitlist/service';

const SECRET = 'test-secret';
const ID = '6f1c2b0a-1d2e-4f3a-9b8c-7d6e5f4a3b2c';

function fakeDeps(over: Partial<WaitlistDeps> & { existing?: { confirmed_at: string | null; unsubscribed_at: string | null } | null } = {}) {
  const rows: WaitlistRow[] = [];
  const sent: { to: string; confirmUrl: string; place: string }[] = [];
  const limits: string[][] = [];
  const confirmed: string[] = [];
  const existing = over.existing === undefined ? { confirmed_at: null, unsubscribed_at: null } : over.existing;
  const deps: WaitlistDeps = {
    db: {
      upsert: async (row) => {
        rows.push(row);
        return { error: null };
      },
      find: async () => ({ data: existing ? { id: ID, ...existing } : null, error: null }),
      confirm: async (id) => {
        confirmed.push(id);
        return { data: id === ID ? { id } : null, error: null };
      },
    },
    hit: async (l) => {
      limits.push(l.map((x) => x.key));
      return 'allowed';
    },
    lookupZip: (zip) => (zip === '30080' ? { state: 'GA', lat: 33.879612, lon: -84.502345, city: 'Smyrna' } : null),
    signToken: (id) => signScopedToken(WAITLIST_CONFIRM_PURPOSE, id, SECRET, 3600),
    verifyToken: (t) => verifyScopedToken(t, WAITLIST_CONFIRM_PURPOSE, SECRET),
    sendConfirm: async (m) => {
      sent.push(m);
      return true;
    },
    siteUrl: 'https://localholler.com/',
    now: () => new Date('2026-11-19T12:00:00Z'),
    ...over,
  };
  return { deps, rows, sent, limits, confirmed };
}

const input = { email: '  Pat@Example.COM ', zip: '30080', trade: 'roofing', ip: '203.0.113.9' };

describe('validation', () => {
  it('normalises email and rejects junk', () => {
    expect(cleanEmail(' A@B.co ')).toBe('a@b.co');
    for (const bad of ['', 'a', 'a@b', 'a b@c.com', '@c.com', 42, null, `${'x'.repeat(250)}@a.com`]) expect(cleanEmail(bad)).toBeNull();
  });
  it('accepts only a 5 digit ZIP and a slug trade', () => {
    expect(cleanZip('30080')).toBe('30080');
    for (const bad of ['3008', '300800', 'abcde', 30080]) expect(cleanZip(bad)).toBeNull();
    expect(cleanTrade('roofing')).toBe('roofing');
    expect(cleanTrade('Roofing; drop')).toBeNull();
  });
});

describe('joinWaitlist', () => {
  it('stores one row with a rounded ZIP centroid and the consent version, and sends one confirm link', async () => {
    const { deps, rows, sent, limits } = fakeDeps();
    expect(await joinWaitlist(deps, input)).toEqual({ code: 'ok' });
    expect(rows).toEqual([
      { email: 'pat@example.com', zip: '30080', state: 'GA', lat: 33.88, lon: -84.502, trade: 'roofing', consent_version: WAITLIST_CONSENT_VERSION },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('pat@example.com');
    expect(sent[0].place).toBe('Smyrna, GA');
    expect(sent[0].confirmUrl.startsWith('https://localholler.com/waitlist/confirm?token=')).toBe(true);
    // Both limits checked, and neither key contains the raw IP or email.
    expect(limits[0]).toHaveLength(2);
    expect(limits[0].join(' ')).not.toMatch(/203\.0\.113\.9|pat@example/);
  });

  it('never stores the IP', async () => {
    const { deps, rows } = fakeDeps();
    await joinWaitlist(deps, input);
    expect(JSON.stringify(rows)).not.toContain('203.0.113.9');
  });

  it('answers ok but sends nothing for an address already confirmed or unsubscribed (no enumeration, no re-mail)', async () => {
    for (const existing of [
      { confirmed_at: '2026-11-01T00:00:00Z', unsubscribed_at: null },
      { confirmed_at: null, unsubscribed_at: '2026-11-02T00:00:00Z' },
    ]) {
      const { deps, sent } = fakeDeps({ existing });
      expect(await joinWaitlist(deps, input)).toEqual({ code: 'ok' });
      expect(sent).toHaveLength(0);
    }
  });

  it('rejects a bad email or an unknown ZIP before any rate limit or write', async () => {
    const a = fakeDeps();
    expect(await joinWaitlist(a.deps, { ...input, email: 'nope' })).toEqual({ code: 'invalid_email' });
    expect(await joinWaitlist(a.deps, { ...input, zip: '99999' })).toEqual({ code: 'invalid_zip' });
    expect(a.limits).toHaveLength(0);
    expect(a.rows).toHaveLength(0);
  });

  it('drops a malformed trade instead of failing', async () => {
    const { deps, rows } = fakeDeps();
    await joinWaitlist(deps, { ...input, trade: '<script>' });
    expect(rows[0].trade).toBeNull();
  });

  it('is limited, and soft-fails on a missing table or a failed send', async () => {
    expect(await joinWaitlist(fakeDeps({ hit: async () => 'limited' }).deps, input)).toEqual({ code: 'limited' });
    expect(await joinWaitlist(fakeDeps({ hit: async () => 'error' }).deps, input)).toEqual({ code: 'unavailable' });
    const missing = fakeDeps();
    missing.deps.db.upsert = async () => ({ error: { code: '42P01' } });
    expect(await joinWaitlist(missing.deps, input)).toEqual({ code: 'unavailable' });
    expect(await joinWaitlist(fakeDeps({ sendConfirm: async () => false }).deps, input)).toEqual({ code: 'unavailable' });
  });
});

describe('confirmWaitlist', () => {
  it('confirms with a valid token and rejects forged, expired, wrong-purpose and junk tokens', async () => {
    const { deps, confirmed } = fakeDeps();
    expect(await confirmWaitlist(deps, deps.signToken(ID))).toEqual({ code: 'confirmed' });
    expect(confirmed).toEqual([ID]);
    const forged = signScopedToken(WAITLIST_CONFIRM_PURPOSE, ID, 'other-secret', 3600);
    const expired = signScopedToken(WAITLIST_CONFIRM_PURPOSE, ID, SECRET, 60, Date.now() - 3_600_000);
    const verifyTok = signScopedToken('verify', ID, SECRET, 3600);
    for (const bad of [forged, expired, verifyTok, '', 'x.y', 42, 'a'.repeat(500)]) {
      expect(await confirmWaitlist(deps, bad)).toEqual({ code: 'invalid' });
    }
    expect(confirmed).toEqual([ID]);
  });

  it('a deleted row reads as an inactive link', async () => {
    const { deps } = fakeDeps();
    const other = '00000000-0000-4000-8000-000000000000';
    expect(await confirmWaitlist(deps, signScopedToken(WAITLIST_CONFIRM_PURPOSE, other, SECRET, 3600))).toEqual({ code: 'invalid' });
  });
});

describe('email and card copy', () => {
  it('the confirm email promises one email, has the link in both parts, and escapes the place', () => {
    const m = renderWaitlistConfirm({ confirmUrl: 'https://localholler.com/waitlist/confirm?token=a.b', place: 'Smyrna, GA <x>' });
    expect(m.text).toContain('https://localholler.com/waitlist/confirm?token=a.b');
    expect(m.html).toContain('https://localholler.com/waitlist/confirm?token=a.b');
    expect(m.html).not.toContain('<x>');
    expect(m.text).toMatch(/one email when we launch there\. Nothing else\./);
  });

  it('the card names the place, has a labelled email field and one submit button', () => {
    const html = renderToStaticMarkup(createElement(AreaWaitlist, { zip: '30080', trade: 'roofing', placeLabel: 'Smyrna, GA' }));
    expect(html).toContain('Holler is not in Smyrna, GA yet.');
    expect(html).toMatch(/<label[^>]*>Email<\/label>/);
    expect(html).toMatch(/type="email"/);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('Tell me when you launch');
  });
});

describe('migration 0021', () => {
  const sql = readFileSync('supabase/migrations/0021_holler_zip_waitlist.sql', 'utf8');
  it('is service-role only and touches only holler_ objects', () => {
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/revoke all on table public\.holler_zip_waitlist from public, anon, authenticated/);
    expect(sql).not.toMatch(/create policy/i);
    // Every object the DDL names (comments stripped) is a holler_ object.
    const ddl = sql.replace(/--[^\n]*/g, '');
    const objects = [
      ...ddl.matchAll(/(?:create table if not exists|create unique index if not exists|create index if not exists|alter table|revoke all on table|drop constraint if exists|add constraint)\s+(?:public\.)?([a-z_]+)/gi),
      ...ddl.matchAll(/\bon public\.([a-z_]+)/gi),
    ].map((m) => m[1]);
    expect(objects.length).toBeGreaterThan(6);
    for (const o of objects) expect(o).toMatch(/^holler_/);
  });
  it('one row per email and ZIP', () => {
    expect(sql).toMatch(/unique index if not exists holler_zip_waitlist_email_zip_idx on public\.holler_zip_waitlist \(email, zip\)/);
  });
});
