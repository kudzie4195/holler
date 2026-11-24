/**
 * Round 30: the hand-kept season table. One row per metro and seasonal window, so Holler can say "this week in your area" when a trade has
 * a predictable seasonal window here, even with no single public record behind it (lib/season/active.ts reads it).
 *
 * HOW TO EDIT A ROW. Dates are month-day strings, 'MM-DD', recurring every year. `start` and `end` are inclusive; a window whose end comes
 * before its start runs over the new year ('11-15' to '01-15'). `peak` is optional: rows are ordered by how close today is to it (the
 * window's midpoint when absent). After a fact-check, change the dates or text, then set `verifiedOn` to the day you checked and
 * `confidence` to 'checked' only when the window's anchor date comes from the source itself. tests/season/table.test.ts checks every row
 * on every edit (dates valid, EN and ES twins, wording rules, a source URL on every row).
 *
 * WORDING RULES (every `en` and `es`): a window is typical timing, never a fact about a property ("usually", "typically", "can"); weather
 * and pests never state damage as fact; never "lead"/"leads", "guaranteed", "you will win", "they need you", "knock doors"; no em dash.
 * Spanish in the usted form. The link under each line reads "Public source" / "Fuente pública" and opens `source`.
 *
 * Research behind the rows: /home/claude/gates/r30/SEASON.md (sections 3, 4, 5, 8, 12, 17), WX.md (2.12, 2.13), BIO.md (13), all as of
 * 2026-11-24. `confidence: 'estimate'` marks a window the research derived or assumed; 'checked' marks one whose anchor date the cited
 * source states. A separate fact-check of the dates may change them: edit here only, nothing else reads dates.
 */

/** The measured centres the season table covers (lib/check/cells.ts CENTRE_SOURCE ids; coordinates come from there, never from here). */
export type SeasonCentre = 'atlanta' | 'austin' | 'charlotte' | 'raleigh';

/** A month-day, 'MM-DD', recurring every year. */
export type MonthDay = `${'0' | '1'}${number}-${number}${number}`;

export type SeasonConfidence = 'checked' | 'estimate';

export interface SeasonRow {
  /** Unique, stable: `<topic>-<centre>`. */
  id: string;
  /** The event, shared by the same window in every metro. At most one line per topic is shown. */
  topic: 'gutters' | 'leaf-cleanup' | 'irrigation-winterize' | 'pre-emergent' | 'pollen' | 'fescue-seeding' | 'listing-prep';
  /** The measured centre this row belongs to (lib/check/cells.ts). The row applies within 25 miles of it. */
  centre: SeasonCentre;
  /** Holler trade ids (lib/signals/categories.ts). The "Pressure washing" chip reaches a row through cleaning or siding-gutters. */
  trades: readonly string[];
  /** Window, inclusive, 'MM-DD'. end < start wraps over the new year. */
  start: MonthDay;
  end: MonthDay;
  /** Optional peak inside the window, 'MM-DD'. */
  peak?: MonthDay;
  /** The card line, English and Spanish twins. Typical timing only. */
  en: string;
  es: string;
  /** The public page the line rests on. */
  source: string;
  /** Day the row was last checked against its source, 'YYYY-MM-DD'. */
  verifiedOn: string;
  confidence: SeasonConfidence;
}

// Sources (fetched or searched in the round 30 research, 2026-11-24).
const SRC = {
  ajcLeaves: 'https://www.ajc.com/arts-entertainment/2026/10/fall-leaves-in-georgia/',
  gspCold: 'https://www.weather.gov/gsp/cold',
  ncsuFrost: 'https://gardening.ces.ncsu.edu/weather-2-2/average-first-and-last-frost-dates/',
  ffcSeason: 'https://www.weather.gov/ffc/atlgroseason',
  ewxAustin: 'https://www.weather.gov/media/ewx/climate/ClimateSummary-ewx-Austin.pdf',
  ugaCrabgrass: 'https://site.extension.uga.edu/climate/2015/02/crabgrass-control-depends-on-soil-temperatures',
  ncsuPreemergent: 'https://www.turffiles.ncsu.edu/2024/02/when-to-apply-preemergent-herbicides-for-turfgrasses',
  agrilifePreemergent: 'https://agrilifetoday.tamu.edu/?p=308715',
  fox5Pollen: 'https://www.fox5atlanta.com/news/georgia-pollen-count-explained-seasonal-allergies',
  ncsuPinePollen: 'https://forestry.ces.ncsu.edu/news/pine-pollen-season',
  tamuCedar: 'https://stories.tamu.edu/news/2021/12/22/its-cedar-fever-season-in-texas/',
  ncsuFescue: 'https://www.turffiles.ncsu.edu/2025/09/time-for-fall-seeding-of-tall-fescue/',
  zillowList: 'https://www.zillow.com/research/best-time-to-list-2026-36162/',
} as const;

const R30 = '2026-11-24';

const GUTTERS = ['siding-gutters'] as const;
const LEAVES = ['landscaping', 'lawn-care'] as const;
const IRRIGATION = ['landscaping'] as const;
const LAWN = ['lawn-care', 'landscaping'] as const;
const POLLEN = ['cleaning', 'siding-gutters'] as const;
const LISTING = ['landscaping', 'cleaning'] as const;

export const SEASON_TABLE: readonly SeasonRow[] = [
  // Gutter clean-out after leaf drop. Window Nov 15 to Jan 15 (SEASON.md 5 and 17: drop Nov 10 to Dec 15, gutters Dec 1 to Jan 15, assumed).
  {
    id: 'gutters-atlanta', topic: 'gutters', centre: 'atlanta', trades: GUTTERS, start: '11-15', end: '01-15', peak: '12-01',
    en: 'Leaf drop around Atlanta usually winds down by late November. Gutter clean-outs are typically booked from mid-November to mid-January.',
    es: 'La caída de hojas en la zona de Atlanta suele terminar a fines de noviembre. Las limpiezas de canaletas se suelen programar desde mediados de noviembre hasta mediados de enero.',
    source: SRC.ajcLeaves, verifiedOn: R30, confidence: 'estimate',
  },
  {
    id: 'gutters-charlotte', topic: 'gutters', centre: 'charlotte', trades: GUTTERS, start: '11-15', end: '01-15', peak: '12-01',
    en: 'Leaf drop in Charlotte usually tapers off in late November and early December, a few weeks after the average first freeze. Gutter clean-outs are typically booked from mid-November to mid-January.',
    es: 'La caída de hojas en Charlotte suele disminuir a fines de noviembre y principios de diciembre, unas semanas después de la primera helada promedio. Las limpiezas de canaletas se suelen programar desde mediados de noviembre hasta mediados de enero.',
    source: SRC.gspCold, verifiedOn: R30, confidence: 'estimate',
  },
  {
    id: 'gutters-raleigh', topic: 'gutters', centre: 'raleigh', trades: GUTTERS, start: '11-15', end: '01-15', peak: '12-01',
    en: 'Leaf drop around Raleigh usually tapers off in late November and early December, a few weeks after the average first freeze. Gutter clean-outs are typically booked from mid-November to mid-January.',
    es: 'La caída de hojas en la zona de Raleigh suele disminuir a fines de noviembre y principios de diciembre, unas semanas después de la primera helada promedio. Las limpiezas de canaletas se suelen programar desde mediados de noviembre hasta mediados de enero.',
    source: SRC.ncsuFrost, verifiedOn: R30, confidence: 'estimate',
  },

  // Leaf clean-up. Window Nov 1 to Dec 15 (SEASON.md 5, WX.md 2.13: drop dates assumed; Atlanta peak color first two weeks of Nov, checked).
  {
    id: 'leaf-cleanup-atlanta', topic: 'leaf-cleanup', centre: 'atlanta', trades: LEAVES, start: '11-01', end: '12-15', peak: '11-20',
    en: 'Fall leaf drop around Atlanta typically runs from early November into mid-December, with most leaves down by late November. Leaf clean-ups are usually booked in that window.',
    es: 'La caída de hojas de otoño en la zona de Atlanta suele ir de principios de noviembre a mediados de diciembre, y la mayoría de las hojas cae antes de fines de noviembre. Las limpiezas de hojas se suelen programar en esas semanas.',
    source: SRC.ajcLeaves, verifiedOn: R30, confidence: 'estimate',
  },
  {
    id: 'leaf-cleanup-charlotte', topic: 'leaf-cleanup', centre: 'charlotte', trades: LEAVES, start: '11-01', end: '12-15', peak: '11-20',
    en: 'Fall leaf drop around Charlotte typically runs from early November into mid-December, after the average first freeze in early November. Leaf clean-ups are usually booked in that window.',
    es: 'La caída de hojas de otoño en la zona de Charlotte suele ir de principios de noviembre a mediados de diciembre, después de la primera helada promedio a principios de noviembre. Las limpiezas de hojas se suelen programar en esas semanas.',
    source: SRC.gspCold, verifiedOn: R30, confidence: 'estimate',
  },
  {
    id: 'leaf-cleanup-raleigh', topic: 'leaf-cleanup', centre: 'raleigh', trades: LEAVES, start: '11-01', end: '12-15', peak: '11-20',
    en: 'Fall leaf drop around Raleigh typically runs from early November into mid-December, after the average first freeze in late October. Leaf clean-ups are usually booked in that window.',
    es: 'La caída de hojas de otoño en la zona de Raleigh suele ir de principios de noviembre a mediados de diciembre, después de la primera helada promedio a fines de octubre. Las limpiezas de hojas se suelen programar en esas semanas.',
    source: SRC.ncsuFrost, verifiedOn: R30, confidence: 'estimate',
  },

  // Irrigation winterizing: the weeks around the average first fall freeze (SEASON.md 3b checked averages; window derived, so estimate).
  {
    id: 'irrigation-winterize-atlanta', topic: 'irrigation-winterize', centre: 'atlanta', trades: IRRIGATION, start: '11-03', end: '11-20', peak: '11-13',
    en: 'The average first freeze in Atlanta comes around November 13. Freezing temperatures can affect exposed sprinkler parts, so irrigation winterizing is typically booked in the weeks around it.',
    es: 'La primera helada promedio en Atlanta llega alrededor del 13 de noviembre. Las temperaturas bajo cero pueden afectar las partes expuestas del riego, por eso la preparación del riego para el invierno se suele programar en las semanas cercanas.',
    source: SRC.ffcSeason, verifiedOn: R30, confidence: 'estimate',
  },
  {
    id: 'irrigation-winterize-charlotte', topic: 'irrigation-winterize', centre: 'charlotte', trades: IRRIGATION, start: '10-27', end: '11-15', peak: '11-07',
    en: 'The average first freeze in Charlotte comes around November 5 to 8. Freezing temperatures can affect exposed sprinkler parts, so irrigation winterizing is typically booked in the weeks around it.',
    es: 'La primera helada promedio en Charlotte llega alrededor del 5 al 8 de noviembre. Las temperaturas bajo cero pueden afectar las partes expuestas del riego, por eso la preparación del riego para el invierno se suele programar en las semanas cercanas.',
    source: SRC.gspCold, verifiedOn: R30, confidence: 'estimate',
  },
  {
    id: 'irrigation-winterize-raleigh', topic: 'irrigation-winterize', centre: 'raleigh', trades: IRRIGATION, start: '10-20', end: '11-06', peak: '10-30',
    en: 'The average first freeze in Raleigh comes around October 30. Freezing temperatures can affect exposed sprinkler parts, so irrigation winterizing is typically booked in the weeks around it.',
    es: 'La primera helada promedio en Raleigh llega alrededor del 30 de octubre. Las temperaturas bajo cero pueden afectar las partes expuestas del riego, por eso la preparación del riego para el invierno se suele programar en las semanas cercanas.',
    source: SRC.ncsuFrost, verifiedOn: R30, confidence: 'estimate',
  },
  {
    id: 'irrigation-winterize-austin', topic: 'irrigation-winterize', centre: 'austin', trades: IRRIGATION, start: '11-21', end: '12-08', peak: '12-01',
    en: 'The average first freeze in Austin comes around December 1. Freezing temperatures can affect exposed sprinkler parts, so irrigation winterizing is typically booked in the weeks around it.',
    es: 'La primera helada promedio en Austin llega alrededor del 1 de diciembre. Las temperaturas bajo cero pueden afectar las partes expuestas del riego, por eso la preparación del riego para el invierno se suele programar en las semanas cercanas.',
    source: SRC.ewxAustin, verifiedOn: R30, confidence: 'estimate',
  },

  // Spring pre-emergent (SEASON.md 3a, BIO.md 13: Atlanta Mar 1 UGA and Raleigh end of February NC State checked; Charlotte (Piedmont,
  // not named) and Austin (55F rule, no calendar date) estimates).
  {
    id: 'pre-emergent-atlanta', topic: 'pre-emergent', centre: 'atlanta', trades: LAWN, start: '02-15', end: '03-15', peak: '03-01',
    en: 'University of Georgia guidance puts spring pre-emergent timing around Atlanta near March 1, when soil near the surface typically reaches about 52°F. Timing can shift with the weather.',
    es: 'La guía de la Universidad de Georgia ubica el momento del preemergente de primavera en la zona de Atlanta cerca del 1 de marzo, cuando el suelo cerca de la superficie suele llegar a unos 52 °F. Las fechas pueden cambiar con el clima.',
    source: SRC.ugaCrabgrass, verifiedOn: R30, confidence: 'checked',
  },
  {
    id: 'pre-emergent-charlotte', topic: 'pre-emergent', centre: 'charlotte', trades: LAWN, start: '02-20', end: '03-20', peak: '03-05',
    en: 'NC State guidance for the Piedmont typically points to very early March for spring pre-emergent. Timing around Charlotte can shift with the weather.',
    es: 'La guía de NC State para el Piedmont suele indicar los primeros días de marzo para el preemergente de primavera. Las fechas en la zona de Charlotte pueden cambiar con el clima.',
    source: SRC.ncsuPreemergent, verifiedOn: R30, confidence: 'estimate',
  },
  {
    id: 'pre-emergent-raleigh', topic: 'pre-emergent', centre: 'raleigh', trades: LAWN, start: '02-10', end: '03-10', peak: '02-25',
    en: 'NC State guidance puts spring pre-emergent timing around Raleigh near the end of February in a typical year. Timing can shift with the weather.',
    es: 'La guía de NC State ubica el momento del preemergente de primavera en la zona de Raleigh cerca de fines de febrero en un año típico. Las fechas pueden cambiar con el clima.',
    source: SRC.ncsuPreemergent, verifiedOn: R30, confidence: 'checked',
  },
  {
    id: 'pre-emergent-austin', topic: 'pre-emergent', centre: 'austin', trades: LAWN, start: '02-01', end: '03-01', peak: '02-15',
    en: 'Texas A&M AgriLife ties spring pre-emergent timing to soil near 55°F, often around when redbuds bloom. Around Austin that is typically February, and it can shift with the weather.',
    es: 'Texas A&M AgriLife relaciona el momento del preemergente de primavera con un suelo cerca de 55 °F, a menudo cuando florecen los árboles redbud. En la zona de Austin suele ser en febrero, y puede cambiar con el clima.',
    source: SRC.agrilifePreemergent, verifiedOn: R30, confidence: 'estimate',
  },

  // Pine and tree pollen wash season, Mar 15 to Apr 25 (WX.md 2.12: window assumed from checked peaks). Austin mountain cedar, Dec 15 to
  // Mar 1, cleaning only (stories.tamu.edu, checked: mid-December start, mid-January peak, tapering toward early March).
  {
    id: 'pollen-atlanta', topic: 'pollen', centre: 'atlanta', trades: POLLEN, start: '03-15', end: '04-25', peak: '03-30',
    en: 'Tree pollen around Atlanta usually peaks from late March to mid-April. Pollen can leave a yellow film on decks, siding and cars, and spring washes are typically booked from mid-March through April.',
    es: 'El polen de los árboles en la zona de Atlanta suele alcanzar su punto máximo de fines de marzo a mediados de abril. El polen puede dejar una capa amarilla en terrazas, revestimientos y autos, y los lavados de primavera se suelen programar de mediados de marzo hasta abril.',
    source: SRC.fox5Pollen, verifiedOn: R30, confidence: 'estimate',
  },
  {
    id: 'pollen-charlotte', topic: 'pollen', centre: 'charlotte', trades: POLLEN, start: '03-15', end: '04-25', peak: '03-31',
    en: 'Pine pollen in North Carolina typically peaks from late March into early April. Pollen can leave a yellow film on decks, siding and cars, and spring washes around Charlotte are typically booked from mid-March through April.',
    es: 'El polen de pino en Carolina del Norte suele alcanzar su punto máximo de fines de marzo a principios de abril. El polen puede dejar una capa amarilla en terrazas, revestimientos y autos, y los lavados de primavera en la zona de Charlotte se suelen programar de mediados de marzo hasta abril.',
    source: SRC.ncsuPinePollen, verifiedOn: R30, confidence: 'estimate',
  },
  {
    id: 'pollen-raleigh', topic: 'pollen', centre: 'raleigh', trades: POLLEN, start: '03-15', end: '04-25', peak: '03-31',
    en: 'Pine pollen in North Carolina typically peaks from late March into early April. Pollen can leave a yellow film on decks, siding and cars, and spring washes around Raleigh are typically booked from mid-March through April.',
    es: 'El polen de pino en Carolina del Norte suele alcanzar su punto máximo de fines de marzo a principios de abril. El polen puede dejar una capa amarilla en terrazas, revestimientos y autos, y los lavados de primavera en la zona de Raleigh se suelen programar de mediados de marzo hasta abril.',
    source: SRC.ncsuPinePollen, verifiedOn: R30, confidence: 'estimate',
  },
  {
    id: 'pollen-austin', topic: 'pollen', centre: 'austin', trades: ['cleaning'], start: '12-15', end: '03-01', peak: '01-15',
    en: 'Mountain cedar pollen season around Austin typically starts in mid-December and peaks in mid-January. Pollen can leave a dusty film on cars and outdoor surfaces through the winter.',
    es: 'La temporada de polen de cedro de montaña en la zona de Austin suele empezar a mediados de diciembre y alcanzar su punto máximo a mediados de enero. El polen puede dejar una capa de polvo en autos y superficies exteriores durante el invierno.',
    source: SRC.tamuCedar, verifiedOn: R30, confidence: 'checked',
  },

  // Fall fescue seeding, Sep 1 to Oct 15 (NC State TurfFiles: seed down by mid-October, soil above 60F; checked for NC, assumed for Atlanta).
  {
    id: 'fescue-seeding-atlanta', topic: 'fescue-seeding', centre: 'atlanta', trades: LAWN, start: '09-01', end: '10-15', peak: '09-20',
    en: 'Fall seeding of tall fescue lawns around Atlanta is typically done from September to mid-October. NC State guidance notes the seed needs soil above about 60°F to sprout.',
    es: 'La siembra de otoño del césped tall fescue en la zona de Atlanta se suele hacer de septiembre a mediados de octubre. La guía de NC State indica que la semilla necesita un suelo por encima de unos 60 °F para germinar.',
    source: SRC.ncsuFescue, verifiedOn: R30, confidence: 'estimate',
  },
  {
    id: 'fescue-seeding-charlotte', topic: 'fescue-seeding', centre: 'charlotte', trades: LAWN, start: '09-01', end: '10-15', peak: '09-20',
    en: 'NC State guidance says tall fescue seed should typically be down by mid-October, while soil is above about 60°F. Fall seeding around Charlotte is usually booked from September to mid-October.',
    es: 'La guía de NC State indica que la semilla de tall fescue normalmente debe estar sembrada a mediados de octubre, mientras el suelo está por encima de unos 60 °F. La siembra de otoño en la zona de Charlotte se suele programar de septiembre a mediados de octubre.',
    source: SRC.ncsuFescue, verifiedOn: R30, confidence: 'checked',
  },
  {
    id: 'fescue-seeding-raleigh', topic: 'fescue-seeding', centre: 'raleigh', trades: LAWN, start: '09-01', end: '10-15', peak: '09-20',
    en: 'NC State guidance says tall fescue seed should typically be down by mid-October, while soil is above about 60°F. Fall seeding around Raleigh is usually booked from September to mid-October.',
    es: 'La guía de NC State indica que la semilla de tall fescue normalmente debe estar sembrada a mediados de octubre, mientras el suelo está por encima de unos 60 °F. La siembra de otoño en la zona de Raleigh se suele programar de septiembre a mediados de octubre.',
    source: SRC.ncsuFescue, verifiedOn: R30, confidence: 'checked',
  },

  // Home-listing season prep (SEASON.md 12: Zillow best time to list checked; prep window assumed).
  {
    id: 'listing-prep-atlanta', topic: 'listing-prep', centre: 'atlanta', trades: LISTING, start: '04-15', end: '05-15', peak: '05-01',
    en: "Zillow's analysis of 2025 sales points to the first two weeks of May as the best time to list a home in Atlanta. Homes are often prepped for sale with yard work and exterior washes in the weeks before.",
    es: 'El análisis de Zillow de las ventas de 2025 señala las dos primeras semanas de mayo como el mejor momento para poner una casa a la venta en Atlanta. Las casas a menudo se preparan para la venta con trabajo de jardín y lavado exterior en las semanas previas.',
    source: SRC.zillowList, verifiedOn: R30, confidence: 'estimate',
  },
  {
    id: 'listing-prep-charlotte', topic: 'listing-prep', centre: 'charlotte', trades: LISTING, start: '04-15', end: '05-15', peak: '05-01',
    en: "Zillow's analysis of 2025 sales points to the first two weeks of May as the best time to list a home in Charlotte. Homes are often prepped for sale with yard work and exterior washes in the weeks before.",
    es: 'El análisis de Zillow de las ventas de 2025 señala las dos primeras semanas de mayo como el mejor momento para poner una casa a la venta en Charlotte. Las casas a menudo se preparan para la venta con trabajo de jardín y lavado exterior en las semanas previas.',
    source: SRC.zillowList, verifiedOn: R30, confidence: 'estimate',
  },
  {
    id: 'listing-prep-austin', topic: 'listing-prep', centre: 'austin', trades: LISTING, start: '03-01', end: '03-31', peak: '03-20',
    en: "Zillow's analysis of 2025 sales points to the last two weeks of March as the best time to list a home in Austin. Homes are often prepped for sale with yard work and exterior washes in the weeks before.",
    es: 'El análisis de Zillow de las ventas de 2025 señala las dos últimas semanas de marzo como el mejor momento para poner una casa a la venta en Austin. Las casas a menudo se preparan para la venta con trabajo de jardín y lavado exterior en las semanas previas.',
    source: SRC.zillowList, verifiedOn: R30, confidence: 'estimate',
  },
];
