import { describe, expect, it } from 'vitest';
import { cleanOrgName, isOrganisationName, looksLikeFullPersonName, looksLikePersonName } from '@/lib/contacts/org';
import {
  ATTACK_TABLE,
  JOINED_CASES,
  JOINED_SEPARATORS,
  NEW_ORGS,
  NEW_ORG_EXPECTED_REJECTS,
  NEW_PERSON_TRAPS,
  ORGS,
  ORG_EXPECTED_REJECTS,
  OTHER_REJECTS,
  PERSON_TRAPS,
  REVIEW2_ALLOWED,
  REVIEW2_BATCH_A,
  REVIEW2_BATCH_B,
  REVIEW2_SEPARATORS,
  joinedStrings,
  personWords,
} from './org-cases';

const wordsOf = (s: string) => new Set(s.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean));

describe('isOrganisationName: personal-name traps (target: zero false accepts)', () => {
  it('has at least 50 trap cases and at least 120 cases in all', () => {
    expect(PERSON_TRAPS.length).toBeGreaterThanOrEqual(50);
    expect(PERSON_TRAPS.length + OTHER_REJECTS.length + ORGS.length).toBeGreaterThanOrEqual(120);
  });
  it('accepts none of the personal names', () => {
    const accepted = PERSON_TRAPS.filter((n) => isOrganisationName(n) || cleanOrgName(n) !== null);
    expect(accepted).toEqual([]);
  });
  for (const n of PERSON_TRAPS) it(`rejects person: ${JSON.stringify(n)}`, () => expect(cleanOrgName(n)).toBeNull());
});

describe('isOrganisationName: placeholders, roles, estates, trusts and contact details', () => {
  for (const n of OTHER_REJECTS) it(`rejects ${JSON.stringify(n.slice(0, 60))}`, () => expect(cleanOrgName(n)).toBeNull());
  it('rejects non-strings', () => {
    expect(cleanOrgName(undefined as unknown as string)).toBeNull();
    expect(cleanOrgName(42 as unknown as string)).toBeNull();
    expect(isOrganisationName(null as unknown as string)).toBe(false);
  });
});

describe('isOrganisationName: organisations (false rejects are measured and listed)', () => {
  for (const [label, set, rejects] of [
    ['ORGS (223, round 5)', ORGS, ORG_EXPECTED_REJECTS],
    ['NEW_ORGS (150, FIX-C)', NEW_ORGS, NEW_ORG_EXPECTED_REJECTS],
  ] as const) {
    describe(label, () => {
      for (const n of set) {
        const want = !rejects.has(n);
        it(`${want ? 'accepts' : 'misses (expected)'} ${JSON.stringify(n)}`, () => expect(cleanOrgName(n) !== null).toBe(want));
      }
      it('measured: false rejects are exactly the expected list', () => {
        const missed = set.filter((n) => cleanOrgName(n) === null);
        expect([...missed].sort()).toEqual([...rejects].sort());
      });
    });
  }
  it('sizes: 223 + 150 distinct organisations', () => {
    expect(new Set(ORGS).size).toBe(223);
    expect(new Set(NEW_ORGS).size).toBe(150);
    expect(ORGS.filter((n) => NEW_ORGS.includes(n))).toEqual([]);
  });
});

describe('cleanOrgName output', () => {
  it('a DBA form: the part that passes and shares no word with the failing part, else null (R8)', () => {
    expect(cleanOrgName('JOHN SMITH DBA SMITH ROOFING')).toBeNull();
    expect(cleanOrgName('Maria Lopez d/b/a Lopez Cleaning Services')).toBeNull();
    expect(cleanOrgName('ACME HOLDINGS LLC DBA JOHN SMITH')).toBe('ACME HOLDINGS LLC');
    expect(cleanOrgName('ACME HOLDINGS LLC DBA XYZ')).toBe('ACME HOLDINGS LLC');
  });
  it('drops parenthetical notes, wrapping quotes and extra spaces; a legal-form part joins the part before it', () => {
    expect(cleanOrgName('  "ACME   ROOFING LLC"  ')).toBe('ACME ROOFING LLC');
    expect(cleanOrgName('ACME ROOFING (JOHN SMITH)')).toBe('ACME ROOFING');
    expect(cleanOrgName('Acme Roofing, Inc.')).toBe('Acme Roofing Inc.');
    expect(cleanOrgName('Kowalski Roofing.')).toBe('Kowalski Roofing'); // FIX-E: was 'Smith Roofing.' ("smith" is a listed given name now)
  });
  it('isOrganisationName is true only when nothing in the value is droppable', () => {
    expect(isOrganisationName('ACME ROOFING LLC')).toBe(true);
    expect(isOrganisationName('  ACME   ROOFING LLC ')).toBe(true);
    for (const n of ['Acme Roofing, Inc.', 'ACME ROOFING (JOHN SMITH)', '"ACME ROOFING LLC"', 'ACME ROOFING LLC #12', 'Kowalski Roofing.']) {
      expect(cleanOrgName(n), n).not.toBeNull();
      expect(isOrganisationName(n), n).toBe(false);
    }
  });
  it('is stable and consistent: every cleaned name passes again unchanged and is an organisation name', () => {
    const tables = [
      ...ORGS, ...NEW_ORGS, ...PERSON_TRAPS, ...OTHER_REJECTS, ...NEW_PERSON_TRAPS, ...Object.values(ATTACK_TABLE).flat().map(([n]) => n),
      ...JOINED_CASES.map(([n]) => n), ...Object.values(REVIEW2_BATCH_A).flat(), ...Object.values(REVIEW2_BATCH_B).flat(),
      ...joinedStrings().map((x) => x.s),
    ];
    for (const n of tables) {
      const c = cleanOrgName(n);
      if (c) {
        expect(cleanOrgName(c), n).toBe(c);
        expect(isOrganisationName(c), n).toBe(true);
      }
    }
  });
  it('length limits: 3 to 120 characters', () => {
    expect(cleanOrgName('AB')).toBeNull();
    expect(cleanOrgName(`${'A'.repeat(116)} LLC`)).toBe(`${'A'.repeat(116)} LLC`);
    expect(cleanOrgName(`${'A'.repeat(117)} LLC`)).toBeNull();
  });
});

describe('privacy review attack table (review-privacy.md, groups A to M)', () => {
  it('holds all 272 strings', () => expect(Object.values(ATTACK_TABLE).flat()).toHaveLength(272));
  it('measured: none is accepted (group K included since FIX-C: its company part shares the person\'s surname)', () => {
    const wrong = Object.values(ATTACK_TABLE).flat().filter(([n]) => cleanOrgName(n) !== null);
    expect(wrong).toEqual([]);
  });
  for (const [group, rows] of Object.entries(ATTACK_TABLE)) {
    describe(group, () => {
      for (const [n, want] of rows) it(`${JSON.stringify(n)} -> ${JSON.stringify(want)}`, () => expect(cleanOrgName(n)).toBe(want));
    });
  }
});

describe('round 5 personal-name traps (new shapes, target: zero false accepts)', () => {
  it('has at least 200 traps, all distinct', () => {
    expect(NEW_PERSON_TRAPS.length).toBeGreaterThanOrEqual(200);
    expect(new Set(NEW_PERSON_TRAPS).size).toBe(NEW_PERSON_TRAPS.length);
  });
  it('measured: zero accepted', () => expect(NEW_PERSON_TRAPS.filter((n) => cleanOrgName(n) !== null)).toEqual([]));
  for (const n of NEW_PERSON_TRAPS) it(`rejects ${JSON.stringify(n)}`, () => expect(cleanOrgName(n)).toBeNull());
});

describe('second review (review2.md P0-1): every Batch A and Batch B string', () => {
  const all = [...Object.values(REVIEW2_BATCH_A).flat(), ...Object.values(REVIEW2_BATCH_B).flat()];
  it('holds the 706 strings of the review scripts (575 + 2 duplicates it skipped, 126 + 3 it left out of its tables)', () => {
    expect(all).toHaveLength(706);
  });
  it('measured: the only non-null results are the listed allowed ones, with exactly the listed output', () => {
    const accepted = Object.fromEntries(all.map((n) => [n, cleanOrgName(n)] as const).filter(([, c]) => c !== null));
    const want = Object.fromEntries(Object.entries(REVIEW2_ALLOWED).filter(([n]) => all.includes(n)));
    expect(accepted).toEqual(want);
  });
  it('no accepted output holds a given name, an initial or a word of a failing part', () => {
    for (const [n, out] of Object.entries(REVIEW2_ALLOWED)) {
      expect(cleanOrgName(n), n).toBe(out);
      expect(out).not.toMatch(/DARIUS|WHITFIELD|INGRID|HALVORSEN|CALLUM|FRASER|JOHN/i);
    }
  });
  for (const [group, rows] of [...Object.entries(REVIEW2_BATCH_A), ...Object.entries(REVIEW2_BATCH_B)]) {
    describe(group, () => {
      for (const n of rows) {
        const want = REVIEW2_ALLOWED[n] ?? null;
        it(`${JSON.stringify(n)} -> ${JSON.stringify(want)}`, () => expect(cleanOrgName(n)).toBe(want));
      }
    });
  }
  it('the sole-trader allowance is withdrawn', () => {
    for (const n of ['JOHN SMITH ROOFING', 'Mary Jones Plumbing LLC', 'MARIA LOPEZ HOME DAYCARE', 'J Smith Plumbing LLC', 'JOHN SMITH LLC', 'Peter Design']) {
      expect(cleanOrgName(n), n).toBeNull();
    }
  });
});

describe('joined strings (review2 generator: 6 persons x 5 companies x separators x 2 orders)', () => {
  const rows = joinedStrings();
  it('uses the review\'s 95 separators and 50 of our own', () => {
    expect(REVIEW2_SEPARATORS).toHaveLength(95);
    expect(JOINED_SEPARATORS).toHaveLength(145);
    expect(rows).toHaveLength(6 * 5 * 145 * 2);
  });
  it('measured: zero outputs hold a word of the person\'s name', () => {
    const leaks = rows
      .map((r) => ({ ...r, out: cleanOrgName(r.s) }))
      .filter((r) => r.out !== null && personWords(r.person).some((w) => wordsOf(r.out!).has(w)))
      .map((r) => `${JSON.stringify(r.s)} -> ${JSON.stringify(r.out)}`);
    expect(leaks).toEqual([]);
  });
  it('a non-null output is always exactly the company (never a fragment)', () => {
    const odd = rows
      .map((r) => ({ ...r, out: cleanOrgName(r.s) }))
      .filter((r) => r.out !== null && r.out.toLowerCase() !== r.company.toLowerCase())
      .map((r) => `${JSON.stringify(r.s)} -> ${JSON.stringify(r.out)}`);
    expect(odd).toEqual([]);
  });
});

describe('a person joined to a company: only the company part, never the person', () => {
  for (const [n, want] of JOINED_CASES) it(`${JSON.stringify(n)} -> ${JSON.stringify(want)}`, () => expect(cleanOrgName(n)).toBe(want));
});

describe('the strict shape rule, one finding at a time (review2 P0-1)', () => {
  const nulls = (list: string[]) => {
    for (const n of list) expect(cleanOrgName(n), n).toBeNull();
  };
  it('R1: look-alike scripts, digits other than one trailing store number', () => {
    nulls(['Mаry Blue Church', 'Jоhn Royal Law', 'ЈОНN ЅМІТН ROOFING', 'Ѕummit Rоofing LLC', 'A1 Roofing', 'Pho 99 Restaurant', '7-ELEVEN #33421']);
    expect(cleanOrgName('ACME ROOFING LLC #12')).toBe('ACME ROOFING LLC');
    expect(cleanOrgName('ACME ROOFING LLC 12')).toBe('ACME ROOFING LLC');
    expect(cleanOrgName('Café Brazil Restaurant')).toBe('Cafe Brazil Restaurant'); // FIX-F (review4 P2-10): accent-folded output
  });
  it('R2: given names (also possessive or hyphenated), initials, honorifics, suffixes, roles, job titles', () => {
    nulls(['Bill Center', 'Tamika Nails', "Joe's Bar", 'Jean-Luc Roofing', 'J Smith Plumbing LLC', 'P.C. WREN', 'Okonjo, L.P.', 'PEMBERTON L P',
      'Mr. Rooter Plumbing', 'OKONJO JR ROOFING', 'OKONJO MD INC', 'JOHN SMITH DENTAL HYGIENIST', 'ANNA LEE DENTAL PATIENT', 'PAUL YOUNG HOTEL GUEST',
      'OKONJO ROOFING TRUST', 'ACME ESTATE SALES', 'SMITH RESIDENCE ROOFING', 'ACME POC ROOFING', 'PRINCIPAL FINANCIAL GROUP', 'ACME ROOFING CEO']);
    expect(cleanOrgName('Okonjo Real Estate')).toBeNull(); // FIX-F flip (review4 P1-A): "real" is a SURNAME_VOCAB word next to an unknown word
    expect(cleanOrgName('Summit Real Estate')).toBe('Summit Real Estate');
  });
  it('R3: symbols, more than one "&", periods outside a final legal form', () => {
    nulls(['ACME & SMITH & SONS ROOFING', 'ACME ROOFING & & CO', 'St. Mary\'s Catholic Church', 'ACME.ROOFING LLC', 'ACME ROOFING L.P.']);
    expect(cleanOrgName('ACME ROOFING L.L.C.')).toBe('ACME ROOFING L.L.C.');
    expect(cleanOrgName('ABC ELECTRIC CO.')).toBe('ABC ELECTRIC CO.');
    expect(cleanOrgName('Kowalski & Sons Plumbing')).toBe('Kowalski & Sons Plumbing'); // FIX-E: 'Smith & Sons Plumbing' -> null ("smith" is a given name)
  });
  it('R4: street-address, phone, email and link shapes', () => {
    nulls(['JOHN SMITH 123 CENTER ST', 'OKONJO 500 W CENTER', 'OKONJO CENTER ST', 'OKONJO ROOFING 512/555/0100', 'ACME ROOFING gsa.gov',
      'ACME ROOFING www.acme.com', 'ACME ROOFING bk@acme.com']);
  });
  it('R5: evidence; CO, COMPANY, PA, PC, NA only with other evidence', () => {
    nulls(['Okonjo Company', 'Castellano Co', 'Brathwaite PA', 'Lindgren PC', 'River Church', 'Star Law', 'Earl County']);
    expect(cleanOrgName('Okonjo Roofing Co')).toBe('Okonjo Roofing Co');
    expect(cleanOrgName('Okonjo Inc')).toBe('Okonjo Inc');
  });
  it('R6: unknown-token budget (FIX-E: one, legal form or not; each hyphen part counts)', () => {
    expect(cleanOrgName('Kowalski Roofing')).toBe('Kowalski Roofing');
    expect(cleanOrgName('Kowalski Zelenskyy Roofing')).toBeNull();
    expect(cleanOrgName('Okonjo Zelenskyy LLC')).toBeNull(); // FIX-E flip (review3 P0-2 fix (a)): was accepted
    expect(cleanOrgName('Gallagher LLC')).toBe('Gallagher LLC');
    expect(cleanOrgName('Danny Smith LLC')).toBeNull();
    expect(cleanOrgName('Brent Kowalski LLC')).toBeNull();
    expect(cleanOrgName('ZENDAYA OKONJO-APEX ROOFING LLC')).toBeNull();
    expect(cleanOrgName('Kowalski-Zelenskyy Roofing')).toBeNull();
  });
  it('R7: "&" and "AND"; glued "X&Y"', () => {
    expect(cleanOrgName('Kowalski & Sons Plumbing')).toBe('Kowalski & Sons Plumbing');
    nulls(['John & Mary Smith', 'MR&MS OKONJO', 'AL&JO ZELENSKYY', 'J&M OKONJO', 'H&R BLOCK', 'AT&T', 'JR&SR ZELENSKYY']);
    expect(cleanOrgName('J&M Roofing')).toBe('J&M Roofing');
    expect(cleanOrgName('J&M OKONJO ROOFING')).toBeNull();
  });
  it('R8: joined strings', () => {
    expect(cleanOrgName('BRENT KOWALSKI @ APEX ROOFING LLC')).toBe('APEX ROOFING LLC');
    expect(cleanOrgName('APEX ROOFING LLC AT BRENT KOWALSKI')).toBe('APEX ROOFING LLC');
    expect(cleanOrgName('BRENT KOWALSKI D B A APEX ROOFING LLC')).toBe('APEX ROOFING LLC');
    expect(cleanOrgName('BRENT KOWALSKI - KOWALSKI ROOFING')).toBeNull();
    expect(cleanOrgName('KOWALSKI ROOFING (B. Kowalski)')).toBeNull();
    expect(cleanOrgName('Summit Mechanical KOWALSKI, BRENT T')).toBeNull();
    expect(cleanOrgName('ZENDAYA OKONJO OF APEX ROOFING LLC')).toBe('APEX ROOFING LLC');
    expect(cleanOrgName('ROOFING BY JOHN SMITH')).toBeNull();
  });
});

describe('FIX-C self-attack on the strict rule', () => {
  it('a full name glued into one word counts as a given name', () => {
    for (const n of ['MARIALOPEZ DAYCARE', 'JOHNSMITH ROOFING', 'LOPEZMARIA DAYCARE']) expect(cleanOrgName(n), n).toBeNull();
    expect(cleanOrgName('Patterson Plumbing')).toBeNull(); // FIX-E flip (R10): "PAT" + "TERSON" is a listed given name glued to 3+ letters
  });
  it('an invisible or direction character anywhere rejects the value (it can split a word: "MARIA LO<ZWSP>PEZ")', () => {
    for (const c of ['\u200b', '\u200d', '\u2060', '\ufeff', '\u00ad', '\u200f', '\u202e']) {
      expect(cleanOrgName(`MARIA LO${c}PEZ DAYCARE`), JSON.stringify(c)).toBeNull();
      expect(cleanOrgName(`ACME ROOFING LLC${c}`), JSON.stringify(c)).toBeNull();
    }
  });
  it('R1 is checked on the letters as written: fullwidth, ligature and other compatibility letters are rejected', () => {
    for (const n of ['\u01c7ohn Roofing', '\uff2a\uff2f\uff28\uff2e ROOFING', 'ACME \uff32OOFING LLC', '\ufb01ne Roofing LLC']) expect(cleanOrgName(n), n).toBeNull();
    expect(cleanOrgName('BRENT KOWALSKI\uff0cAPEX ROOFING LLC')).toBe('APEX ROOFING LLC'); // a fullwidth comma is punctuation, not a letter
  });
  it('accepted by design (R6): one unknown word with a trade word; FIX-E: never two, legal form or not', () => {
    expect(cleanOrgName('Zendaya Roofing')).toBe('Zendaya Roofing');
    expect(cleanOrgName('OKONJO ZENDAYA LLC')).toBeNull(); // FIX-E flip
  });
});

describe('person-shape helpers', () => {
  it('looksLikePersonName and looksLikeFullPersonName', () => {
    expect(looksLikePersonName('JOHN SMITH #4521')).toBe(true);
    expect(looksLikePersonName('ZENDAYA OKONJO')).toBe(true);
    expect(looksLikePersonName('SMITH ROOFING')).toBe(false);
    expect(looksLikeFullPersonName('JOHN SMITH')).toBe(true);
    expect(looksLikeFullPersonName('FORT HOOD')).toBe(false);
  });
});

describe('rules kept from the first privacy review (fixes a to f) and F15', () => {
  it('a: ids and licence numbers never pass', () => {
    for (const n of ['JOHN SMITH LIC#4521', 'BRENT KOWALSKI #4521', 'MARIA LOPEZ UNIT4', '7-ELEVEN #33421', 'AB12 CD34']) expect(cleanOrgName(n), n).toBeNull();
  });
  it('b, c: an ambiguous business word next to a name is not enough', () => {
    for (const n of ['ERIN M CHURCH', 'Maria Arena', 'Cabot Winthrop Lodge', 'Taco Ockerse', 'BURGER, JOHN A']) expect(cleanOrgName(n), n).toBeNull();
  });
  it('e: a legal form counts only as the final token, never in "LAST, initials" shape', () => {
    for (const n of ['P.C. WREN', 'Corp. John Smith', 'JOHNSON, P.C.', 'GRANT, U S', 'Mary U. S. Jones', 'MICHAEL CO.', 'Ahmet Inc']) expect(cleanOrgName(n), n).toBeNull();
    expect(cleanOrgName('ACME ROOFING INC')).toBe('ACME ROOFING INC'); // FIX-E: 'ACME WIDGETS INC' -> null (two unknown words)
  });
  it('f: honorifics', () => {
    for (const n of ['MR TREVOR LAW', 'DR WENDY BANK', 'MRS ERIN KITCHEN', 'SISTER MARY CLARENCE']) expect(cleanOrgName(n), n).toBeNull();
  });
  it('F15: a phone glued to a suffix or to letters fails the value', () => {
    for (const n of ['JOHN SMITH 512-555-0100x12', 'ACME ROOFING LLC 512-555-0100x12', 'ACME ROOFING LLC PH5125550100']) expect(cleanOrgName(n), n).toBeNull();
  });
});
