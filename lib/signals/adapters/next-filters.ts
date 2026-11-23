/**
 * Round 20 (NEXT): row filters of the Texas and new-business feeds (socrata-datasets.ts / arcgis-datasets.ts `keepRow`). No imports, so the
 * dataset config modules can use them without an import cycle. Pure.
 */

/**
 * A company form, not a person (Texas Comptroller "Taxpayer Organizational Type", TABC ownership type; values ASSUMED, not read live).
 * Fails closed: blank, unknown, sole owner, individual or a general partnership of people is false. Spelled forms are matched by words; the
 * two-letter Comptroller codes are a short ASSUMED list (CT Texas profit corporation, CF foreign profit corporation, CL Texas LLC, CI foreign
 * LLC, CN non-profit corporation, PL limited partnership, PF foreign limited partnership, LP / LLP).
 */
export function isCompanyForm(raw: string): boolean {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/\b(?:sole|individual|proprietor(?:ship)?|person|natural|husband|wife|estate of|general partnership|joint venture)\b/i.test(t)) return false;
  if (/^(?:CT|CF|CL|CI|CN|PL|PF|LP|LLP|LLC|PLLC|INC|CORP)$/i.test(t)) return true;
  return /\b(?:corporation|corp|incorporated|inc|limited liability|llc|l\.l\.c\.|limited partnership|llp|pllc|professional association|professional corporation|company|co-?op(?:erative)?|non-?profit)\b/i.test(t);
}

/**
 * NAICS codes of a STOREFRONT (a premises the public walks into, not a home office): 722 food service and drinking places, 44 and 45 retail,
 * 811 repair, 812 personal services (scout, [A]). Anything else, or a code that is not 3 to 6 digits, is false.
 */
export function isStorefrontNaics(raw: string): boolean {
  const c = raw.replace(/\s+/g, '');
  if (!/^\d{3,6}$/.test(c)) return false;
  return /^(?:722|44|45|811|812)/.test(c);
}

/** NAICS 722 (food service and drinking places): the only new businesses that are a pest-control heads-up. */
export function isFoodNaics(raw: string): boolean {
  return /^722/.test(raw.replace(/\s+/g, ''));
}
