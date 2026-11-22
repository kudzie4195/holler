/**
 * Round 18 redo 1: the independent review's probe matrices, kept as permanent tests (fixtures/r18-review-probes.json, copied by script
 * from /home/claude/gates/r18/logs/REV-NAMES-probe-tests/). Every string is synthetic. The bar is zero private persons passing:
 *  - every string the reviewer judged a private person, a family or personal holding, a person beside a firm or a placeholder is
 *    refused, or reduced to the firm alone;
 *  - every placeholder and owner-builder value is refused under the contractor and the licence rule;
 *  - "<first name missing from the lists> <surname-capable trade word>" is refused under the contractor and the licence rule, and
 *    "<that> LLC" under the owner rule (the review found 4,238, 6,282 and 1,573 passes);
 *  - in each matrix, only the strings on the matching *Pass list are named (each a business under the owner's rule; any new pass fails).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanBusinessName, cleanContractorName } from '@/lib/contacts/trade-name';
import { ownerCompanyName } from '@/lib/contacts/owner-company';

const P = JSON.parse(readFileSync(join(__dirname, 'fixtures/r18-review-probes.json'), 'utf8')) as {
  judgedNotBusiness: { input: string; judgement: string }[];
  contractorMatrix: string[];
  contractorPass: string[];
  placeholders: string[];
  ownerMatrix: string[];
  ownerPass: string[];
  licenceMatrix: string[];
  licencePass: string[];
  unlistedGivenNames: string[];
  surnameCapableWords: string[];
  listedGivenPlusTradeSurname: string[];
};

/** Reduced to the firm alone (redo rule 4), the only allowed output for a judged string. */
const REDUCED: Record<string, string> = { 'John Smith of Smith Roofing': 'Smith Roofing' };

describe('review probes: judged private persons, family holdings, persons beside a firm and placeholders', () => {
  it('the copy is complete', () => {
    expect(P.judgedNotBusiness).toHaveLength(32);
    expect(P.placeholders).toHaveLength(198);
    expect(P.contractorMatrix.length).toBeGreaterThanOrEqual(750);
    expect(P.unlistedGivenNames).toHaveLength(178);
  });
  it.each(P.judgedNotBusiness.map((j) => [j.input, j.judgement]))('%s (%s): refused or reduced to the firm', (input) => {
    expect(cleanContractorName(input)).toBe(REDUCED[input] ?? null);
    expect(cleanBusinessName(input)).toBeNull();
  });
  it('every placeholder or owner-builder value is refused under the contractor and the licence rule', () => {
    const passed = P.placeholders.filter((v) => cleanContractorName(v) || cleanBusinessName(v));
    expect(passed).toEqual([]);
  });
  it('a listed first name plus a surname-capable trade word is refused', () => {
    expect(P.listedGivenPlusTradeSurname.filter((v) => cleanContractorName(v))).toEqual([]);
  });
});

describe('review probes: first names missing from the lists', () => {
  const pairs = P.unlistedGivenNames.flatMap((n) => P.surnameCapableWords.map((w) => `${n} ${w}`));
  it(`${pairs.length} "<unlisted first name> <trade word>" strings: none passes as a contractor or a licence business`, () => {
    expect(pairs.filter((v) => cleanContractorName(v))).toEqual([]);
    expect(pairs.filter((v) => cleanBusinessName(v))).toEqual([]);
  });
  it('none passes as an owner company with LLC', () => {
    expect(pairs.map((v) => `${v} LLC`).filter((v) => ownerCompanyName(v))).toEqual([]);
  });
});

describe('review probes: each matrix names only its allow-list', () => {
  it('contractor matrix', () => expect(P.contractorMatrix.filter((v) => cleanContractorName(v))).toEqual(P.contractorPass));
  it('owner matrix (institutional owners only)', () => expect(P.ownerMatrix.filter((v) => ownerCompanyName(v))).toEqual(P.ownerPass));
  it('licence matrix', () => expect(P.licenceMatrix.filter((v) => cleanBusinessName(v))).toEqual(P.licencePass));
  it('the owner allow-list holds no listed person name and no family word', () => {
    for (const v of P.ownerPass) expect(v).not.toMatch(/\b(?:smith|john|mary|maria|garcia|lopez|family)\b/i);
  });
});
