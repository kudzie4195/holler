// Criterion 1 on the rendered emails: the business-facing alert (digest) built from the public record, the admin notice and the reply
// carry no resident address; the reply email escapes what a business types; no em dashes anywhere.
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.SUPPORT_EMAIL = 'help@holler.test';
});

import { renderDigest } from '@/lib/email/templates';
import { renderRequestAdmin, renderRequestConfirm, renderRequestReply } from '@/lib/email/request-emails';
import { confirmRequest, createRequest } from '@/lib/requests/service';
import { RESIDENT, VALID, harness, tokenIn } from './helpers';

describe('request emails', () => {
  it('the alert email a matched business gets (digest of the public record) has no resident address or raw text', async () => {
    const h = harness();
    await createRequest(h.deps, VALID, '203.0.113.9');
    await confirmRequest(h.deps, tokenIn(h.sent[0].text, '/request/confirm'));
    const s = h.db.rows('holler_signals')[0];
    const mail = renderDigest({
      businessName: 'Acme Roofing',
      items: [{ kind: s.kind, title: s.title, place: `${s.city}, ${s.state}`, occurredAt: s.occurred_at, sourceUrl: s.url }],
      appUrl: 'https://holler.test/app',
      unsubscribeUrl: 'https://holler.test/u',
    });
    const all = JSON.stringify(mail);
    expect(all).not.toContain(RESIDENT);
    expect(all).not.toContain('404-555-1212');
    expect(all).not.toContain('Sarah');
    expect(mail.subject).toContain('Service request in Atlanta: Roofing');
  });

  it('reply: subject, message, business name and city, close link, report mailto; business text is escaped', () => {
    const mail = renderRequestReply({
      businessName: 'Acme <b>Roofing</b>\r\nBcc: x@y.z',
      businessPlace: 'Atlanta, GA',
      message: 'We can come Tuesday.\n<script>alert(1)</script>\nCall 404-555-0100.',
      tradeLabel: 'Roofing',
      place: 'Atlanta, GA',
      closeUrl: 'https://holler.test/request/close?token=abc',
      reportAddress: 'help@holler.test',
      replyRef: 'req_1-7',
    });
    // Round 3 P2-7: the business name is cleaned for subjects and headings (no tags, no line breaks, no email address or link).
    expect(mail.subject).toBe('Acme b Roofing /b Bcc replied to your request on Holler');
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('Call 404-555-0100.');
    expect(mail.html).toContain('https://holler.test/request/close?token=abc');
    expect(mail.html).toContain('mailto:help@holler.test?subject=Report%20reply%20req_1-7');
    expect(mail.text).toContain('From Acme b Roofing /b Bcc, Atlanta, GA.');
  });

  it('reply without a support address has no report link', () => {
    const mail = renderRequestReply({
      businessName: 'Acme',
      businessPlace: null,
      message: 'We can come Tuesday morning to look at it.',
      tradeLabel: 'Roofing',
      place: 'Atlanta, GA',
      closeUrl: 'https://holler.test/c',
      reportAddress: null,
      replyRef: 'r',
    });
    expect(mail.html).not.toContain('Report this reply');
  });

  it('admin notice and confirm email never take an address and contain no em dash', () => {
    const admin = renderRequestAdmin({
      tradeLabel: 'Roofing',
      place: 'Atlanta, GA',
      zip: '30301',
      description: 'Leak — big one',
      summary: 'Leak',
      publicId: 'req_1',
      removeUrl: 'https://holler.test/request/close?token=r',
    });
    const confirm = renderRequestConfirm({
      confirmUrl: 'https://holler.test/request/confirm?token=c',
      tradeLabel: 'Roofing',
      place: 'Atlanta, GA',
      summary: 'Leak',
      openDays: 14,
      confirmDays: 7,
    });
    for (const m of [admin, confirm]) expect(JSON.stringify(m)).not.toContain('—');
    expect(admin.html).toContain('Remove this request');
    expect(confirm.html).toContain('Confirm my request');
  });
});
