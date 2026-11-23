// Round 9 unit D: every email takes its look from lib/email/theme.ts (field green, lime only as a fill on green, no old orange).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { EMAIL_COLORS, EMAIL_FONTS, EMAIL_STYLE, PRIMARY_BUTTON_STYLE, SECONDARY_BUTTON_STYLE, emailHeader, emailMarkUrl } from '@/lib/email/theme';
import { siteUrl } from '@/lib/env';
import { digestLinkLabel, renderDigest, renderPasswordReset, renderVerifyEmail, renderWelcome } from '@/lib/email/templates';
import { renderRequestAdmin, renderRequestConfirm, renderRequestPublished, renderRequestReply } from '@/lib/email/request-emails';
import { renderTrialEnded } from '@/lib/lifecycle/templates';
import { renderAiSpendAlert } from '@/lib/ai/alert-email';
import { renderFollowUp } from '@/lib/moat/email';
import { renderMonitorEmail } from '@/lib/monitor/email';
import { htmlPage } from '@/lib/email/html-page';
import { postalFooterHtml } from '@/lib/legal/email-footer';

vi.mock('server-only', () => ({}));

const OWNED = [
  'lib/legal/email-footer.ts',
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
// Helvetica is banned except the condensed bold face that heads the display stack (commander decision, review 2 P2-19).
const OLD = /#E8590C|#AD4205|#FBE8D8|#FAF6EE|#191714|#5C574F|#FFFDF9|#D9D2C3|999px|Fraunces|Georgia|Helvetica(?!Neue-CondensedBold')|(?<!sans-)serif\b|font-size:1[0-2]px/i;
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
      // The whole email, postal footer included.
      expect(m.html, name).not.toMatch(OLD);
      // No empty logo tile drawn in HTML. The only image is the mark in the header, before the wordmark (review 2b P2-12).
      expect(m.html, name).not.toContain(`background:${EMAIL_COLORS.signal}`);
      const imgs = m.html.match(/<img\b[^>]*>/gi) ?? [];
      expect(imgs, name).toHaveLength(1);
      expect(m.html.indexOf('<img'), name).toBeLessThan(m.html.indexOf('>HOLLER</span>'));
    }
  });

  it('the header mark is a 30 px image with an absolute URL from the site URL, empty alt, 6 px corners and fixed size', () => {
    const header = emailHeader();
    const img = header.match(/<img\b[^>]*>/i)?.[0] ?? '';
    expect(img).toContain(`src="${siteUrl}/email-mark.png"`);
    expect(img).toMatch(/src="https?:\/\//);
    expect(img).toContain('width="30"');
    expect(img).toContain('height="30"');
    expect(img).toContain('alt=""');
    expect(img).toContain('border-radius:6px');
    expect(img).toContain('width:30px;height:30px');
    // The host is never typed: it follows the base URL it is given.
    expect(emailMarkUrl('https://preview.example.test/')).toBe('https://preview.example.test/email-mark.png');
    expect(emailHeader('https://preview.example.test')).toContain('src="https://preview.example.test/email-mark.png"');
    expect(fs.readFileSync(path.join(process.cwd(), 'lib/email/theme.ts'), 'utf8')).not.toMatch(/localholler\.com/);
    // The band keeps its height when the image is blocked: the 30 px line box comes from the band and the wordmark.
    expect(header).toMatch(/^<div style="[^"]*line-height:30px">/);
    expect(header).toMatch(/line-height:30px;[^"]*">HOLLER<\/span>/);
    // The file the URL points at exists and is 60 x 60 (sharp at 2x).
    const png = fs.readFileSync(path.join(process.cwd(), 'public/email-mark.png'));
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([60, 60]);
  });

  it('eyebrow lines use the brand green text color', () => {
    expect(EMAIL_STYLE.eyebrow).toContain(`color:${EMAIL_COLORS.brandText}`);
    expect(EMAIL_COLORS.brandText).toBe('#2E5A41');
    const { digest, followUp, trialEnded } = all();
    for (const m of [digest, followUp, trialEnded]) expect(m.html).toContain(`${EMAIL_STYLE.eyebrow}`);
  });

  it('round 23: every card links to its public source under that name; a resident request has no public source page, so it links none', () => {
    const d = renderDigest({
      businessName: 'Acme',
      items: [
        { kind: 'ask', source: 'holler-request', title: 'Service request in Atlanta: Roofing', occurredAt: NOW.toISOString(), sourceUrl: `${siteUrl}/request` },
        { kind: 'permit', source: 'atl-permits', title: 'Permit', occurredAt: NOW.toISOString(), sourceUrl: 'https://data.example.gov/p/1' },
        { kind: 'report', source: 'spc', title: 'Hail', occurredAt: NOW.toISOString(), sourceUrl: 'https://www.spc.noaa.gov/x' },
      ],
      appUrl: `${U}/app`,
      unsubscribeUrl: `${U}/u`,
      now: NOW,
    });
    const labels = [...d.html.matchAll(/<a class="h-link" href="([^"]+)" style="color:#2E5A41">([^<]+)<\/a>/g)].map((x) => [x[1], x[2]]);
    expect(labels).toEqual([
      ['https://data.example.gov/p/1', 'public source'],
      ['https://www.spc.noaa.gov/x', 'public source'],
    ]);
    // The resident request's own /request link is not printed as a "public source": it is Holler's own form, and the card's action
    // (reply in the feed) is where a member answers it.
    expect(d.html).not.toContain(`${siteUrl}/request`);
    expect(d.html).toContain('Reply to this request');
    // Without a source id, a link to this site's /request page still counts; a /request page on another host does not.
    expect(digestLinkLabel({ sourceUrl: 'https://localholler.com/request' }, 'https://localholler.com')).toBe('Open the request form');
    expect(digestLinkLabel({ sourceUrl: 'https://localholler.com/request/' }, 'https://localholler.com')).toBe('Open the request form');
    expect(digestLinkLabel({ sourceUrl: 'https://city.example.gov/request' }, 'https://localholler.com')).toBe('Open the source');
    expect(digestLinkLabel({ source: 'holler-request', sourceUrl: null })).toBe('Open the request form');
    expect(digestLinkLabel({ source: 'spc', sourceUrl: 'https://www.spc.noaa.gov/x' })).toBe('Open the source');
  });

  it('the postal footer takes its size and color from the theme (13 px, muted)', () => {
    expect(postalFooterHtml()).toContain(`style="${EMAIL_STYLE.small};`);
    expect(EMAIL_STYLE.small).toBe(`font-size:13px;color:${EMAIL_COLORS.muted}`);
    expect(fs.readFileSync(path.join(process.cwd(), 'lib/legal/email-footer.ts'), 'utf8').match(/#[0-9A-Fa-f]{6}\b/g) ?? []).toEqual([]);
  });

  it('the display stack starts with the condensed faces and the secondary edge is the site line-strong', () => {
    expect(EMAIL_FONTS.display).toBe(
      "'HelveticaNeue-CondensedBold','Avenir Next Condensed','Arial Narrow','Roboto Condensed',sans-serif-condensed,Arial,sans-serif",
    );
    expect(EMAIL_COLORS.lineStrong).toBe('#7C847E');
    expect(SECONDARY_BUTTON_STYLE).toContain(`border:1px solid ${EMAIL_COLORS.lineStrong}`);
  });

  it('the digest link to a record says "public source", never "Open source" or "official record"', () => {
    const { digest } = all();
    expect(digest.html).toContain('>public source</a>');
    expect(digest.html + digest.text).not.toMatch(/Open source|official record|source record|its record/);
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
