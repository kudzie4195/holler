/**
 * Round 20 (LIC, lever 1): the reviewed known-company list (lib/contacts/known-companies.ts). Exact name forms only: a listed builder is
 * accepted even where the shape rule reads a surname as a person; a string that only shares a word with a listed name gets nothing.
 */
import { describe, expect, it } from 'vitest';
import { KNOWN_COMPANIES, companyKey, knownCompanyName, knownCompanyOf, knownFormHasLegalEnd } from '@/lib/contacts/known-companies';
import { contactNameFor, isStoredContactName } from '@/lib/contacts/names';
import { looksLikeFullPersonName } from '@/lib/contacts/org';
import { hasLegalSuffix } from '@/lib/contacts/trade-name';

const ALL_FORMS = KNOWN_COMPANIES.flatMap((c) => c.forms);
const FIRM_WORD = /\b(?:homes?|brothers|bros|group|construction|contracting|communities|builders|building|company|co|industries|residential|enterprises|partners|services|rooter|custom|companies)\b/i;

describe('the list itself (K1 to K4)', () => {
  it('every entry has a source line, a tag and at least one form', () => {
    expect(KNOWN_COMPANIES.length).toBeGreaterThanOrEqual(50);
    for (const c of KNOWN_COMPANIES) {
      expect(c.source.length, c.name).toBeGreaterThan(10);
      expect(['[O]', '[3P]', '[S]'], c.name).toContain(c.tag);
      expect(c.forms.length, c.name).toBeGreaterThan(0);
    }
  });

  it('every form normalises, and each key belongs to one company only (K3)', () => {
    const owner = new Map<string, string>();
    for (const c of KNOWN_COMPANIES) for (const f of c.forms) {
      const k = companyKey(f);
      expect(k, f).not.toBeNull();
      if (owner.has(k as string)) expect(owner.get(k as string), f).toBe(c.name);
      owner.set(k as string, c.name);
    }
  });

  it('no form reads like a private person on its own (K2): a person-shaped form carries a legal form or a firm word', () => {
    // One coined word ("PulteGroup") is not a full name; every form of two or more words is checked.
    const bad = ALL_FORMS.filter((f) => f.trim().split(/\s+/).length >= 2 && looksLikeFullPersonName(f) && !(hasLegalSuffix(f) || FIRM_WORD.test(f)));
    expect(bad).toEqual([]);
    for (const bare of ['Taylor Morrison', 'D.R. Horton', 'DR Horton', 'Dr. Horton', 'D R Horton', 'Ashton Woods', 'Stanley Martin', 'Hensel Phelps', 'Lennar', 'Toll', 'Horton'])
      expect(knownCompanyOf(bare), bare).toBeNull();
  });
});

describe('exact match only', () => {
  it('each form passes the contractor rule unchanged; in the licence role only a form ending with a legal form does (review P2-6)', () => {
    let legal = 0;
    for (const f of ALL_FORMS) {
      const want = f.replace(/\s+/g, ' ').trim();
      expect(contactNameFor('contractor', f), f).toBe(want);
      expect(isStoredContactName('contractor', want), f).toBe(true);
      expect(knownCompanyName(knownCompanyName(f)), f).toBe(knownCompanyName(f));
      if (knownFormHasLegalEnd(f)) {
        legal += 1;
        expect(contactNameFor('business', f, { ownerNames: ['ACME HOLDINGS LLC'] }), f).toBe(want);
        expect(isStoredContactName('business', want), f).toBe(true);
      }
    }
    expect(legal).toBeGreaterThan(40);
  });

  it('licence role (review P2-6): the reviewer\'s ten names are refused unless the name carries a legal form', () => {
    const TEN = ['Turner Construction', 'Holder Construction', 'Perry Homes', 'Stanley Martin Homes', 'David Weekley Homes', 'Highland Homes', 'Walsh Group', "Harkin's Builders", 'Dr. Horton Inc', 'Taylor Morrison Inc'];
    // Base (round 19): 0 of 10. Round 20 first commit: 10 of 10. Now: only "Taylor Morrison Inc" (a listed name with a legal form).
    expect(TEN.filter((n) => contactNameFor('business', n) !== null)).toEqual(['Taylor Morrison Inc']);
    expect(TEN.filter((n) => contactNameFor('business', n, { ownerNames: ['SOMEONE ELSE LLC'] }) !== null)).toEqual(['Taylor Morrison Inc']);
    for (const f of ['Lennar Homes', 'Toll Brothers', 'KB Home', 'PulteGroup', 'Meritage Homes', 'Lennar Homes of Texas']) expect(knownFormHasLegalEnd(f), f).toBe(false);
    for (const f of ['Toll Brothers Inc', 'Lennar Homes LLC', 'D.R. Horton - Texas, Ltd.', 'Continental Homes of Texas, L.P.', 'Gilbane Building Co']) expect(knownFormHasLegalEnd(f), f).toBe(true);
  });

  it('possessives, an honorific with a period and stray edge punctuation (review P3-9, P3-10)', () => {
    for (const v of ["Harkin's Builders", "Dree's Homes", "Toll Brother's Inc", 'Toll Brother\u2019s Inc', 'Dr. Horton Inc', 'Dr. Horton, Inc.', 'DR HORTON INC', 'DR Horton Texas Ltd', 'D R Horton South', 'D.R. Horton - South', 'Mr. Toll Brothers'])
      expect(knownCompanyOf(v), v).toBeNull();
    expect(contactNameFor('contractor', 'Dr. Horton Inc')).toBeNull();
    // The list never matches a possessive; the contractor rule's own answer for "Harkin's Builders" is the round 18 one (it is not a listed
    // given name), unchanged by this unit, and the licence rule refuses it.
    expect(contactNameFor('business', "Harkin's Builders")).toBeNull();
    expect(knownCompanyName('- Lennar Corp')).toBe('Lennar Corp');
    expect(knownCompanyName('D R Horton Inc,')).toBe('D R Horton Inc');
    expect(knownCompanyName('Lennar/Corp')).toBe('Lennar/Corp');
  });

  it('punctuation, case and spacing variants of a form match ("D R HORTON INC", "toll  brothers, inc.")', () => {
    for (const v of ['D R HORTON INC', 'd.r. horton, inc.', 'toll  brothers, inc.', 'LENNAR HOMES OF TEXAS', 'Brasfield and Gorrie LLC', 'WHITING TURNER CONTRACTING CO'])
      expect(knownCompanyOf(v), v).not.toBeNull();
  });

  it('a string that only shares a word with a listed name is never accepted by the list', () => {
    const sharing = [
      'John Horton', 'Mary Lennar', 'Toll Smith', 'Maria Meritage', 'Taylor Morrison', 'Taylor Morrison Smith', 'Dr. Horton', 'DR HORTON',
      'D.R. Horton', 'David Weekley', 'Kevin Perry Homes', 'Perry Homes John Smith', 'Lennar Homes - John Smith', 'John Smith of Lennar Homes Inc',
      'Toll Brothers c/o Mary Toll', 'Ashton Woods', 'Stanley Martin', 'Hensel Phelps', 'KB', 'Pulte', 'Turner', 'Shea', 'Mary Shea Homes',
      'Lennar Homes\u200B', 'Lennar Homes 2', 'Toll Brothers Owner', 'Homeowner Toll Brothers',
    ];
    for (const s of sharing) expect(knownCompanyOf(s), s).toBeNull();
    // And through the full rules: none of these person shapes is named.
    for (const s of ['John Horton', 'Mary Lennar', 'Toll Smith', 'Taylor Morrison', 'Dr. Horton', 'D.R. Horton', 'David Weekley', 'Ashton Woods', 'Stanley Martin', 'Hensel Phelps', 'Toll Brothers c/o Mary Toll', 'Toll Brothers Owner'])
      expect(contactNameFor('contractor', s), s).toBeNull();
  });

  it('licence rule: the owner check still holds for a listed name ("Toll Brothers Inc" owned by the person "Mary Toll" gives nothing)', () => {
    expect(contactNameFor('business', 'Toll Brothers Inc', { ownerNames: ['MARY TOLL'] })).toBeNull();
    expect(contactNameFor('business', 'Toll Brothers Inc', { ownerNames: ['TOLL BROTHERS INC'] })).toBe('Toll Brothers Inc');
  });

  it('owner, awardee and buyer roles do not use the list', () => {
    expect(contactNameFor('owner', 'Toll Brothers')).toBeNull();
    expect(contactNameFor('buyer', 'Toll Brothers')).toBeNull();
  });
});
