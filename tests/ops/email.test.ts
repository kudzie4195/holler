// Email identity (F-16). The Resend SDK is replaced by a stub that records the payload; the field names it checks (from, replyTo, headers)
// are the ones in node_modules/resend/dist/index.d.mts (sourced: CreateEmailOptions.replyTo).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sent: Record<string, unknown>[] = [];

async function load(env: Record<string, string>) {
  vi.resetModules();
  sent.length = 0;
  for (const k of ['RESEND_API_KEY', 'EMAIL_FROM', 'SUPPORT_EMAIL', 'ADMIN_EMAIL']) vi.stubEnv(k, env[k] ?? '');
  vi.doMock('resend', () => ({
    Resend: class {
      emails = {
        send: async (p: Record<string, unknown>) => {
          sent.push(p);
          return { data: { id: 'em_1' }, error: null };
        },
      };
    },
  }));
  return import('../../lib/email');
}

const msg = { to: 'a@example.com', subject: 's', html: '<p>h</p>', text: 'h' };

beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('sendEmail', () => {
  it('skips with reason no_api_key when RESEND_API_KEY is missing', async () => {
    const { sendEmail } = await load({ EMAIL_FROM: 'Holler <a@x.com>' });
    expect(await sendEmail(msg)).toEqual({ skipped: true, reason: 'no_api_key' });
    expect(sent).toHaveLength(0);
  });

  it('skips with reason no_from when EMAIL_FROM is unset, instead of sending from an undeliverable default', async () => {
    const { sendEmail } = await load({ RESEND_API_KEY: 're_x' });
    expect(await sendEmail(msg)).toEqual({ skipped: true, reason: 'no_from' });
    expect(sent).toHaveLength(0);
  });

  it('sends from EMAIL_FROM with replyTo = SUPPORT_EMAIL when set', async () => {
    const { sendEmail } = await load({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'Holler <alerts@mail.x.com>', SUPPORT_EMAIL: 'help@x.com' });
    expect(await sendEmail({ ...msg, headers: { 'List-Unsubscribe': '<u>' } })).toEqual({ ok: true, id: 'em_1' });
    expect(sent[0]).toMatchObject({ from: 'Holler <alerts@mail.x.com>', replyTo: 'help@x.com', to: 'a@example.com', headers: { 'List-Unsubscribe': '<u>' } });
  });

  it('sets no replyTo when SUPPORT_EMAIL is unset', async () => {
    const { sendEmail } = await load({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'Holler <alerts@mail.x.com>' });
    await sendEmail(msg);
    expect(sent[0]).not.toHaveProperty('replyTo');
  });

  it('has no DEFAULT_FROM left to leak', async () => {
    const mod = (await load({})) as Record<string, unknown>;
    expect(mod.DEFAULT_FROM).toBeUndefined();
  });
});

describe('contact line in emails', () => {
  const digestArgs = {
    businessName: 'Ace',
    items: [{ kind: 'alert', title: 'Hail', occurredAt: '2026-11-17T10:00:00Z' }],
    appUrl: 'https://x.test/app',
    unsubscribeUrl: 'https://x.test/u',
    now: new Date('2026-11-17T12:00:00Z'),
  };

  it('uses SUPPORT_EMAIL, else the address inside EMAIL_FROM, else shows no contact line', async () => {
    let m = await load({ SUPPORT_EMAIL: 'help@x.com', EMAIL_FROM: 'Holler <alerts@x.com>' });
    expect(m.contactAddress()).toBe('help@x.com');
    expect(m.renderDigest(digestArgs).html).toContain('mailto:help@x.com');
    expect(m.renderDigest(digestArgs).text).toContain('Contact us: help@x.com');

    m = await load({ EMAIL_FROM: 'Holler <alerts@x.com>' });
    expect(m.contactAddress()).toBe('alerts@x.com');

    m = await load({ EMAIL_FROM: 'plain@x.com' });
    expect(m.contactAddress()).toBe('plain@x.com');

    m = await load({});
    expect(m.contactAddress()).toBeNull();
    expect(m.renderDigest(digestArgs).html).not.toContain('Contact us');
  });

  it('puts the contact line in verify, reset and welcome emails', async () => {
    const m = await load({ SUPPORT_EMAIL: 'help@x.com' });
    expect(m.renderVerifyEmail({ verifyUrl: 'https://x.test/v', appUrl: 'https://x.test/app' }).html).toContain('mailto:help@x.com');
    expect(m.renderPasswordReset({ resetUrl: 'https://x.test/r' }).text).toContain('help@x.com');
    expect(m.renderWelcome({ businessName: 'A', appUrl: 'https://x.test/app' }).html).toContain('mailto:help@x.com');
  });

  it('the verify email no longer claims the trial has started at signup (F-19)', async () => {
    const m = await load({});
    const v = m.renderVerifyEmail({ verifyUrl: 'https://x.test/v', appUrl: 'https://x.test/app' });
    expect(v.html + v.text).not.toMatch(/trial has started/);
    expect(v.text).toMatch(/starts when you finish setting up/);
    expect(v.html + v.text).not.toContain('—');
  });
});
