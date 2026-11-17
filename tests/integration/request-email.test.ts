// Integration round 3, item 4: sendEmail takes an optional replyTo (SUPPORT_EMAIL stays the default), lib/requests/mailer.ts sends
// every request email through sendEmail (no direct Resend call), and every request email ends with the postal footer.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postalFooterHtml, postalFooterText } from '@/lib/legal/email-footer';
import { renderRequestAdmin, renderRequestConfirm, renderRequestReply } from '@/lib/email/request-emails';

vi.mock('server-only', () => ({}));

const sent: Record<string, unknown>[] = [];

async function load(env: Record<string, string>) {
  vi.resetModules();
  sent.length = 0;
  for (const k of ['RESEND_API_KEY', 'EMAIL_FROM', 'SUPPORT_EMAIL']) vi.stubEnv(k, env[k] ?? '');
  vi.doMock('resend', () => ({
    Resend: class {
      emails = { send: async (p: Record<string, unknown>) => (sent.push(p), { data: { id: 'em_1' }, error: null }) };
    },
  }));
  return { email: await import('@/lib/email'), mailer: await import('@/lib/requests/mailer') };
}

const msg = { to: 'resident@example.org', subject: 's', html: '<p>h</p>', text: 'h' };
const ENV = { RESEND_API_KEY: 're_x', EMAIL_FROM: 'Holler <alerts@mail.x.com>', SUPPORT_EMAIL: 'help@x.com' };

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('sendEmail replyTo', () => {
  it('uses the given replyTo instead of SUPPORT_EMAIL', async () => {
    const { email } = await load(ENV);
    expect(await email.sendEmail({ ...msg, replyTo: 'owner@acme.test' })).toEqual({ ok: true, id: 'em_1' });
    expect(sent[0]).toMatchObject({ replyTo: 'owner@acme.test', from: ENV.EMAIL_FROM, to: msg.to });
  });
  it('keeps SUPPORT_EMAIL when replyTo is absent or blank, and none when neither is set', async () => {
    let { email } = await load(ENV);
    await email.sendEmail(msg);
    await email.sendEmail({ ...msg, replyTo: '  ' });
    expect(sent.map((s) => s.replyTo)).toEqual(['help@x.com', 'help@x.com']);
    ({ email } = await load({ RESEND_API_KEY: 're_x', EMAIL_FROM: ENV.EMAIL_FROM }));
    await email.sendEmail(msg);
    expect(sent[0]).not.toHaveProperty('replyTo');
  });
});

describe('lib/requests/mailer.ts sendRequestEmail', () => {
  it('goes through sendEmail: business replies carry the business reply-to, other request mail the support reply-to', async () => {
    const { mailer } = await load(ENV);
    expect(await mailer.sendRequestEmail({ ...msg, replyTo: 'owner@acme.test' })).toBe(true);
    expect(await mailer.sendRequestEmail(msg)).toBe(true);
    expect(sent.map((s) => s.replyTo)).toEqual(['owner@acme.test', 'help@x.com']);
  });
  it('returns false when email is not configured (skipped), never throws', async () => {
    const { mailer } = await load({});
    expect(await mailer.sendRequestEmail({ ...msg, replyTo: 'owner@acme.test' })).toBe(false);
    expect(sent).toHaveLength(0);
  });
  it('no longer calls Resend itself', () => {
    const src = readFileSync(path.resolve(__dirname, '../../lib/requests/mailer.ts'), 'utf8');
    expect(src).not.toMatch(/from 'resend'|new Resend/);
    expect(src).toContain("from '@/lib/email'");
  });
});

describe('every request email ends with the postal footer', () => {
  const all = {
    confirm: renderRequestConfirm({ confirmUrl: 'https://h.test/c?t=1', tradeLabel: 'Roofing', place: 'Atlanta, GA', summary: 'Leak', openDays: 14, confirmDays: 7 }),
    reply: renderRequestReply({
      businessName: 'Acme', businessPlace: 'Atlanta, GA', message: 'We can come Tuesday.', tradeLabel: 'Roofing', place: 'Atlanta, GA',
      closeUrl: 'https://h.test/close?t=2', reportAddress: 'help@x.com', replyRef: 'req_1-1',
    }),
    replyNoReport: renderRequestReply({
      businessName: 'Acme', businessPlace: null, message: 'We can come Tuesday.', tradeLabel: 'Roofing', place: 'Atlanta, GA',
      closeUrl: 'https://h.test/close?t=2', reportAddress: null, replyRef: 'req_1-1',
    }),
    admin: renderRequestAdmin({ tradeLabel: 'Roofing', place: 'Atlanta, GA', zip: '30301', description: 'Leak over the kitchen.', summary: 'Leak', publicId: 'req_1', removeUrl: 'https://h.test/close?t=3' }),
  };
  for (const [name, r] of Object.entries(all)) {
    it(`${name}: html ends with the footer inside the wrapper, text ends with the footer line`, () => {
      expect(r.html.endsWith(`${postalFooterHtml()}</div>`)).toBe(true);
      expect(r.text.trimEnd().endsWith(postalFooterText())).toBe(true);
    });
  }
  it('uses the new token colours (globals.css), not the old ones', () => {
    for (const r of Object.values(all)) {
      expect(r.html).not.toMatch(/#FBFAF7|#16181D|#5D6470/i);
      expect(r.html).toContain('#FAF6EE');
      expect(r.html).toContain('#191714');
    }
  });
});
