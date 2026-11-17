// Integration round 3: after confirming, the resident gets one "your request is live" email with the close link (otherwise a request
// with no replies leaves the resident without any email that can close it). Sent once, never to anyone else, never blocks the confirm.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeRequest, confirmRequest, createRequest } from '@/lib/requests/service';
import { renderRequestPublished } from '@/lib/email/request-emails';
import { postalFooterHtml, postalFooterText } from '@/lib/legal/email-footer';
import { RESIDENT, VALID, harness, tokenIn } from './helpers';

beforeEach(() => {
  for (const m of ['log', 'error', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('the "your request is live" email', () => {
  it('goes to the resident once, carries a working close link and the filtered text only', async () => {
    const h = harness();
    await createRequest(h.deps, VALID, '203.0.113.9');
    const token = tokenIn(h.sent[0].text, '/request/confirm');
    const r = await confirmRequest(h.deps, token);
    expect(r.state).toBe('confirmed');
    const live = h.sent.filter((m) => m.subject === 'Your request is live on Holler');
    expect(live).toHaveLength(1);
    expect(live[0].to).toBe(RESIDENT);
    expect(live[0].replyTo).toBeUndefined();
    const close = tokenIn(live[0].text, '/request/close');
    expect(r.state === 'confirmed' && r.closeUrl.endsWith(close)).toBe(true);
    expect(live[0].text).not.toContain('404-555-1212');
    expect(live[0].text).not.toContain('Sarah');
    // A second click on the confirm link sends nothing new to the resident.
    await confirmRequest(h.deps, token);
    expect(h.sent.filter((m) => m.subject === 'Your request is live on Holler')).toHaveLength(1);
    // The link in it closes the request.
    expect((await closeRequest(h.deps, close)).state).toBe('closed');
  });

  it('a failed send does not undo the confirm', async () => {
    const h = harness();
    await createRequest(h.deps, VALID, '203.0.113.9');
    const token = tokenIn(h.sent[0].text, '/request/confirm');
    h.setSend((m) => m.subject !== 'Your request is live on Holler');
    expect((await confirmRequest(h.deps, token)).state).toBe('confirmed');
    expect(h.db.rows('holler_requests')[0].status).toBe('open');
  });

  it('ends with the postal footer, escapes values, no em dash', () => {
    const r = renderRequestPublished({ tradeLabel: 'Roofing <b>', place: 'Atlanta, GA', summary: 'Leak — kitchen', closeUrl: 'https://h.test/request/close?token=x', openDays: 14 });
    expect(r.html.endsWith(`${postalFooterHtml()}</div>`)).toBe(true);
    expect(r.text.trimEnd().endsWith(postalFooterText())).toBe(true);
    expect(r.html).not.toContain('<b>');
    expect(r.html + r.text).not.toContain('—');
    expect(r.text).toContain('https://h.test/request/close?token=x');
  });
});
