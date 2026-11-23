/**
 * Round 18 redo 2: the second review's fresh matrices (fixtures/r18-review2-probes.json, copied by script with the reviewer's label and
 * judgement column): 428 contractor, 185 licence and 201 owner strings. Every string is synthetic.
 *
 * Must be refused: every string the reviewer judged a private person ("PRIVATE PERSON", "ONE PERSON'S COMPANY possible"), a placeholder
 * ("NO PERSON NAMED"), a family holding, a home-prone activity, and every string labelled P (private person), X (placeholder or holding)
 * or H (home-prone) that the reviewer left unjudged because it was already refused. May pass: the reviewer's "business ..." judgements,
 * labels B (business), I (institutional) and Q (borderline). Each matrix names exactly its pinned allow-list.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanBusinessName, cleanContractorName } from '@/lib/contacts/trade-name';
import { ownerCompanyName } from '@/lib/contacts/owner-company';

interface Row { label: string; group: string; input: string; judgement: string }
const P = JSON.parse(readFileSync(join(__dirname, 'fixtures/r18-review2-probes.json'), 'utf8')) as {
  contractor: Row[]; licence: Row[]; owner: Row[]; contractorPass: string[]; licencePass: string[]; ownerPass: string[];
};

const mustRefuse = (r: Row): boolean =>
  /PRIVATE PERSON|ONE PERSON|NO PERSON NAMED|FAMILY HOLDING|home-prone/i.test(r.judgement) || (['P', 'X', 'H'].includes(r.label) && r.judgement === '');

const RULES: [keyof typeof P & ('contractor' | 'licence' | 'owner'), (s: string) => string | null, 'contractorPass' | 'licencePass' | 'ownerPass'][] = [
  ['contractor', cleanContractorName, 'contractorPass'],
  ['licence', (s) => cleanBusinessName(s), 'licencePass'],
  ['owner', ownerCompanyName, 'ownerPass'],
];

describe('review 2 fresh matrices', () => {
  it('the copy is complete: 428 contractor, 185 licence, 201 owner strings', () => {
    expect([P.contractor.length, P.licence.length, P.owner.length]).toEqual([428, 185, 201]);
  });
  for (const [k, rule, passKey] of RULES) {
    it(`${k}: every private person, placeholder, family holding and home-prone string is refused`, () => {
      const leaked = P[k].filter((r) => mustRefuse(r) && rule(r.input) !== null).map((r) => `${r.label} ${r.input} (${r.judgement || 'unjudged'})`);
      expect(leaked).toEqual([]);
    });
    it(`${k}: the strings named are exactly the allow-list (${P[passKey].length})`, () => {
      expect(P[k].map((r) => r.input).filter((s) => rule(s) !== null)).toEqual(P[passKey]);
    });
  }
  it('the named shapes of the review are refused (P1-A to P1-D, P2-2, P2-3, P2-4, P3-7)', () => {
    for (const s of ['Maria Co', 'TRAN CO', 'VANG PA', 'Lee Pa', 'John Brothers', 'Mary Brothers', 'Joyce Brothers', 'Smith Kids LLC', 'Grandpa Joe LLC', 'Deontay Holding'])
      expect(cleanContractorName(s), s).toBeNull();
    for (const s of ['VANG PA', 'TRAN CO', 'Sok Pa', 'Bashir Qasim Tutoring', 'Ifeoma Chukwudi Catering', 'Mary-Ann Smith-Jones Catering', 'Mary-Ann Smith-Jones LLC', 'Maria-Elena Tutoring Services', 'Deontay Kamara LLC', 'KAMARA DEONTAY PA'])
      expect(cleanBusinessName(s), s).toBeNull();
    for (const s of ['GOLD LLC', 'BRIGHT LLC', 'HAWK PROPERTIES LLC', 'ROCK HAWK LLC', 'GOLD NORTH LLC']) expect(ownerCompanyName(s), s).toBeNull();
  });
});
