// Every member-facing email ends with who sent it and our postal address (CAN-SPAM), read from lib/legal/company.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMPANY } from '@/lib/legal/company';
import { postalFooterHtml, postalFooterText } from '@/lib/legal/email-footer';
import { renderDigest, renderPasswordReset, renderVerifyEmail, renderWelcome } from '@/lib/email/templates';

const digestArgs = {
  businessName: 'Ace',
  items: [{ kind: 'alert', title: 'Hail', occurredAt: '2026-11-17T10:00:00Z' }],
  appUrl: 'https://x.test/app',
  unsubscribeUrl: 'https://x.test/api/cron/notify/unsubscribe?t=abc',
  now: new Date('2026-11-17T12:00:00Z'),
};

function all() {
  return {
    digest: renderDigest(digestArgs),
    reset: renderPasswordReset({ resetUrl: 'https://x.test/r' }),
    welcome: renderWelcome({ businessName: 'Ace', appUrl: 'https://x.test/app' }),
    verify: renderVerifyEmail({ verifyUrl: 'https://x.test/v', appUrl: 'https://x.test/app' }),
  };
}

afterEach(() => {
  vi.doUnmock('@/lib/legal/company');
  vi.resetModules();
});

describe('postal footer', () => {
  it('reads brand, legal name and address from COMPANY', () => {
    expect(postalFooterText()).toBe(`${COMPANY.brand} is run by ${COMPANY.legalName}, ${COMPANY.addressLine}.`);
    expect(postalFooterHtml()).toContain(COMPANY.addressLine);
    expect(postalFooterHtml()).toContain(COMPANY.legalName);
    expect(postalFooterHtml()).not.toContain('—');
  });

  it.each(['digest', 'reset', 'welcome', 'verify'] as const)('%s email: html and text end with sender and postal address', (k) => {
    const r = all()[k];
    expect(r.html).toContain(postalFooterHtml());
    expect(r.html).toContain(COMPANY.addressLine);
    expect(r.text).toContain(postalFooterText());
    expect(r.text.trimEnd().endsWith(postalFooterText())).toBe(true);
    // The footer sits inside the wrapper, as the last paragraph.
    expect(r.html.endsWith(`${postalFooterHtml()}</div>`)).toBe(true);
    expect(r.subject + r.html + r.text).not.toContain('—');
  });

  it('the alert digest keeps its unsubscribe link next to the address', () => {
    const { digest } = all();
    expect(digest.html).toContain('unsubscribe?t=abc');
    expect(digest.html).toContain('Turn off email alerts');
    expect(digest.text).toContain('Turn off email alerts: https://x.test/api/cron/notify/unsubscribe?t=abc');
  });

  it('escapes every COMPANY value in the html footer', async () => {
    vi.resetModules();
    vi.doMock('@/lib/legal/company', () => ({
      COMPANY: { brand: 'H<o>ller', legalName: 'A & "B" Inc.', addressLine: "1 <Main> St, O'Town" },
    }));
    const f = await import('@/lib/legal/email-footer');
    const html = f.postalFooterHtml();
    expect(html).toContain('H&lt;o&gt;ller is run by A &amp; &quot;B&quot; Inc., 1 &lt;Main&gt; St, O&#39;Town.');
    expect(html).not.toContain('<Main>');
    expect(f.postalFooterText()).toBe(`H<o>ller is run by A & "B" Inc., 1 <Main> St, O'Town.`);
    const t = await import('@/lib/email/templates');
    expect(t.renderVerifyEmail({ verifyUrl: 'https://x.test/v', appUrl: 'https://x.test/app' }).html).toContain('1 &lt;Main&gt; St');
  });
});
