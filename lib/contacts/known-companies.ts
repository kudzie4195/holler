import { foldName } from './org';

/**
 * Round 20 (unit LIC, lever 1): a reviewed allow-list of large home builders and national or regional contractors that pull permits in
 * the 10 metros. The business-name rules (trade-name.ts cleanContractorName and cleanBusinessName) accept a string that matches one of
 * these legal or trade name FORMS exactly, after companyKey() below, even when the rule would otherwise read it as a person ("Toll
 * Brothers", "Lennar Homes", "D.R. Horton Inc"). It is a whole-string match only: a string that shares a word with a listed name ("John
 * Horton", "Mary Lennar", "Toll Smith", "Horton Roofing") gets nothing from this list and goes through the normal rule unchanged.
 *
 * Rules for an entry (tests/contacts/known-companies.test.ts enforces the first three):
 *  K1. Every entry has a one-line source and a tag: [O] the source itself was opened (an SEC filing), [3P] a third-party page that lists
 *      the company was opened (a builder ranking, a utility's builder list), [S] the name was seen in search-result titles or URLs only.
 *  K2. A form that reads like a private person's full name on its own (a given name plus a surname, initials plus a surname) is NOT listed
 *      bare: "Taylor Morrison", "D.R. Horton", "DR Horton" (also "Dr. Horton"), "Ashton Woods", "Stanley Martin", "Hensel Phelps" appear
 *      only with a legal form or a firm word ("Taylor Morrison Homes", "D.R. Horton Inc", "Ashton Woods Homes").
 *  K3. Forms normalise to distinct keys, each to one company only.
 *  K4. A form is the name in the source or that name with a legal form added or removed ("Toll Brothers" and "Toll Brothers Inc").
 *      Subsidiary names are listed only when the source names them (D.R. Horton's Exhibit 21).
 * The list was compiled on 2026-11-22. It is reviewed by hand; add a company only with a source line.
 */

export type KnownCompanyKind = 'homebuilder' | 'general-contractor' | 'trade';
export type SourceTag = '[O]' | '[3P]' | '[S]';

export interface KnownCompany {
  /** Display name for the report. */
  name: string;
  kind: KnownCompanyKind;
  /** Name forms accepted exactly (after companyKey). */
  forms: readonly string[];
  /** One line: where the legal or trade name was found. */
  source: string;
  tag: SourceTag;
}

const PB24 = 'Pro Builder 2024 Housing Giants rankings (probuilder.com PB-2024-Housing-Giants-Rankings.pdf, opened)';
const CNP = 'CenterPoint Energy Houston builder list (centerpointenergy.com Builder-List.pdf, opened)';
const BDC = 'BD+C Giants 300 top contractors (bdcnetwork.com, opened)';
const CD25 = 'Construction Dive "Top 10 home builders of 2025" (constructiondive.com, opened)';

export const KNOWN_COMPANIES: readonly KnownCompany[] = [
  // ---- Home builders -------------------------------------------------------------------------------------------------------------
  {
    name: 'D.R. Horton, Inc.',
    kind: 'homebuilder',
    forms: [
      'D.R. Horton, Inc.', 'D R Horton Inc', 'DR Horton Inc', 'D.R. Horton - Texas, Ltd.', 'DR Horton Texas Ltd', 'D.R. Horton - Georgia, LLC',
      'D.R. Horton - Houston, LLC', 'D.R. Horton, Inc. - Chicago', 'D.R. Horton - South', 'Continental Homes, Inc.', 'Continental Homes of Texas, L.P.',
    ],
    source: 'SEC EDGAR, HORTON D R INC /DE/ 10-K FY2025 Exhibit 21.1 subsidiaries (sec.gov a9302025ex211subsidiaries.htm, opened); "D.R. Horton - South" from ' + CNP,
    tag: '[O]',
  },
  { name: 'Lennar', kind: 'homebuilder', forms: ['Lennar Corporation', 'Lennar Corp', 'Lennar Homes', 'Lennar Homes LLC', 'Lennar Homes of Texas'], source: `${CD25} ("Lennar Corp."); ${CNP} ("Lennar Homes"); "Lennar Homes of Texas" (buildzoom title) and "Lennar Homes, LLC" (levelset URL) in search results`, tag: '[3P]' },
  { name: 'PulteGroup', kind: 'homebuilder', forms: ['PulteGroup', 'PulteGroup Inc', 'Pulte Homes'], source: `${PB24} ("PULTEGROUP"); ${CNP} ("Pulte Homes")`, tag: '[3P]' },
  { name: 'Toll Brothers', kind: 'homebuilder', forms: ['Toll Brothers', 'Toll Brothers Inc'], source: `${PB24}; ${CNP}`, tag: '[3P]' },
  { name: 'NVR', kind: 'homebuilder', forms: ['NVR Inc'], source: `${PB24} ("NVR"); ${CD25}`, tag: '[3P]' },
  { name: 'Taylor Morrison', kind: 'homebuilder', forms: ['Taylor Morrison Inc', 'Taylor Morrison Homes'], source: `${PB24} ("TAYLOR MORRISON"); "taylor-morrison-homes" (levelset URL) in search results; bare "Taylor Morrison" is a person's name shape (K2)`, tag: '[3P]' },
  { name: 'KB Home', kind: 'homebuilder', forms: ['KB Home'], source: `${PB24} ("KB HOME"); ${CD25}`, tag: '[3P]' },
  { name: 'Meritage Homes', kind: 'homebuilder', forms: ['Meritage Homes', 'Meritage Homes Corporation', 'Meritage Homes of Texas LLC'], source: `${PB24} ("MERITAGE HOMES"); ${CNP}; "meritage-homes-of-texas-llc" (levelset URL) in search results`, tag: '[3P]' },
  { name: 'M/I Homes', kind: 'homebuilder', forms: ['M/I Homes', 'M/I Homes Inc', 'M/I Homes of Houston LLC'], source: `${PB24} ("M/I HOMES"); ${CNP} ("M I Homes of Houston LLC")`, tag: '[3P]' },
  { name: 'Dream Finders Homes', kind: 'homebuilder', forms: ['Dream Finders Homes', 'Dream Finders Homes LLC'], source: PB24, tag: '[3P]' },
  { name: 'Tri Pointe Homes', kind: 'homebuilder', forms: ['Tri Pointe Homes', 'Tri Pointe Homes Inc'], source: PB24, tag: '[3P]' },
  { name: 'Century Communities', kind: 'homebuilder', forms: ['Century Communities', 'Century Communities Inc'], source: `${PB24}; ${CNP}`, tag: '[3P]' },
  { name: 'Ashton Woods Homes', kind: 'homebuilder', forms: ['Ashton Woods Homes'], source: `${CNP} ("Ashton Woods Homes"); bare "Ashton Woods" is a person's name shape (K2)`, tag: '[3P]' },
  { name: 'David Weekley Homes', kind: 'homebuilder', forms: ['David Weekley Homes'], source: `${PB24}; ${CNP}`, tag: '[3P]' },
  { name: 'Hovnanian Enterprises', kind: 'homebuilder', forms: ['Hovnanian Enterprises', 'Hovnanian Enterprises Inc'], source: PB24, tag: '[3P]' },
  { name: 'Shea Homes', kind: 'homebuilder', forms: ['Shea Homes'], source: `${PB24}; ${CNP}`, tag: '[3P]' },
  { name: 'Perry Homes', kind: 'homebuilder', forms: ['Perry Homes', 'Perry Homes LLC'], source: `${PB24}; ${CNP} ("Perry Homes, LLC")`, tag: '[3P]' },
  { name: 'LGI Homes', kind: 'homebuilder', forms: ['LGI Homes', 'LGI Homes Inc'], source: PB24, tag: '[3P]' },
  { name: 'Mattamy Homes', kind: 'homebuilder', forms: ['Mattamy Homes', 'Mattamy Homes US Group'], source: `${PB24} ("MATTAMY HOMES U.S. GROUP")`, tag: '[3P]' },
  { name: 'Beazer Homes', kind: 'homebuilder', forms: ['Beazer Homes', 'Beazer Homes Texas LP'], source: `${PB24}; ${CNP} ("Beazer Homes Texas LP")`, tag: '[3P]' },
  { name: 'Highland Homes', kind: 'homebuilder', forms: ['Highland Homes'], source: `${PB24}; ${CNP}`, tag: '[3P]' },
  { name: 'Stanley Martin Homes', kind: 'homebuilder', forms: ['Stanley Martin Homes'], source: `${PB24}; bare "Stanley Martin" is a person's name shape (K2)`, tag: '[3P]' },
  { name: 'GL Homes', kind: 'homebuilder', forms: ['GL Homes'], source: PB24, tag: '[3P]' },
  { name: 'Green Brick Partners', kind: 'homebuilder', forms: ['Green Brick Partners', 'Green Brick Partners Inc'], source: PB24, tag: '[3P]' },
  { name: 'Drees Homes', kind: 'homebuilder', forms: ['Drees Homes', 'Drees Custom Homes'], source: `${PB24}; ${CNP} ("Drees Custom Homes")`, tag: '[3P]' },
  { name: 'Brightland Homes (Gehan Homes)', kind: 'homebuilder', forms: ['Brightland Homes', 'Gehan Homes'], source: `${PB24} ("BRIGHTLAND HOMES (FKA GEHAN HOMES)"); ${CNP}`, tag: '[3P]' },
  { name: 'Brookfield Residential', kind: 'homebuilder', forms: ['Brookfield Residential', 'Brookfield Residential Properties'], source: PB24, tag: '[3P]' },
  { name: 'Bloomfield Homes', kind: 'homebuilder', forms: ['Bloomfield Homes'], source: PB24, tag: '[3P]' },
  { name: 'Chesmar Homes', kind: 'homebuilder', forms: ['Chesmar Homes', 'Chesmar Homes Ltd'], source: `${PB24}; ${CNP} ("Chesmar Homes, Ltd")`, tag: '[3P]' },
  { name: 'First Texas Homes', kind: 'homebuilder', forms: ['First Texas Homes'], source: `${PB24}; ${CNP}`, tag: '[3P]' },
  { name: 'Smith Douglas Homes', kind: 'homebuilder', forms: ['Smith Douglas Homes'], source: PB24, tag: '[3P]' },
  { name: 'Legend Homes', kind: 'homebuilder', forms: ['Legend Homes', 'Legend Homes Ltd'], source: `${PB24}; ${CNP} ("Legend Homes, Ltd")`, tag: '[3P]' },
  { name: 'Castlerock Communities', kind: 'homebuilder', forms: ['Castlerock Communities', 'Castlerock Communities LP'], source: `${PB24}; ${CNP} ("Castlerock Communities, LP")`, tag: '[3P]' },
  { name: 'Westin Homes', kind: 'homebuilder', forms: ['Westin Homes'], source: `${PB24}; ${CNP}`, tag: '[3P]' },
  { name: 'Darling Homes of Texas', kind: 'homebuilder', forms: ['Darling Homes of Texas LLC'], source: CNP, tag: '[3P]' },
  { name: 'Trendmaker Homes', kind: 'homebuilder', forms: ['Trendmaker Homes'], source: CNP, tag: '[3P]' },
  { name: 'Minto Communities', kind: 'homebuilder', forms: ['Minto Communities', 'Minto Communities USA'], source: PB24, tag: '[3P]' },
  { name: 'Harkins Builders', kind: 'homebuilder', forms: ['Harkins Builders', 'Harkins Builders Inc'], source: PB24, tag: '[3P]' },
  // ---- General contractors (commercial) ------------------------------------------------------------------------------------------
  { name: 'Turner Construction', kind: 'general-contractor', forms: ['Turner Construction Company', 'Turner Construction Co', 'Turner Construction'], source: BDC, tag: '[3P]' },
  { name: 'The Whiting-Turner Contracting Company', kind: 'general-contractor', forms: ['The Whiting-Turner Contracting Company', 'Whiting-Turner Contracting Company', 'Whiting-Turner Contracting Co'], source: `${BDC}; Wikipedia title "The Whiting-Turner Contracting Company" in search results`, tag: '[3P]' },
  { name: 'Skanska USA', kind: 'general-contractor', forms: ['Skanska USA', 'Skanska USA Building Inc'], source: BDC, tag: '[3P]' },
  { name: 'Gilbane Building Company', kind: 'general-contractor', forms: ['Gilbane Building Company', 'Gilbane Building Co'], source: BDC, tag: '[3P]' },
  { name: 'Structure Tone', kind: 'general-contractor', forms: ['Structure Tone', 'Structure Tone LLC'], source: BDC, tag: '[3P]' },
  { name: 'Clark Construction Group', kind: 'general-contractor', forms: ['Clark Construction Group', 'Clark Construction Group LLC'], source: `${BDC} ("Clark Group")`, tag: '[3P]' },
  { name: 'DPR Construction', kind: 'general-contractor', forms: ['DPR Construction'], source: BDC, tag: '[3P]' },
  { name: 'JE Dunn Construction', kind: 'general-contractor', forms: ['JE Dunn Construction', 'JE Dunn Construction Company'], source: BDC, tag: '[3P]' },
  { name: 'Hensel Phelps', kind: 'general-contractor', forms: ['Hensel Phelps Construction', 'Hensel Phelps Construction Co'], source: `${BDC}; bare "Hensel Phelps" is a person's name shape (K2)`, tag: '[3P]' },
  { name: 'Brasfield & Gorrie', kind: 'general-contractor', forms: ['Brasfield & Gorrie LLC'], source: `${BDC}; bare "Brasfield & Gorrie" reads to the rule like two people (K2)`, tag: '[3P]' },
  { name: 'Mortenson Construction', kind: 'general-contractor', forms: ['Mortenson Construction'], source: BDC, tag: '[3P]' },
  { name: 'Suffolk Construction', kind: 'general-contractor', forms: ['Suffolk Construction', 'Suffolk Construction Company'], source: BDC, tag: '[3P]' },
  { name: 'Holder Construction', kind: 'general-contractor', forms: ['Holder Construction', 'Holder Construction Company'], source: BDC, tag: '[3P]' },
  { name: 'Swinerton Builders', kind: 'general-contractor', forms: ['Swinerton Builders'], source: BDC, tag: '[3P]' },
  { name: 'Balfour Beatty US', kind: 'general-contractor', forms: ['Balfour Beatty US', 'Balfour Beatty Construction LLC'], source: `${BDC} ("Balfour Beatty US")`, tag: '[3P]' },
  { name: 'Manhattan Construction', kind: 'general-contractor', forms: ['Manhattan Construction', 'Manhattan Construction Company'], source: BDC, tag: '[3P]' },
  { name: 'HITT Contracting', kind: 'general-contractor', forms: ['HITT Contracting', 'HITT Contracting Inc'], source: BDC, tag: '[3P]' },
  { name: 'Austin Industries', kind: 'general-contractor', forms: ['Austin Industries', 'Austin Industries Inc'], source: BDC, tag: '[3P]' },
  { name: 'The Walsh Group', kind: 'general-contractor', forms: ['The Walsh Group', 'Walsh Group'], source: BDC, tag: '[3P]' },
  { name: 'Power Construction', kind: 'general-contractor', forms: ['Power Construction', 'Power Construction Company LLC'], source: BDC, tag: '[3P]' },
  { name: 'Clayco', kind: 'general-contractor', forms: ['Clayco Inc'], source: BDC, tag: '[3P]' },
  { name: 'Yates Companies', kind: 'general-contractor', forms: ['The Yates Companies', 'Yates Companies'], source: BDC, tag: '[3P]' },
  // ---- Trade contractors ---------------------------------------------------------------------------------------------------------
  {
    name: 'American Residential Services (ARS Rescue Rooter)',
    kind: 'trade',
    forms: ['American Residential Services LLC', 'ARS Rescue Rooter'],
    source: '"AMERICAN RESIDENTIAL SERVICES L.L.C. Trademarks" (justia) and "ARS-Rescue Rooter" (glassdoor, BBB, This Old House) titles in search results',
    tag: '[S]',
  },
];

/**
 * The key a name form is compared on: NFKC, accents folded, lower case, "&" read as "and", apostrophes dropped ("Lowe's" = "Lowes"),
 * periods, commas, hyphens and slashes read as spaces, spaces collapsed. Null for a value with an invisible or direction character, or
 * anything but ASCII letters, digits and spaces after that.
 */
export function companyKey(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 200) return null;
  if (/[​-‏‪-‮⁠-⁤⁦-⁩﻿­]/.test(raw)) return null;
  const s = foldName(raw.normalize('NFKC'))
    .replace(/[‘’´`']/g, '')
    .replace(/&/g, ' and ')
    .replace(/[.,\-‐-―/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^[a-z0-9 ]+$/.test(s) ? s : null;
}

const BY_KEY: ReadonlyMap<string, KnownCompany> = (() => {
  const m = new Map<string, KnownCompany>();
  for (const c of KNOWN_COMPANIES) for (const f of c.forms) {
    const k = companyKey(f);
    if (k) m.set(k, c);
  }
  return m;
})();

/** The listed company a string names exactly (after companyKey), or null. */
export function knownCompanyOf(raw: unknown): KnownCompany | null {
  const k = companyKey(raw);
  return k ? (BY_KEY.get(k) ?? null) : null;
}

/**
 * The string as it may be stored and shown (whitespace collapsed, accents folded) when it names a listed company exactly, else null.
 * Stable: knownCompanyName(knownCompanyName(x)) === knownCompanyName(x).
 */
export function knownCompanyName(raw: unknown): string | null {
  if (!knownCompanyOf(raw)) return null;
  const out = (raw as string).normalize('NFKC').replace(/\s+/g, ' ').trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return out.length >= 3 && out.length <= 120 ? out : null;
}
