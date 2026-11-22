// Round 18 integration, Part B item 5: checks that span the merged units (trial, names, lookup, routes, lists).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ usePathname: () => '/app' }));

import type { ContactRecord } from '@/lib/contacts/types';
import { isOrganisationName } from '@/lib/contacts/org';
import { isStoredContactName } from '@/lib/contacts/names';
import { lookupBusiness, lookupForCards, lookupInputFor, lookupSettings, mayLookUp, newBudget, parseStreet, sameStreet } from '@/lib/enrich/business-lookup';
import { contactPathOf, textShowsPlace } from '@/lib/signals/alert-gate';
import { buildingAddress } from '@/lib/lists/core';
import { buildingStreetFromPart } from '@/lib/signals/site-address';
import { AppNavLinks, appNavLabel } from '@/components/app-nav';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';
import { TRIAL_DAYS } from '@/lib/auth/membership';
import { TRIAL_HEADLINE, TRIAL_PHRASE } from '@/lib/plan/price-copy';
import { ENV, NOW, fakeFetch, item, newDb } from '../enrich/helpers';

describe('the phone lookup only sees names the business-name rules accept', () => {
  // Accepted by the strict classifier (org.ts) but refused by the round 18 names unit for the role: the lookup must refuse them too.
  const contractorRefused = ['Saoirse Tile', 'Evergreen Tree Care', 'Clear View Windows'];
  const licenceRefused = ['Lopez Daycare', 'Maria Lopez Home Daycare', 'Gareth Barber', 'Saoirse Kitchen'];

  it('the test names really are accepted by the strict rule and refused by the role rule', () => {
    for (const n of contractorRefused) {
      expect(isStoredContactName('contractor', n), n).toBe(false);
    }
    for (const n of licenceRefused) expect(isStoredContactName('business', n), n).toBe(false);
    expect(contractorRefused.filter((n) => isOrganisationName(n)).length).toBeGreaterThan(0);
  });

  it('mayLookUp and lookupBusiness refuse them; an owner row is never looked up; an accepted name still is', async () => {
    for (const name of contractorRefused) expect(mayLookUp({ role: 'contractor', name, phone: null, website: null }), name).toBe(false);
    for (const name of licenceRefused) expect(mayLookUp({ role: 'business', name, phone: null, website: null }), name).toBe(false);
    expect(mayLookUp({ role: 'owner' as never, name: 'ATLANTA HOUSING AUTHORITY', phone: null, website: null })).toBe(false);
    const owner = { signalId: 1, role: 'owner', name: 'ATLANTA HOUSING AUTHORITY', city: 'Atlanta', state: 'GA', zip: '30303' } as unknown as ContactRecord;
    expect(lookupInputFor(owner, [owner], { city: 'Atlanta', state: 'GA' })).toBeNull();
    expect(mayLookUp({ role: 'contractor', name: 'Peachtree Roofing LLC', phone: null, website: null })).toBe(true);
    const out = await lookupBusiness({ name: 'Saoirse Tile', city: 'Atlanta', state: 'GA', role: 'contractor' }, { db: newDb() as never, fetch: fakeFetch([item({ title: 'Saoirse Tile' })]) as never, env: ENV, now: () => NOW });
    expect(out).toMatchObject({ status: 'skipped', reason: 'not_business' });
  });

  it('through the alert run: no request and no cache row for a refused name; one request for an accepted one', async () => {
    const fetch = fakeFetch([item({ title: 'Saoirse Tile' })]);
    const c: ContactRecord = { signalId: 1, role: 'contractor', name: 'Saoirse Tile', city: null, state: null };
    const db = newDb();
    await lookupForCards(new Map([[1, [c]]]), [{ signalId: 1, city: 'Atlanta', state: 'GA', contact: c }], newBudget(lookupSettings(ENV)), { db: db as never, fetch: fetch as never, env: ENV, now: () => NOW, sleep: async () => {} });
    expect(fetch).not.toHaveBeenCalled();
    expect(db.tables.holler_business_lookup).toEqual([]);
    const ok: ContactRecord = { signalId: 2, role: 'contractor', name: 'Peachtree Roofing LLC', city: null, state: null };
    const fetch2 = fakeFetch([item({})]);
    await lookupForCards(new Map([[2, [ok]]]), [{ signalId: 2, city: 'Atlanta', state: 'GA', contact: ok }], newBudget(lookupSettings(ENV)), { db: newDb() as never, fetch: fetch2 as never, env: ENV, now: () => NOW, sleep: async () => {} });
    expect(fetch2).toHaveBeenCalledTimes(1);
  });
});

describe('the contact gate, the lookup and the lists agree on what a site address is', () => {
  // [text, a building address everyone accepts?]
  const BUILDINGS = ['123 Main St', '1584 ABNER NW', '3080 NEW HOPE SW', '12 OAK ST APT 204', '200 W Addison St Ste 3', '123A Main St', '1800 BATH AVENUE'];
  const NOT_SITES = ['0 Peachtree St', '00 Main St', 'MAIN ST', 'PO Box 12', 'Lot 2 Sample Ct'];

  it('a numbered street is a site for all three (gate: a place; lists: a building line; lookup: a street it can match)', () => {
    for (const a of BUILDINGS) {
      expect(textShowsPlace(a), `gate ${a}`).toBe(true);
      expect(contactPathOf([{ role: 'site', address: a }], null), `gate path ${a}`).toBe('site');
      expect(buildingAddress(a), `lists ${a}`).not.toBeNull();
      expect(parseStreet(a), `lookup ${a}`).not.toBeNull();
    }
    // the unit is cut the same way: the list line and the lookup match the building, not the unit
    expect(buildingAddress('12 OAK ST APT 204')).toBe('12 OAK ST');
    expect(sameStreet('12 OAK ST APT 204', '12 Oak Street')).toBe(true);
  });

  it('house number 0, a bare street, a PO box or a lot is a site for none of them', () => {
    for (const a of NOT_SITES) {
      expect(textShowsPlace(a), `gate ${a}`).toBe(false);
      expect(buildingAddress(a), `lists ${a}`).toBeNull();
      expect(parseStreet(a), `lookup ${a}`).toBeNull();
    }
  });

  it('a hundred-block is a place to go for the gate (ROUTES review 2, decision 3) but never a building on a list or a lookup address', () => {
    for (const a of ['1200 block of Main St', '1200 BLOCK OF MAIN ST']) {
      expect(textShowsPlace(a), a).toBe(true);
      expect(buildingAddress(a), a).toBeNull();
      expect(parseStreet(a), a).toBeNull();
    }
  });

  it('on the 148 real stored permit rows: every listed building is a gate site and a lookup street; the gate-only rows are pinned', () => {
    const rows = JSON.parse(readFileSync('tests/signals/__data__/review-f-sample-156.json', 'utf8')) as unknown[][];
    let gate = 0;
    let listed = 0;
    const gateOnly: string[] = [];
    for (const r of rows) {
      const summary = r[3] as string | null;
      if (!summary || !/permits$/.test(String(r[1]))) continue;
      const g = summary.split(' | ').some((p) => textShowsPlace(p));
      const l = buildingAddress(summary);
      if (g) gate++;
      if (l) {
        listed++;
        expect(g, summary).toBe(true);
        expect(parseStreet(l), l).not.toBeNull();
      } else if (g) gateOnly.push(summary.split(' | ').find((p) => textShowsPlace(p)) as string);
    }
    expect({ gate, listed }).toEqual({ gate: 148, listed: 137 }); // lists had 126 before the shared street rule
    // Not listed on purpose: no street type or quadrant at the end (a word after the street could be a name), a number range, a borough.
    expect(gateOnly.sort()).toEqual(
      ['1 PAYCOR STADIUM', '12 MIDDLESEX', '1755 THE EXCHANGE', '176 EDWARD', '1790 BROADWAY Manhattan', '20 ARGYLE', '210 BOWERY Manhattan', '2211 S IH 35 SVRD NB', '29 TROUPE', '7300-7319 ALONDRA LN', '814 ABBOTT'].sort(),
    );
  });

  it('the shared strict street rule (lists fallback)', () => {
    expect(buildingStreetFromPart('6344 TILLEY WY MATTHEWS NC 28105')).toBe('6344 TILLEY WY');
    expect(buildingStreetFromPart('346 HENRY AARON SW, ATLANTA, GA 30310')).toBe('346 HENRY AARON SW');
    expect(buildingStreetFromPart('10416 E INDEPENDENCE BV 650 MATTHEWS NC 28105')).toBe('10416 E INDEPENDENCE BV');
    expect(buildingStreetFromPart('14 Story St, Cambridge, MA 02138')).toBe('14 Story St');
    for (const bad of ['0 MAIN ST', '1200 block of Main St', '30 DAYS ST', '123 MAIN ST JOHN SMITH', '176 EDWARD', '1790 BROADWAY Manhattan', '2 Way Radio Install', '4 SOUTH WINDOWS'])
      expect(buildingStreetFromPart(bad), bad).toBeNull();
  });
});

describe('the "Lists" header link', () => {
  it('comes from lib/i18n in English and Spanish', () => {
    expect(en['app.nav.lists']).toBe('Lists');
    expect(es['app.nav.lists']).toBe('Listas');
    expect(appNavLabel('/app/lists', 'en')).toBe('Lists');
    expect(appNavLabel('/app/lists', 'es')).toBe('Listas');
  });

  it('is hidden below 375 px and shown from 375 px; Matches and Settings show at every width', () => {
    const html = renderToStaticMarkup(createElement(AppNavLinks as (p: { lang?: 'en' | 'es' }) => ReturnType<typeof AppNavLinks>, { lang: 'es' }));
    const tags = [...html.matchAll(/<a\b[^>]*>[^<]*<\/a>/g)].map((m) => m[0]);
    const tagFor = (href: string) => tags.find((x) => x.includes(`href="${href}"`));
    expect(tagFor('/app/lists')).toMatch(/>Listas<\/a>$/);
    expect(tagFor('/app/lists')).toMatch(/class="hidden min-\[375px\]:inline-flex /);
    for (const href of ['/app', '/app/settings']) expect(tagFor(href), href).toMatch(/class="inline-flex /);
    expect(renderToStaticMarkup(createElement(AppNavLinks))).toContain('>Lists</a>');
  });
});

describe('the trial length is read from the constants everywhere', () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
    });
  }
  it('the constants say 60 days', () => {
    expect(TRIAL_DAYS).toBe(60);
    expect(TRIAL_PHRASE).toBe('60-day free trial');
    expect(TRIAL_HEADLINE).toBe('2 months free');
  });
  it('no source file (any unit) types a trial length in a string; the dictionaries use {days} and {months}', () => {
    const TYPED = /['"`][^'"`\n]*(?:\b\d+[- ]day free trial|\b\d+ days free|\bfree for \d+ days|\b\d+ months free|\bprueba gratis de \d+|\b\d+ (?:días|meses) gratis|\b\d+[- ]day trial)[^'"`\n]*['"`]/i;
    const bad: string[] = [];
    for (const f of [...files('app'), ...files('lib'), ...files('components')]) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
          if (TYPED.test(line)) bad.push(`${f}:${i + 1}`);
        });
    }
    expect(bad).toEqual([]);
  });
});
