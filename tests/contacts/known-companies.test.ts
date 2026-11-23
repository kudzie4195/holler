/**
 * Round 20 (LIC, lever 1): the reviewed known-company list (lib/contacts/known-companies.ts). Exact name forms only: a listed builder is
 * accepted even where the shape rule reads a surname as a person; a string that only shares a word with a listed name gets nothing.
 */
import { describe, expect, it } from 'vitest';
import { KNOWN_COMPANIES, companyKey, knownCompanyName, knownCompanyOf } from '@/lib/contacts/known-companies';
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
  it('each form passes the contractor rule and the licence rule unchanged, and is stable on re-check', () => {
    for (const f of ALL_FORMS) {
      const want = f.replace(/\s+/g, ' ').trim();
      expect(contactNameFor('contractor', f), f).toBe(want);
      expect(contactNameFor('business', f, { ownerNames: ['ACME HOLDINGS LLC'] }), f).toBe(want);
      expect(isStoredContactName('contractor', want), f).toBe(true);
      expect(isStoredContactName('business', want), f).toBe(true);
      expect(knownCompanyName(knownCompanyName(f)), f).toBe(knownCompanyName(f));
    }
  });

  it('punctuation, case and spacing variants of a form match ("D R HORTON INC", "toll  brothers, inc.")', () => {
    for (const v of ['D R HORTON INC', 'd.r. horton, inc.', 'DR HORTON INC', 'toll  brothers, inc.', 'LENNAR HOMES OF TEXAS', 'Brasfield and Gorrie LLC', 'WHITING TURNER CONTRACTING CO'])
      expect(knownCompanyOf(v), v).not.toBeNull();
  });

  it('a string that only shares a word with a listed name is never accepted by the list', () => {
    const sharing = [
      'John Horton', 'Mary Lennar', 'Toll Smith', 'Maria Meritage', 'Taylor Morrison', 'Taylor Morrison Smith', 'Dr. Horton', 'DR HORTON',
      'D.R. Horton', 'David Weekley', 'Kevin Perry Homes', 'Perry Homes John Smith', 'Lennar Homes - John Smith', 'John Smith of Lennar Homes Inc',
      'Toll Brothers c/o Mary Toll', 'Ashton Woods', 'Stanley Martin', 'Hensel Phelps', 'KB', 'Pulte', 'Turner', 'Shea', 'Mary Shea Homes',
      'Lennar Homes​', 'Lennar Homes 2', 'Toll Brothers Owner', 'Homeowner Toll Brothers',
    ];
    for (const s of sharing) expect(knownCompanyOf(s), s).toBeNull();
    // And through the full rules: none of these person shapes is named.
    for (const s of ['John Horton', 'Mary Lennar', 'Toll Smith', 'Taylor Morrison', 'Dr. Horton', 'D.R. Horton', 'David Weekley', 'Ashton Woods', 'Stanley Martin', 'Hensel Phelps', 'Toll Brothers c/o Mary Toll', 'Toll Brothers Owner'])
      expect(contactNameFor('contractor', s), s).toBeNull();
  });

  it('licence rule: the owner check still holds for a listed name ("Toll Brothers" owned by the person "Mary Toll" gives nothing)', () => {
    expect(contactNameFor('business', 'Toll Brothers', { ownerNames: ['MARY TOLL'] })).toBeNull();
    expect(contactNameFor('business', 'Toll Brothers', { ownerNames: ['TOLL BROTHERS INC'] })).toBe('Toll Brothers');
  });

  it('owner, awardee and buyer roles do not use the list', () => {
    expect(contactNameFor('owner', 'Toll Brothers')).toBeNull();
    expect(contactNameFor('buyer', 'Toll Brothers')).toBeNull();
  });
});
