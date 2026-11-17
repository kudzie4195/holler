/**
 * Who operates Holler, for legal pages, the site footer and email footers.
 * One place to change. The postal address is required in commercial email (CAN-SPAM).
 */
export const COMPANY = {
  brand: 'Holler',
  legalName: 'ColorLabPro, Inc.',
  entity: 'a Delaware corporation',
  addressLines: ['2535 Dallas Highway SW STE B #1036', 'Marietta, GA 30064', 'USA'],
  /** Single-line form for email footers. */
  addressLine: '2535 Dallas Highway SW STE B #1036, Marietta, GA 30064, USA',
  governingLaw: 'Delaware',
  site: 'localholler.com',
} as const;
