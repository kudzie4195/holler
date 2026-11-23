import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { WhoToContactLocked } from '@/components/feed/who-to-contact';
import type { ContactInput, ContactRecord } from '@/lib/contacts/types';
import { safeWebsite } from '@/lib/outreach/links';
import { loadMemberContacts, type ContactLoader } from '@/lib/outreach/loader';
import { outreachPlan } from '@/lib/outreach/plan';
import { OUTREACH_REMINDER, renderNote, STORM_REMINDER, NOTE_KINDS } from '@/lib/outreach/templates';

const root = path.resolve(__dirname, '../..');
const place = { city: 'Austin', state: 'TX', county: 'Travis County', zip: '78701' };
const permit = { source: 'socrata-austin-permits', kind: 'permit', ...place };
const site: ContactInput = { role: 'site', name: '', address: '500 Congress Ave', city: 'Austin', state: 'TX', zip: '78701' };
const org = (name: string, extra: Partial<ContactInput> = {}): ContactInput => ({ role: 'contractor', name, ...extra });
const words = (t: string) => t.trim().split(/\s+/).length;

describe('L1-1: static imports, no ts-ignore', () => {
  it('loader.ts has no ts-ignore, no dynamic import and no eslint-disable', () => {
    const src = readFileSync(path.join(root, 'lib/outreach/loader.ts'), 'utf8');
    expect(src).not.toMatch(/@ts-ignore|eslint-disable|await import\(/);
    expect(src).toMatch(/^import \{ contactsForMember[^}]*\} from '@\/lib\/contacts\/load';/m);
    // Round 18: the re-check is per role (contractor trade names, owner companies, strict for the rest).
    expect(src).toMatch(/^import \{ isStoredContactName \} from '@\/lib\/contacts\/names';/m);
  });
  it('the default loader and classifier are used when none is injected', async () => {
    // No injected loader: the real contactsForMember runs and, with a client that fails, returns no contacts (and logs the code only).
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = { from() { throw new Error('x'); } } as never;
    const out = await loadMemberContacts({ db, userId: 'u1', signalIds: [1] });
    expect(out.size).toBe(0);
    expect(err.mock.calls.map((c) => c.join(' '))).toContain('contacts: load failed exception unknown');
    err.mockRestore();
  });
  it('injected loader and orgCheck still work, and no access value is passed to the loader', async () => {
    const rec = (signalId: number, name: string): ContactRecord => ({ signalId, role: 'contractor', name });
    const loader = vi.fn<ContactLoader>(async () => new Map([[1, [rec(1, 'Acme Roofing LLC'), rec(1, 'John Smith')]]]));
    const out = await loadMemberContacts({ db: {} as never, userId: 'u1', signalIds: [1], loader, orgCheck: (n: string) => /llc/i.test(n), access: { userId: 'u1', subscriptionStatus: 'active', trialEndsAt: null } } as never);
    expect(out.get(1)!.map((c) => c.name)).toEqual(['Acme Roofing LLC']);
    expect(loader.mock.calls[0]).toHaveLength(3);
    const loader2 = vi.fn<ContactLoader>(async () => new Map());
    await loadMemberContacts({ db: {} as never, userId: 'u1', signalIds: [1], loader: loader2 });
    expect(loader2.mock.calls[0]).toHaveLength(3);
  });
});

describe('L1-2: backfill removed', () => {
  it('lib/contacts/backfill.ts is gone and LAUNCH.md says contacts cannot be backfilled', () => {
    expect(existsSync(path.join(root, 'lib/contacts/backfill.ts'))).toBe(false);
    expect(readFileSync(path.join(root, 'LAUNCH.md'), 'utf8')).toMatch(/Contacts cannot be backfilled for records already stored: they appear from the first scan after the deploy\./);
  });
});

describe('P2-1: callers pass no access value', () => {
  it('the page and the notify route do not pass a profile-derived access hint', () => {
    for (const f of ['app/app/page.tsx', 'app/api/cron/notify/route.ts', 'lib/outreach/loader.ts', 'lib/contacts/load.ts']) {
      const src = readFileSync(path.join(root, f), 'utf8');
      expect(src, f).not.toMatch(/AccessHint|ContactsOptions|subscriptionStatus|trialEndsAt: (profile|p)\./);
    }
  });
});

describe('L2-2: locked items carry no county or zip', () => {
  it('the locked branch of the page nulls county and zip', () => {
    const page = readFileSync(path.join(root, 'app/app/page.tsx'), 'utf8');
    expect(page).toMatch(/url: null, draft: null, county: null, zip: null/);
  });
});

describe('L5-1: role label and the sub-to-contractor note', () => {
  it('permit entries are labelled "Named on this permit"', () => {
    const p = outreachPlan(permit, [org('XYZ Architects LLC')]);
    expect(p?.type === 'org' && p.entries[0].role).toBe('Named on this permit');
    expect(JSON.stringify(p)).not.toContain('General contractor');
  });
  it('the note says "named on a recent building permit" and never calls the company the contractor', () => {
    const t = renderNote('sub-to-contractor', { org: 'XYZ Architects LLC', address: '500 Congress Ave' });
    expect(t).toContain('named on a recent building permit at 500 Congress Ave');
    expect(t).not.toMatch(/named as the contractor|as the contractor/);
  });
});

describe('F11a, F11b: note truth', () => {
  it('the storm note does not state that storms came through', () => {
    const t = renderNote('door-hanger-storm');
    expect(t).toContain('Severe weather has been forecast or reported for this area.');
    expect(t).not.toMatch(/came through|recently|after the weather/i);
  });
  it('the contractor note uses the job-site address, not the contractor office', () => {
    const p = outreachPlan(permit, [site, org('Lone Star Roofing LLC', { address: '1200 W Ben White Blvd', city: 'Austin', state: 'TX', zip: '78704' })]);
    expect(p?.type).toBe('org');
    if (p?.type !== 'org') return;
    expect(p.entries[0].note).toContain('500 Congress Ave');
    expect(p.entries[0].note).not.toContain('Ben White');
  });
  it('with no site address the note names no address, even when the contractor has one', () => {
    const p = outreachPlan(permit, [org('Lone Star Roofing LLC', { address: '1200 W Ben White Blvd', city: 'Austin', state: 'TX', zip: '78704' })]);
    if (p?.type !== 'org') throw new Error('expected org plan');
    expect(p.entries[0].note).not.toMatch(/Ben White|1200/);
    expect(p.entries[0].note).toContain('named on a recent building permit near me');
  });
});

describe('copy rules for every note', () => {
  for (const kind of NOTE_KINDS) {
    it(`${kind}: 40 to 80 words, no em or en dash, no pressure or damage claim`, () => {
      const t = renderNote(kind, { org: 'Lone Star Roofing LLC', address: '500 Congress Ave' });
      expect(words(t)).toBeGreaterThanOrEqual(40);
      expect(words(t)).toBeLessThanOrEqual(80);
      expect(t).not.toMatch(/[–—]/);
      expect(t.toLowerCase()).not.toMatch(/damage|act now|limited time|urgent|hurry/);
    });
  }
});

describe('F11c: no owner lookup', () => {
  it('the job-site block keeps address, map and the letter to "Property owner", and nothing else about the owner', () => {
    const p = outreachPlan(permit, [site]);
    expect(p?.type).toBe('site');
    if (p?.type !== 'site') return;
    expect(p.address).toBe('500 Congress Ave, Austin, TX 78701');
    expect(p.map?.label).toBe('Open map');
    expect(p.letter?.note).toMatch(/^Dear Property owner\./);
    expect(Object.keys(p).sort()).toEqual(['address', 'heading', 'letter', 'map', 'reminder', 'type']);
    expect(readFileSync(path.join(root, 'lib/outreach/links.ts'), 'utf8')).not.toMatch(/records/i);
    expect(readFileSync(path.join(root, 'lib/outreach/plan.ts'), 'utf8')).not.toMatch(/county records|property records/i);
  });
});

describe('L5-2: locked prompt', () => {
  const html = (source: string, kind: string) => renderToStaticMarkup(createElement(WhoToContactLocked, { item: { source, kind } }));
  it('area and storm classes get the area sentence', () => {
    for (const [s, k] of [['nws', 'alert'], ['spc', 'report'], ['fema', 'disaster'], ['usgs', 'quake'], ['socrata-nyc-311', 'civic'], ['socrata-austin-violations', 'civic']]) {
      const h = html(s, k);
      expect(h, s).toContain('Pick a plan to see how to reach this area.');
      expect(h, s).not.toContain('who this record names');
    }
  });
  it('record classes that can name a contact keep the current text', () => {
    for (const [s, k] of [['socrata-chicago-permits', 'permit'], ['socrata-sf-business', 'civic'], ['socrata-chicago-inspections', 'civic'], ['usaspending', 'contract'], ['sam-gov', 'contract']]) {
      expect(html(s, k), s).toContain('Pick a plan to see who this record names and how to reach them.');
    }
  });
  it('records with no block render nothing', () => {
    expect(html('faa', 'travel')).toBe('');
  });
});

describe('L5-3: the storm-sales reminder shows only on the storm class', () => {
  const reminderOf = (source: string, kind: string, contacts: ContactInput[] = []) => {
    const p = outreachPlan({ source, kind, ...place }, contacts);
    return p?.reminder;
  };
  it('storm records carry the storm clause', () => {
    for (const [s, k] of [['nws', 'alert'], ['spc', 'report'], ['fema', 'disaster']]) expect(reminderOf(s, k)).toBe(STORM_REMINDER);
  });
  it('every other block carries only the Do Not Call line', () => {
    const cases: Array<[string, string, ContactInput[]]> = [
      ['socrata-austin-permits', 'permit', [org('Acme Roofing LLC')]],
      ['socrata-austin-permits', 'permit', [site]],
      ['socrata-sf-business', 'civic', [{ role: 'business', name: 'Cafe Uno LLC' }]],
      ['socrata-chicago-inspections', 'civic', [{ role: 'business', name: 'Cafe Uno LLC' }]],
      ['usaspending', 'contract', [{ role: 'awardee', name: 'Acme Builders LLC' }]],
      ['sam-gov', 'contract', [{ role: 'buyer', name: 'City Procurement' }]],
      ['socrata-nyc-311', 'civic', []],
      ['usgs', 'quake', []],
      ['socrata-austin-permits', 'permit', []], // org class falling back to the area kit
    ];
    for (const [s, k, c] of cases) {
      const r = reminderOf(s, k, c);
      expect(r, `${s} ${c.map((x) => x.role)}`).toBe(OUTREACH_REMINDER);
      expect(r).not.toMatch(/storm/);
    }
  });
});

describe('F14: render-time safeWebsite matches the write-time check', () => {
  it('rejects raw IP hosts, explicit ports and punycode hosts', () => {
    for (const bad of [
      'https://127.0.0.1/admin',
      'http://192.168.1.10',
      '10.0.0.1',
      'https://2130706433/',
      'https://example.com:8443/',
      'http://example.com:8080',
      'example.com:3000',
      'https://xn--80ak6aa92e.com/',
      'https://www.xn--e1afmkfd.xn--p1ai/',
      'xn--bcher-kva.example',
      'https://[::1]/',
    ]) expect(safeWebsite(bad), bad).toBeNull();
  });
  it('still accepts ordinary hosts, including the default port', () => {
    expect(safeWebsite('acmeroofing.com')).toBe('https://acmeroofing.com/');
    expect(safeWebsite('https://acmeroofing.com:443/x')).toBe('https://acmeroofing.com/x');
    expect(safeWebsite('http://www.acme-roofing.co.uk/about')).toBe('https://www.acme-roofing.co.uk/about');
    expect(safeWebsite('https://exa-mple1.com')).toBe('https://exa-mple1.com/');
  });
});
