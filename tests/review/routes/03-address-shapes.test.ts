// Round 18 ROUTES review probe (logs/REV-ROUTES-probe-tests), kept as a permanent regression test (redo 1). With REV_OUT set it also
// writes its table to that path; without it it writes nothing.
/**
 * REV-ROUTES probe 03: the "starts with a house number" rule against real address shapes, on both paths the gate reads:
 *  (a) the permit's public summary (contactPathOf([], summary));
 *  (b) a site contact as the scan would hold it (sanitizeContacts, then contactPathOf).
 */
import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { contactPathOf, textShowsPlace } from '@/lib/signals/alert-gate';
import { sanitizeContacts } from '@/lib/contacts/sanitize';

const SHAPES = [
  '123 Main St', '123-125 Main', '123-125 Main St', '123A Main', '123A Main St', 'One Atlantic Center', 'Lot 5 Oak Subdivision', 'Main St & 3rd Ave', '0 Peachtree', '0 Peachtree St', 'PO Box 123', 'P.O. Box 123',
  '123 1/2 Main St', '1234567 Main St', '55 Park Pl NE', '100 Peachtree St NW Ste 400', '3500 Peachtree Rd NE, Atlanta, GA 30326',
  // real stored rows the gate rejected (tests/signals/__data__)
  '196 MONTGOMERY FERRY NE, ATLANTA, GA 30309', '1550 HOSEA L WILLIAMS SE, ATLANTA, GA 30317', '346 HENRY AARON SW, ATLANTA, GA 30310', '551 SPRING VALLEY NW, ATLANTA, GA 30318',
  '1584 ABNER NW, ATLANTA, GA 30314', '2300 NANCY CREEK NW, ATLANTA, GA 30327', '5600 LA SALLE SW, ATLANTA, GA 30331',
  '1755 THE EXCHANGE', '11585 Jones Bridge Road #460', '6344 TILLEY WY MATTHEWS NC 28105', '10416 E INDEPENDENCE BV 650 MATTHEWS NC 28105', '3419 TORINGDON WY 120 CHARLOTTE NC 28277',
  '9803 RIBELIN RANCH CT UNIT 3501', '2211 S IH 35 SVRD NB', '20 ARGYLE', '814 ABBOTT', '14 Story St, Cambridge, MA 02138', '114 Spring St, Unit 2, Cambridge, MA 02141',
  '1 PAYCOR STADIUM', '6442 WILDHAVEN WY', '4443 Wilson Ave Apt 103', '1790 BROADWAY Manhattan', '210 BOWERY Manhattan', '1775 STORY AVENUE', '111 Edgehill Wy',
  '2 Way Radio Install', '30 DAYS', '4 SOUTH WINDOWS', '10 stories', '1 or 2 Family Dwelling', '$12,500 job value', '1200 block of Main St',
];

describe('REV-ROUTES 03: address shapes', () => {
  it('prints what counts as a place to go', () => {
    const out = ['| Address | In the summary | As a site contact (after sanitising) |', '|---|---|---|'];
    for (const a of SHAPES) {
      const bySummary = contactPathOf([], `Building Permit | ${a}`);
      const site = sanitizeContacts([{ role: 'site', name: '', address: a }], {});
      const byContact = contactPathOf(site, null);
      out.push(`| ${a} | ${bySummary ?? 'NONE'} | ${byContact ?? 'NONE'}${site[0] ? ` (stored "${site[0].address}")` : ''} |`);
    }
    if (process.env.REV_OUT) writeFileSync(process.env.REV_OUT as string, out.join('\n') + '\n');
    console.log(out.join('\n'));
    expect(out.length).toBeGreaterThan(2);
  });

  // Redo 1 (commander decision 1): what counts as somewhere to go, on all three paths (summary, stored site contact, raw site field).
  const NOT_A_PLACE = new Set([
    'One Atlantic Center', 'Lot 5 Oak Subdivision', '0 Peachtree', '0 Peachtree St', 'PO Box 123', 'P.O. Box 123', '1234567 Main St', '2 Way Radio Install', '30 DAYS',
    '4 SOUTH WINDOWS', '10 stories', '1 or 2 Family Dwelling', '$12,500 job value', '1200 block of Main St',
  ]);
  const EXTRA_PLACES = ['123 1/2 Main', 'One Atlantic Center, 1201 W Peachtree St', 'Peachtree Center 225 Peachtree St NE', 'Main St & 3rd Ave', 'Peachtree St and 10th St', '123-125 Main', '123A Main'];
  const EXTRA_NOT = ['Lot 2 Sample Ct', 'MAIN ST', 'Main & Oak', 'Lot 12 Oak Hills Subdivision', '00 Main St', 'Cobb County', 'Issued Status Code'];
  it('every real address shape is a place to go, in the summary and as the source\'s site field', () => {
    for (const a of [...SHAPES.filter((x) => !NOT_A_PLACE.has(x)), ...EXTRA_PLACES]) {
      expect(contactPathOf([], `Building Permit | ${a}`), a).toBe('site');
      expect(textShowsPlace(a), a).toBe(true);
      expect(contactPathOf([], null, textShowsPlace(a)), a).toBe('site');
    }
  });
  it('"0 Peachtree", a lot or subdivision, a PO Box, a block, a count and a street with no number are not, on any path', () => {
    for (const a of [...NOT_A_PLACE, ...EXTRA_NOT]) {
      expect(contactPathOf([], `Building Permit | ${a}`), a).toBeNull();
      expect(textShowsPlace(a), a).toBe(false);
      expect(contactPathOf(sanitizeContacts([{ role: 'site', name: '', address: a }], {}), null), a).toBeNull();
    }
  });
});
