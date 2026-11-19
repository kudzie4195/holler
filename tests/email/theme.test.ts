// Round 9 unit D: every email takes its look from lib/email/theme.ts (field green, lime only as a fill on green, no old orange).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { EMAIL_COLORS, EMAIL_FONTS, PRIMARY_BUTTON_STYLE, SECONDARY_BUTTON_STYLE } from '@/lib/email/theme';
import { renderDigest, renderPasswordReset, renderVerifyEmail, renderWelcome } from '@/lib/email/templates';
import { renderRequestAdmin, renderRequestConfirm, renderRequestPublished, renderRequestReply } from '@/lib/email/request-emails';
import { renderTrialEnded } from '@/lib/lifecycle/templates';
import { renderAiSpendAlert } from '@/lib/ai/alert-email';
import { renderFollowUp } from '@/lib/moat/email';
import { renderMonitorEmail } from '@/lib/monitor/email';
import { htmlPage } from '@/lib/email/html-page';
import { postalFooterHtml } from '@/lib/legal/email-footer';

vi.mock('server-only', () => ({}));

const OWNED = [
  'lib/email/templates.ts',
  'lib/email/request-emails.ts',
  'lib/email/html-page.ts',
  'lib/email/health.ts',
  'lib/lifecycle/templates.ts',
  'lib/ai/alert-email.ts',
  'lib/moat/email.ts',
  'lib/monitor/email.ts',
  'lib/mobile/verify-email.ts',
];
const OLD = /#E8590C|#AD4205|#FBE8D8|#FAF6EE|#191714|#5C574F|#FFFDF9|#D9D2C3|999px|Fraunces|Georgia|Helvetica|(?<!sans-)serif\b/i;
// The postal footer comes from lib/legal/email-footer.ts (not owned by the email unit); it is checked apart from the rest.
const withoutFooter = (h: string) => h.replace(postalFooterHtml(), '');
const NOW = new Date('2026-11-19T14:11:00Z');
const U = 'https://localholler.com';

function all() {
  return {
    digest: renderDigest({ businessName: 'Acme', items: [{ kind: 'permit', title: 'Permit', occurredAt: NOW.toISOString(), sourceUrl: `${U}/s` }], appUrl: `${U}/app`, unsubscribeUrl: `${U}/u`, now: NOW }),
    reset: renderPasswordReset({ resetUrl: `${U}/r` }),
    welcome: renderWelcome({ businessName: 'Acme', appUrl: `${U}/app` }),
    verify: renderVerifyEmail({ verifyUrl: `${U}/v`, appUrl: `${U}/app` }),
    confirm: renderRequestConfirm({ confirmUrl: `${U}/c`, tradeLabel: 'Roofing', place: 'Atlanta, GA', summary: 'Leak', openDays: 14, confirmDays: 2 }),
    reply: renderRequestReply({ businessName: 'Acme', businessPlace: null, message: 'Hi', tradeLabel: 'Roofing', place: 'Atlanta, GA', closeUrl: `${U}/x`, reportAddress: null, replyRef: 'r' }),
    published: renderRequestPublished({ tradeLabel: 'Roofing', place: 'Atlanta, GA', summary: null, closeUrl: `${U}/x`, openDays: 14 }),
    admin: renderRequestAdmin({ tradeLabel: 'Roofing', place: 'Atlanta, GA', zip: '30301', description: 'd', summary: null, publicId: 'p', removeUrl: `${U}/rm` }),
    trialEnded: renderTrialEnded({ businessName: 'Acme', feedUrl: `${U}/app`, plansUrl: `${U}/p`, unsubscribeUrl: `${U}/u`, missed: 2 }),
    ai: renderAiSpendAlert({ kind: 'alert_80', month: '2026-11', spentUsd: 40, capUsd: 50 }),
    followUp: renderFollowUp({ businessName: 'Acme', items: [{ title: 'T', kind: 'alert', place: null, occurredAt: NOW.toISOString(), yesUrl: `${U}/y`, noUrl: `${U}/n` }], unsubscribeUrl: `${U}/u`, now: NOW }),
    monitor: renderMonitorEmail({ items: [], recovered: ['scan:error'], now: NOW, sourcesUrl: `${U}/s` }),
  };
}

describe('email theme', () => {
  it('no old color, pill radius or serif stack is left in the email source files', () => {
    for (const f of OWNED) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
      expect(src, f).not.toMatch(OLD);
      // Every literal color lives in lib/email/theme.ts.
      expect(src.match(/#[0-9A-Fa-f]{6}\b/g) ?? [], f).toEqual([]);
    }
  });

  it('every email has the green band with the HOLLER wordmark in the condensed stack and the paper page', () => {
    for (const [name, m] of Object.entries(all())) {
      expect(m.html, name).toContain(`background:${EMAIL_COLORS.brand}`);
      expect(m.html, name).toContain(`background:${EMAIL_COLORS.paper}`);
      expect(m.html, name).toContain(`font-family:${EMAIL_FONTS.display}`);
      expect(m.html, name).toMatch(/text-transform:uppercase[^"]*">HOLLER<\/span>/);
      expect(withoutFooter(m.html), name).not.toMatch(OLD);
    }
  });

  it('member and owner emails keep the postal footer as the last thing in the wrapper', () => {
    for (const [name, m] of Object.entries(all())) expect(m.html.endsWith(`${postalFooterHtml()}</div>`), name).toBe(true);
  });

  it('lime is only a fill, never text or an edge', () => {
    for (const m of Object.values(all())) {
      expect(m.html).not.toMatch(new RegExp(`(?:[^-]color|border[a-z-]*):[^;"]*${EMAIL_COLORS.signal}`, 'i'));
    }
  });

  it('buttons have a 10 px radius and are 44 px tall', () => {
    for (const s of [PRIMARY_BUTTON_STYLE, SECONDARY_BUTTON_STYLE]) {
      expect(s).toContain('border-radius:10px');
      expect(s).toContain('min-height:44px');
      expect(s).toContain('line-height:18px');
    }
    // Padding plus line height reach 44 px even where min-height is ignored (Outlook).
    expect(PRIMARY_BUTTON_STYLE).toContain('padding:13px 22px');
    expect(SECONDARY_BUTTON_STYLE).toMatch(/padding:12px 22px.*border:1px solid/);
    expect(PRIMARY_BUTTON_STYLE).toContain(`background:${EMAIL_COLORS.brand};color:${EMAIL_COLORS.onBrand}`);
  });

  it('the token-link page uses the same look', async () => {
    const html = await htmlPage('Done', 'Body', { form: { action: '/a', button: 'Go' }, links: [{ href: '/b', label: 'Back' }] }).text();
    expect(html).not.toMatch(OLD);
    expect(html).toContain(`background:${EMAIL_COLORS.paper}`);
    expect(html).toContain('>HOLLER</span>');
    expect(html).toMatch(/<a href="\/b" style="[^"]*min-height:44px/);
  });
});
