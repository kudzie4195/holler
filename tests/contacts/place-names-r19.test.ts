/**
 * Round 19 integration (coordinator input to task 3): the 57 plausible company names of review COVERAGE (finding 5; probe output
 * /tmp/rev-logs/org.json, its two one-word controls "TEXAS" and "LLC" left out), measured against the merged round 18 name rules.
 *  - the old shared strict check (lib/contacts/org.ts cleanOrgName): 20 of 57, as the review found (37 rejected);
 *  - the round 18 contractor rule (contractor columns, the builders panel): 48 of 57; state and city names are already accepted there;
 *  - the round 18 licence rule (role business): 23 of 57 before this integration, 31 after the one narrow change below.
 * The change: lib/contacts/trade-name.ts PLACE_NOT_PERSON = texas, florida (state names on the given-name list that are not used as given
 * names), accepted in a licence name only with a legal form and only when every other word is a trade, business or plain word that is no
 * person-name word. No other word changed.
 * Round 20 (LIC): both rules also accept a listed large builder or contractor named exactly (lib/contacts/known-companies.ts): the contractor
 * rule 52 of 57 (+LENNAR HOMES OF TEXAS, TOLL BROTHERS, FIRST TEXAS HOMES, ARS RESCUE ROOTER). The licence rule accepts a listed name only
 * with a legal form (review LIC P2-6): 32 of 57 (+D R HORTON TEXAS LTD; the first round 20 commit had 36). "DR HORTON" stays refused on
 * purpose: bare, it is also "Dr. Horton", a person. The private-person matrices (tests/contacts/r18-review2-probes.test.ts, 814 strings) are
 * unchanged and still name no private person; the shapes below that pair a state with a person's name stay refused.
 */
import { describe, expect, it } from 'vitest';
import { cleanOrgName } from '@/lib/contacts/org';
import { contactNameFor } from '@/lib/contacts/names';
import { cleanBusinessName, PLACE_NOT_PERSON } from '@/lib/contacts/trade-name';

const NAMES = ["NORTH TEXAS ROOFING LLC", "North Texas Roofing LLC", "LONE STAR ROOFING LLC", "Lone Star Roofing LLC", "TEXAS ROOFING LLC", "ROOFING LLC", "ABC ROOFING LLC", "ABC ROOFING INC", "ALL MASTERS PLUMBING", "1ST CHOICE ROOFING LLC", "A-1 PLUMBING CO", "3D ELECTRIC INC", "MILESTONE ELECTRIC", "SUNSHINE ROOFING INC", "Valley Plumbing LLC", "NORTH TEXAS ROOFING", "NORTH TEXAS ROOFING INC", "DALLAS ROOFING LLC", "BAKER BROTHERS PLUMBING", "BAKER BROTHERS PLUMBING LLC", "TRINITY ROOFING LLC", "METRO ELECTRIC LLC", "SOUTHWEST PLUMBING LLC", "NORTH ROOFING LLC", "STAR ROOFING LLC", "LONE ROOFING LLC", "FREEDOM SOLAR LLC", "TESLA ENERGY OPERATIONS INC", "SUNRUN INSTALLATION SERVICES INC", "ARS RESCUE ROOTER", "ON TIME EXPERTS", "MILESTONE ELECTRIC AND AIR", "LENNAR HOMES OF TEXAS", "D R HORTON TEXAS LTD", "DR HORTON", "TOLL BROTHERS", "FIRST TEXAS HOMES", "HOME DEPOT USA INC", "LOWES HOME CENTERS LLC", "FLORIDA ROOFING INC", "MIAMI ROOFING CORP", "A & B PLUMBING INC", "ARIZONA ROOFING LLC", "PHOENIX PLUMBING LLC", "BEST ROOFING LLC", "NORTH DALLAS ROOFING LLC", "EAST TEXAS ROOFING LLC", "WEST TEXAS ROOFING LLC", "SOUTH FLORIDA ROOFING INC", "CENTRAL TEXAS ROOFING LLC", "NORTH AMERICAN ROOFING LLC", "GREAT AMERICAN ROOFING LLC", "ALL AMERICAN ROOFING LLC", "ALL STAR ROOFING LLC", "ALL PRO PLUMBING LLC", "PRO ROOFING LLC", "ACE ROOFING LLC"];

const rejected = (f: (s: string) => string | null) => NAMES.filter((n) => f(n) === null);

describe('review COVERAGE: 57 company names under the merged round 18 rules', () => {
  it('57 names', () => expect(new Set(NAMES).size).toBe(57));

  it('old strict check: 20 accepted, 37 rejected', () => {
    expect(rejected((s) => cleanOrgName(s))).toHaveLength(37);
  });

  it('contractor rule with the round 20 known-company list: 52 accepted; exactly these 5 rejected (round 19: 48 and 9)', () => {
    expect(rejected((s) => contactNameFor('contractor', s))).toEqual(["ROOFING LLC", "A-1 PLUMBING CO", "3D ELECTRIC INC", "ON TIME EXPERTS", "DR HORTON"]);
  });

  // Round 21 integration: LIC's known-company list (r20-ship) and NEXT's second try for legal-form names (review fix P1-4 / P2-6, decided
  // explicitly: "Lone Star Roofing LLC" is a company) together.
  // Exactly the intersection of both branches' rejected lists: r20-ship's 25 less the two Lone Star spellings, NEXT's 24 less "D R HORTON TEXAS LTD".
  it('licence rule with the round 20 known-company list and the round 20 second try: 34 accepted; exactly these 23 rejected', () => {
    expect(rejected((s) => contactNameFor('business', s))).toEqual(["ROOFING LLC", "ALL MASTERS PLUMBING", "A-1 PLUMBING CO", "3D ELECTRIC INC", "SUNSHINE ROOFING INC", "NORTH TEXAS ROOFING", "DALLAS ROOFING LLC", "BAKER BROTHERS PLUMBING", "BAKER BROTHERS PLUMBING LLC", "TRINITY ROOFING LLC", "STAR ROOFING LLC", "ARS RESCUE ROOTER", "ON TIME EXPERTS", "LENNAR HOMES OF TEXAS", "DR HORTON", "TOLL BROTHERS", "FIRST TEXAS HOMES", "A & B PLUMBING INC", "PHOENIX PLUMBING LLC", "NORTH DALLAS ROOFING LLC", "WEST TEXAS ROOFING LLC", "ALL STAR ROOFING LLC", "ACE ROOFING LLC"]);
  });

  it('the change is exactly two words, and a state name never carries a person\'s name through', () => {
    expect([...PLACE_NOT_PERSON].sort()).toEqual(['florida', 'texas']);
    for (const n of ['NORTH TEXAS ROOFING LLC', 'SOUTH FLORIDA ROOFING INC', 'TEXAS ROOFING LLC', 'CENTRAL TEXAS ROOFING LLC']) expect(cleanBusinessName(n, { shapeOnly: true }), n).toBe(n);
    for (const n of ['TEXAS SMITH LLC', 'Florida Garcia Inc', 'FLORIDA MARIA LLC', 'Texas Lopez Catering LLC', 'MARIA TEXAS LLC', 'TEXAS LLC', 'TEXAS ROOFING', 'Texas Rose LLC', 'FLORIDA JONES INC', 'Florida Nguyen LLC', 'Texas Bashir Plumbing LLC', 'Florida Deontay Roofing LLC', 'Virginia Roofing LLC', 'Georgia Catering LLC', 'Dallas Smith Roofing LLC'])
      expect(cleanBusinessName(n, { shapeOnly: true }), n).toBeNull();
  });
});
