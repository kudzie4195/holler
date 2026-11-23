/**
 * Round 20 (review LIC P3, a live bug on main): "FIRM of PLACE LEGAL" in a contractor column used to show the place alone
 * ("LENNAR HOMES OF CALIFORNIA LLC" -> "CALIFORNIA LLC"), because the "PERSON of FIRM" split fell back to the right part. A right part that
 * is only a listed place plus a legal form is never shown alone now (lib/contacts/trade-name.ts cleanContractorName, placeWithLegal).
 */
import { describe, expect, it } from 'vitest';
import { cleanContractorName, isContractorName } from '@/lib/contacts/trade-name';

describe('FIRM of PLACE in a contractor column', () => {
  it.each([
    'LENNAR HOMES OF CALIFORNIA LLC', 'PULTE HOMES OF TEXAS LP', 'TOLL BROS OF ARIZONA INC', 'MERITAGE HOMES OF ARIZONA INC', 'KB HOME OF TEXAS LLC',
    'Meritage Homes of Texas LLC', 'Darling Homes of Texas LLC', 'ACME BUILDERS OF NORTH TEXAS, INC.', 'SUMMIT CONSTRUCTION OF SOUTH FLORIDA LLC',
  ])('%s is shown whole, and is stable on re-check', (n) => {
    expect(cleanContractorName(n)).toBe(n);
    expect(isContractorName(n)).toBe(true);
  });

  it.each([
    ['TAYLOR MORRISON OF GEORGIA LLC', null], // a person-shaped left part: nothing (it used to show "GEORGIA LLC")
    ['M/I HOMES OF DFW LLC', null], // "M/I HOMES LLC" does not pass this rule: nothing (it used to show "DFW LLC")
    ['JOHN SMITH OF TEXAS LLC', null],
    ['MARY JONES OF FLORIDA INC', null],
    ['ACME ROOFING OF TEXAS LLC', 'ACME ROOFING'], // not a builder-style ending: the firm part, as before, never the place
    ['MARY JONES OF ACME ROOFING LLC', 'ACME ROOFING LLC'], // PERSON of FIRM: unchanged
    ['ACME ROOFING OF TEXAS', 'ACME ROOFING'], // no legal form: unchanged
  ])('%s -> %s; never the place alone', (n, want) => {
    const out = cleanContractorName(n);
    expect(out).toBe(want);
    expect(out ?? '').not.toMatch(/^(?:GEORGIA|DFW|TEXAS|FLORIDA|CALIFORNIA|ARIZONA) (?:LLC|INC|LP)$/);
  });
});
