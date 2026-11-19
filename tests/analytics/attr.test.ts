import { describe, expect, it } from 'vitest';
import {
  attributionFromSearch,
  cleanPath,
  cleanToken,
  encodeSid,
  encodeSrc,
  isSessionId,
  looksAutomated,
  newSessionId,
  parseSid,
  parseSrc,
  privacyHeaderOn,
  privacySignalOn,
  readCookie,
} from '@/lib/analytics/attr';

const ALLOWED = /^[a-z0-9_-]{1,40}$/;

describe('cleanToken', () => {
  it('lowercases and keeps letters, digits, dash and underscore', () => {
    expect(cleanToken('Spring_Sale-2026')).toBe('spring_sale-2026');
  });
  it('turns spaces and punctuation into one dash', () => {
    expect(cleanToken('Spring Sale!!  Now')).toBe('spring-sale-now');
  });
  it('survives hostile values and always lands in the allowed set or null', () => {
    const hostile = [
      '<script>alert(1)</script>',
      "'; drop table holler_events; --",
      '../../etc/passwd',
      'a\r\nSet-Cookie: x=1',
      'a;b=c',
      '%00%0d%0a',
      '{{7*7}}',
      '${jndi:ldap://x}',
      'javascript:alert(1)',
      '\u0000\u0001',
      'x'.repeat(5000),
      '😀😀😀',
      '１２３',
      'İSTANBUL',
    ];
    for (const h of hostile) {
      const out = cleanToken(h);
      expect(out === null || ALLOWED.test(out), `${JSON.stringify(h).slice(0, 40)} -> ${out}`).toBe(true);
    }
    expect(cleanToken('<script>alert(1)</script>')).toBe('script-alert-1-script');
    expect(cleanToken('a\r\nSet-Cookie: x=1')).toBe('a-set-cookie-x-1');
  });
  it('cuts over-length values to 40 characters with no trailing dash', () => {
    const out = cleanToken('a'.repeat(39) + '-' + 'b'.repeat(30))!;
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('-')).toBe(false);
    expect(cleanToken('x'.repeat(100))).toBe('x'.repeat(40));
  });
  it('folds accents and drops other scripts', () => {
    expect(cleanToken('Café Été')).toBe('cafe-ete');
    expect(cleanToken('夏のセール')).toBeNull();
    expect(cleanToken('Straße')).toBe('stra-e'); // unmapped letters become a dash, never a stray character
  });
  it('returns null for empty, non-strings and all-junk', () => {
    for (const v of ['', '   ', '---', '___', null, undefined, 5, {}, ['a']]) expect(cleanToken(v)).toBeNull();
  });
});

describe('attributionFromSearch', () => {
  it('reads utm_source, medium and campaign, cleaned', () => {
    expect(attributionFromSearch('?utm_source=Facebook&utm_medium=Paid Social&utm_campaign=Roofers_Q4')).toEqual({
      source: 'facebook',
      medium: 'paid-social',
      campaign: 'roofers_q4',
    });
  });
  it('keeps a source with no medium or campaign', () => {
    expect(attributionFromSearch('?utm_source=newsletter')).toEqual({ source: 'newsletter', medium: null, campaign: null });
  });
  it('maps the five ref shortcuts', () => {
    expect(attributionFromSearch('?ref=ig')).toEqual({ source: 'instagram', medium: 'social', campaign: null });
    expect(attributionFromSearch('?ref=x')?.source).toBe('x');
    expect(attributionFromSearch('?ref=tt')?.source).toBe('tiktok');
    expect(attributionFromSearch('?ref=appstore')).toEqual({ source: 'appstore', medium: 'store', campaign: null });
    expect(attributionFromSearch('?ref=play')).toEqual({ source: 'play', medium: 'store', campaign: null });
    expect(attributionFromSearch('?ref=IG')?.source).toBe('instagram');
  });
  it('ignores unknown refs, empty utm_source and prototype keys', () => {
    for (const q of ['?ref=evil', '?ref=', '?ref=__proto__', '?ref=constructor', '?utm_source=', '?utm_source=%E5%A4%8F', '', '?utm_medium=cpc', '?a=b']) {
      expect(attributionFromSearch(q), q).toBeNull();
    }
  });
  it('utm_source wins over ref', () => {
    expect(attributionFromSearch('?ref=ig&utm_source=mailer')?.source).toBe('mailer');
  });
  it('does not choke on a huge query string', () => {
    expect(attributionFromSearch('?utm_source=a' + '&x=1'.repeat(10000))?.source).toBe('a');
  });
});

describe('cookie values', () => {
  it('round trips holler_src', () => {
    const a = { source: 'instagram', medium: 'social', campaign: null };
    expect(encodeSrc(a)).toBe('instagram.social.');
    expect(parseSrc(encodeSrc(a))).toEqual(a);
    expect(parseSrc('a..')).toEqual({ source: 'a', medium: null, campaign: null });
  });
  it('rejects tampered holler_src values', () => {
    for (const v of ['', '..', 'a', 'a.b', 'a.b.c.d', 'A.b.c', 'a.<b>.c', 'a.b.' + 'c'.repeat(41), 'x'.repeat(200), ' a.b.c']) {
      expect(parseSrc(v), v).toBeNull();
    }
    expect(parseSrc(null)).toBeNull();
  });
  it('round trips holler_sid and rejects bad ones', () => {
    const sid = newSessionId(Uint8Array.from({ length: 16 }, (_, i) => 250 - i));
    expect(sid).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(isSessionId(sid)).toBe(true);
    expect(parseSid(encodeSid({ sid, day: 20411 }))).toEqual({ sid, day: 20411 });
    expect(parseSid(sid)).toEqual({ sid, day: 0 });
    for (const v of ['', 'short', sid + '.x', sid + '.1.2', sid + '!', 'a'.repeat(41), `${sid}.${'9'.repeat(9)}`]) expect(parseSid(v), v).toBeNull();
  });
  it('readCookie finds one cookie by exact name', () => {
    expect(readCookie('a=1; holler_src=x.y.z; b=2', 'holler_src')).toBe('x.y.z');
    expect(readCookie('xholler_src=1', 'holler_src')).toBeNull();
    expect(readCookie(null, 'a')).toBeNull();
  });
});

describe('privacy signals', () => {
  it('GPC, DNT in any spelling, and the old IE and window forms turn tracking off', () => {
    expect(privacySignalOn({ globalPrivacyControl: true })).toBe(true);
    expect(privacySignalOn({ doNotTrack: '1' })).toBe(true);
    expect(privacySignalOn({ doNotTrack: 'yes' })).toBe(true);
    expect(privacySignalOn({ msDoNotTrack: '1' })).toBe(true);
    expect(privacySignalOn({}, { doNotTrack: '1' })).toBe(true);
  });
  it('off or unset leaves tracking on', () => {
    expect(privacySignalOn({ globalPrivacyControl: false, doNotTrack: '0' })).toBe(false);
    expect(privacySignalOn({ doNotTrack: 'unspecified' })).toBe(false);
    expect(privacySignalOn({})).toBe(false);
    expect(privacySignalOn(null)).toBe(false);
  });
  it('reads the request headers', () => {
    expect(privacyHeaderOn((n) => ({ 'sec-gpc': '1' })[n] ?? null)).toBe(true);
    expect(privacyHeaderOn((n) => ({ dnt: '1' })[n] ?? null)).toBe(true);
    expect(privacyHeaderOn((n) => ({ dnt: '0' })[n] ?? null)).toBe(false);
    expect(privacyHeaderOn(() => null)).toBe(false);
  });
});

describe('cleanPath and automation', () => {
  it('accepts paths and rejects query strings, fragments and long values', () => {
    expect(cleanPath('/local/austin-tx')).toBe('/local/austin-tx');
    expect(cleanPath('/')).toBe('/');
    for (const v of ['/check?zip=30301', '/a#b', 'check', '', '/a b', '/%41', '/' + 'a'.repeat(80), null, 5]) expect(cleanPath(v), String(v)).toBeNull();
    expect(cleanPath('/' + 'a'.repeat(79))).not.toBeNull();
  });
  it('flags obvious automation and accepts real browsers', () => {
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    expect(looksAutomated(chrome)).toBe(false);
    expect(looksAutomated(chrome.replace('Chrome', 'HeadlessChrome'))).toBe(true);
    expect(looksAutomated('Googlebot/2.1 (+http://www.google.com/bot.html)')).toBe(true);
    expect(looksAutomated('curl/8.0.1')).toBe(true);
    expect(looksAutomated('python-requests/2.31')).toBe(true);
    expect(looksAutomated('')).toBe(true);
    expect(looksAutomated(null)).toBe(true);
    expect(looksAutomated(chrome, '"HeadlessChrome";v="130"')).toBe(true);
    expect(looksAutomated(chrome, '"Chromium";v="130"')).toBe(false);
  });
});
