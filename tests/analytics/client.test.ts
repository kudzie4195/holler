import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAnalytics } from '@/lib/analytics/client';
import { parseSid, parseSrc, readCookie, utcDay } from '@/lib/analytics/attr';
import { fakeBrowser } from './helpers';

// Blob text in Node: capture the body by wrapping Blob so the fake beacon can read it synchronously.
const RealBlob = globalThis.Blob;
afterEach(() => {
  globalThis.Blob = RealBlob;
});
function captureBlobs() {
  class B extends RealBlob {
    __t: string;
    constructor(parts: BlobPart[], o?: BlobPropertyBag) {
      super(parts, o);
      this.__t = parts.join('');
    }
  }
  globalThis.Blob = B as unknown as typeof Blob;
}

const DAY = Date.UTC(2026, 10, 19, 12);

describe('first touch', () => {
  it('sets holler_src from utm_source with the cookie attributes', () => {
    const b = fakeBrowser({ search: '?utm_source=Instagram&utm_medium=social&utm_campaign=Fall%20Storm' });
    runAnalytics(b.env);
    const raw = b.writes.find((w) => w.startsWith('holler_src='))!;
    expect(raw).toBe('holler_src=instagram.social.fall-storm; Max-Age=2592000; Path=/; SameSite=Lax; Secure');
    expect(parseSrc(readCookie(b.env.getCookie(), 'holler_src'))).toEqual({ source: 'instagram', medium: 'social', campaign: 'fall-storm' });
  });
  it('sets it from a ref shortcut', () => {
    const b = fakeBrowser({ search: '?ref=tt' });
    runAnalytics(b.env);
    expect(readCookie(b.env.getCookie(), 'holler_src')).toBe('tiktok.social.');
  });
  it('first touch wins: a later campaign never overwrites it', () => {
    const b = fakeBrowser({ jar: { holler_src: 'x.social.' }, search: '?utm_source=google&utm_medium=cpc' });
    runAnalytics(b.env);
    expect(readCookie(b.env.getCookie(), 'holler_src')).toBe('x.social.');
    expect(b.writes.some((w) => w.startsWith('holler_src='))).toBe(false);
  });
  it('a damaged cookie does not block a fresh capture', () => {
    const b = fakeBrowser({ jar: { holler_src: '<bad>' }, search: '?ref=ig' });
    runAnalytics(b.env);
    expect(readCookie(b.env.getCookie(), 'holler_src')).toBe('instagram.social.');
  });
  it('sets nothing without a campaign in the URL', () => {
    const b = fakeBrowser({ search: '?zip=30301' });
    runAnalytics(b.env);
    expect(b.writes.some((w) => w.startsWith('holler_src='))).toBe(false);
  });
  it('the Secure flag follows the page protocol', () => {
    const b = fakeBrowser({ search: '?ref=ig', secure: false });
    runAnalytics(b.env);
    expect(b.writes.find((w) => w.startsWith('holler_src='))).not.toMatch(/Secure/);
  });
});

describe('visit beacon', () => {
  it('sends one visit with a new session id, only name and path in the body', () => {
    captureBlobs();
    const b = fakeBrowser({ pathname: '/local/austin-tx', search: '?utm_source=a' });
    expect(runAnalytics(b.env)).toBe('counted');
    expect(b.beacons).toHaveLength(1);
    expect(b.beacons[0].url).toBe('/api/e');
    expect(JSON.parse(b.beacons[0].body)).toEqual({ name: 'visit', path: '/local/austin-tx' });
    const sid = parseSid(readCookie(b.env.getCookie(), 'holler_sid'))!;
    expect(sid.sid).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(sid.day).toBe(utcDay(DAY));
    expect(b.writes.find((w) => w.startsWith('holler_sid='))).toMatch(/Max-Age=2592000; Path=\/; SameSite=Lax; Secure$/);
  });
  it('the session cookie is written before the beacon goes out', () => {
    captureBlobs();
    const order: string[] = [];
    const b = fakeBrowser();
    const set = b.env.setCookie;
    b.env.setCookie = (v) => (order.push('cookie'), set(v));
    const send = b.env.navigator.sendBeacon!;
    b.env.navigator.sendBeacon = (u, d) => (order.push('beacon'), send(u, d));
    runAnalytics(b.env);
    expect(order).toEqual(['cookie', 'beacon']);
  });
  it('once per session per day: a second load the same day sends nothing', () => {
    const b = fakeBrowser();
    expect(runAnalytics(b.env)).toBe('counted');
    expect(runAnalytics(b.env)).toBe('already');
    expect(b.beacons).toHaveLength(1);
  });
  it('the next day counts again and keeps the same session id', () => {
    let t = DAY;
    const b = fakeBrowser({ now: () => t });
    runAnalytics(b.env);
    const sid1 = parseSid(readCookie(b.env.getCookie(), 'holler_sid'))!.sid;
    t += 86_400_000;
    expect(runAnalytics(b.env)).toBe('counted');
    expect(parseSid(readCookie(b.env.getCookie(), 'holler_sid'))!.sid).toBe(sid1);
    expect(b.beacons).toHaveLength(2);
  });
  it('falls back to fetch keepalive when sendBeacon is missing or refuses', () => {
    captureBlobs();
    const b = fakeBrowser({ navigator: { sendBeacon: () => false } });
    runAnalytics(b.env);
    expect(b.fetches).toHaveLength(1);
    expect(b.fetches[0].url).toBe('/api/e');
    expect(b.fetches[0].init.keepalive).toBe(true);
    expect(b.fetches[0].init.method).toBe('POST');
    expect(JSON.parse(String(b.fetches[0].init.body))).toEqual({ name: 'visit', path: '/' });
    const c = fakeBrowser();
    delete (c.env.navigator as { sendBeacon?: unknown }).sendBeacon;
    runAnalytics(c.env);
    expect(c.fetches).toHaveLength(1);
  });
  it('a browser that refuses cookies counts nothing', () => {
    const b = fakeBrowser({ refuseCookies: true });
    expect(runAnalytics(b.env)).toBe('no-cookies');
    expect(b.beacons).toHaveLength(0);
    expect(b.fetches).toHaveLength(0);
  });
  it('a throwing sendBeacon never throws out of the tracker', () => {
    const b = fakeBrowser({ navigator: { sendBeacon: () => { throw new Error('boom'); } } });
    expect(() => runAnalytics(b.env)).not.toThrow();
  });
  it('the app sends app_open instead of visit', () => {
    captureBlobs();
    const b = fakeBrowser({ native: true });
    runAnalytics(b.env);
    expect(JSON.parse(b.beacons[0].body).name).toBe('app_open');
  });
  it('an unusual path is sent as /', () => {
    captureBlobs();
    const b = fakeBrowser({ pathname: '/a b/%20' });
    runAnalytics(b.env);
    expect(JSON.parse(b.beacons[0].body).path).toBe('/');
  });
});

describe('Global Privacy Control and Do Not Track', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['GPC', { globalPrivacyControl: true }],
    ['DNT 1', { doNotTrack: '1' }],
    ['DNT yes', { doNotTrack: 'yes' }],
    ['msDNT', { msDoNotTrack: '1' }],
  ];
  for (const [label, nav] of cases) {
    it(`${label}: no cookie, no beacon, no fetch, even with a campaign in the URL`, () => {
      const b = fakeBrowser({ navigator: nav, search: '?utm_source=ig&ref=ig' });
      expect(runAnalytics(b.env)).toBe('off');
      expect(b.writes).toEqual([]);
      expect(b.beacons).toHaveLength(0);
      expect(b.fetches).toHaveLength(0);
      expect(b.env.getCookie()).toBe('');
    });
  }
  it('window.doNotTrack counts too', () => {
    const b = fakeBrowser({ win: { doNotTrack: '1' }, search: '?ref=ig' });
    expect(runAnalytics(b.env)).toBe('off');
    expect(b.writes).toEqual([]);
  });
  it('turning the signal on later removes the two cookies it set before', () => {
    const b = fakeBrowser({ jar: { holler_src: 'x.social.', holler_sid: 'a'.repeat(22) + '.1', other: 'keep' }, navigator: { globalPrivacyControl: true } });
    runAnalytics(b.env);
    expect(b.jar).toEqual({ other: 'keep' });
    expect(b.beacons).toHaveLength(0);
  });
  it('an automated browser (navigator.webdriver) sends nothing', () => {
    const b = fakeBrowser({ navigator: { webdriver: true } });
    expect(runAnalytics(b.env)).toBe('off');
    expect(b.writes).toEqual([]);
  });
});

vi.restoreAllMocks();
