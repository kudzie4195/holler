/**
 * Round 30: the hand-kept season table. One row per metro and seasonal window, so Holler can say "this week in your area" when a trade has
 * a predictable seasonal window here, even with no single public record behind it (lib/season/active.ts reads it).
 *
 * HOW TO EDIT A ROW. Dates are month-day strings, 'MM-DD', recurring every year. `start` and `end` are inclusive; a window whose end comes
 * before its start runs over the new year ('11-15' to '01-15'). `peak` is optional: rows are ordered by how close today is to it (the
 * window's midpoint when absent). After a fact-check, change the dates or text, then set `verifiedOn` to the day you checked and
 * `confidence` by the one rule below. tests/season/table.test.ts checks every row on every edit (dates valid, EN and ES twins, wording
 * rules, a source URL on every row, the confidence of every row).
 *
 * CONFIDENCE, ONE RULE. A row's anchor is the dated event its window is built on (the first freeze, the pre-emergent date, the pollen
 * peak, the seeding window). 'checked' only when the cited source itself states that anchor date as usual timing (not a one-year
 * forecast, not one year's sales), either for the metro by name or for a region it names explicitly that contains the metro (North
 * Georgia, North Carolina, the Piedmont, central North Carolina, Central Texas, Williamson County in the Austin metro). Window edges
 * Holler sets around a checked anchor do not change the label. Everything else is 'estimate': a window Holler builds on an event the
 * source does not date that way (gutters after the last leaf drop, leaf clean-ups after peak color, listing prep before one year's best
 * listing weeks), and such a line says "Holler estimates" / "Holler estima" for its booking or service window.
 *
 * WORDING RULES (every `en` and `es`): a window is typical timing, never a fact about a property ("usually", "typically", "can"); weather
 * and pests never state damage as fact; never "lead"/"leads", "guaranteed", "you will win", "they need you", "knock doors"; no em dash.
 * Spanish in the usted form. The link under each line reads "Public source" / "Fuente pública" and opens `source`.
 *
 * Research behind the rows: /home/claude/gates/r30/SEASON.md (sections 3, 4, 5, 8, 12, 17), WX.md (2.12, 2.13), BIO.md (13), and the
 * independent date check /home/claude/gates/r30/review/VERIFY.md, all as of 2026-11-24 (VERIFY.md's corrections are applied: fescue
 * Sep 1 to Oct 1 in the NC Piedmont, pre-emergent by end of February in Raleigh and mid-February near Austin, Charlotte first freeze
 * Nov 5, Raleigh leaf window Oct 25 to Dec 10, no "leaves mostly down by late November", the gutter window as Holler's own estimate).
 * Edit dates here only: nothing else reads them.
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

// Sources (fetched or searched in the round 30 research and checked again in review/VERIFY.md, 2026-11-24).
const SRC = {
  almanacLeafDrop: 'https://www.farmersalmanac.com/?p=442638',
  ajcLeaves: 'https://www.ajc.com/arts-entertainment/2026/10/fall-leaves-in-georgia/',
  aolCharlotteLeaves: 'https://www.aol.com/timeline-fall-colors-peak-nc-195057785.html',
  ncsuFoliage: 'https://cnr.ncsu.edu/news/2023/09/foliage-north-carolina',
  ncsuFrost: 'https://gardening.ces.ncsu.edu/weather-2-2/average-first-and-last-frost-dates/',
  ffcFrost: 'https://www.weather.gov/ffc/frostfreeze',
  ewxAustin: 'https://www.weather.gov/media/ewx/climate/ClimateSummary-ewx-Austin.pdf',
  ugaCrabgrass: 'https://site.extension.uga.edu/climate/2015/02/crabgrass-control-depends-on-soil-temperatures/',
  ncsuPreemergent: 'https://www.turffiles.ncsu.edu/2024/02/when-to-apply-preemergent-herbicides-for-turfgrasses',
  agrilifeWilliamson: 'https://williamson.agrilife.org/?p=6965',
  fox5Pollen: 'https://www.fox5atlanta.com/news/georgia-pollen-count-explained-seasonal-allergies',
  ncsuPinePollen: 'https://forestry.ces.ncsu.edu/news/pine-pollen-season',
  tamuCedar: 'https://stories.tamu.edu/news/2021/12/22/its-cedar-fever-season-in-texas/',
  ncsuCarolinaLawns: 'https://content.ces.ncsu.edu/carolina-lawns',
  ugaLawnsB1533: 'https://fieldreport.caes.uga.edu/publications/B1533-2/lawns-in-georgia-establishment/',
  zillowList: 'https://www.zillow.com/research/best-time-to-list-2026-36162/',
} as const;

/** Day the rows were last checked against their sources (review/VERIFY.md). */
const R30 = '2026-11-24';

const GUTTERS = ['siding-gutters'] as const;
const LEAVES = ['landscaping', 'lawn-care'] as const;
const IRRIGATION = ['landscaping'] as const;
const LAWN = ['lawn-care', 'landscaping'] as const;
const POLLEN = ['cleaning', 'siding-gutters'] as const;
const LISTING = ['landscaping', 'cleaning'] as const;

export const SEASON_TABLE: readonly SeasonRow[] = [
  // Gutter clean-out after leaf drop, Nov 15 to Jan 15. Holler's own estimate, and the line says so: no source states this window
  // (VERIFY.md 2f, review D1). The line
  // rests on the Farmers' Almanac final major leaf drop (Georgia late November to December, North Carolina mid-November to December).
  {
    id: 'gutters-atlanta', topic: 'gutters', centre: 'atlanta', trades: GUTTERS, start: '11-15', end: '01-15', peak: '12-01',
    en: 'In Georgia, the last big leaf drop usually comes from late November into December. Holler estimates that around Atlanta, gutter clean-outs are usually booked from mid-November to mid-January.',
    es: 'En Georgia, la última gran caída de hojas suele llegar de fines de noviembre a diciembre. Holler estima que, en la zona de Atlanta, las limpiezas de canaletas se suelen programar desde mediados de noviembre hasta mediados de enero.',
    source: SRC.almanacLeafDrop, verifiedOn: R30, confidence: 'estimate',
  },
  {
    id: 'gutters-charlotte', topic: 'gutters', centre: 'charlotte', trades: GUTTERS, start: '11-15', end: '01-15', peak: '12-01',
    en: 'In North Carolina, the last big leaf drop usually comes from mid-November into December. Holler estimates that around Charlotte, gutter clean-outs are usually booked from mid-November to mid-January.',
    es: 'En Carolina del Norte, la última gran caída de hojas suele llegar de mediados de noviembre a diciembre. Holler estima que, en la zona de Charlotte, las limpiezas de canaletas se suelen programar desde mediados de noviembre hasta mediados de enero.',
    source: SRC.almanacLeafDrop, verifiedOn: R30, confidence: 'estimate',
  },
  {
    id: 'gutters-raleigh', topic: 'gutters', centre: 'raleigh', trades: GUTTERS, start: '11-15', end: '01-15', peak: '12-01',
    en: 'In North Carolina, the last big leaf drop usually comes from mid-November into December. Holler estimates that around Raleigh, gutter clean-outs are usually booked from mid-November to mid-January.',
    es: 'En Carolina del Norte, la última gran caída de hojas suele llegar de mediados de noviembre a diciembre. Holler estima que, en la zona de Raleigh, las limpiezas de canaletas se suelen programar desde mediados de noviembre hasta mediados de enero.',
    source: SRC.almanacLeafDrop, verifiedOn: R30, confidence: 'estimate',
  },

  // Leaf clean-up: Atlanta and Charlotte Nov 1 to Dec 15, Raleigh Oct 25 to Dec 10 (VERIFY.md 2a to 2e). Peak color is the source's;
  // the clean-up window is Holler's own estimate (no cited page dates the leaf fall after it), and the line says so (review D2).
  {
    id: 'leaf-cleanup-atlanta', topic: 'leaf-cleanup', centre: 'atlanta', trades: LEAVES, start: '11-01', end: '12-15', peak: '11-20',
    en: 'Fall color in the lower areas of Georgia usually peaks in the first two weeks of November. Holler estimates that leaf clean-ups around Atlanta are typically booked from November to mid-December.',
    es: 'Los colores de otoño en las zonas bajas de Georgia suelen llegar a su punto máximo en las dos primeras semanas de noviembre. Holler estima que, en la zona de Atlanta, las limpiezas de hojas se suelen programar de noviembre a mediados de diciembre.',
    source: SRC.ajcLeaves, verifiedOn: R30, confidence: 'estimate',
  },
  {
    id: 'leaf-cleanup-charlotte', topic: 'leaf-cleanup', centre: 'charlotte', trades: LEAVES, start: '11-01', end: '12-15', peak: '11-20',
    en: 'Fall color around Charlotte is usually brightest in early to mid-November. Holler estimates that leaf clean-ups are typically booked from November to mid-December.',
    es: 'Los colores de otoño en la zona de Charlotte suelen estar en su mejor momento de principios a mediados de noviembre. Holler estima que las limpiezas de hojas se suelen programar de noviembre a mediados de diciembre.',
    source: SRC.aolCharlotteLeaves, verifiedOn: R30, confidence: 'estimate',
  },
  {
    id: 'leaf-cleanup-raleigh', topic: 'leaf-cleanup', centre: 'raleigh', trades: LEAVES, start: '10-25', end: '12-10', peak: '11-12',
    en: 'NC State says peak fall color usually reaches the Piedmont from late October to early November. Holler estimates that leaf clean-ups around Raleigh are typically booked from late October to early December.',
    es: 'NC State indica que los colores de otoño suelen llegar a su punto máximo en el Piedmont de fines de octubre a principios de noviembre. Holler estima que, en la zona de Raleigh, las limpiezas de hojas se suelen programar de fines de octubre a principios de diciembre.',
    source: SRC.ncsuFoliage, verifiedOn: R30, confidence: 'estimate',
  },

  // Irrigation winterizing: the weeks around the average first fall freeze. Each source states the freeze date for the metro's own
  // station (VERIFY.md 1b, 1d, 1e, 1f), so checked; the weeks around it are Holler's edges.
  {
    id: 'irrigation-winterize-atlanta', topic: 'irrigation-winterize', centre: 'atlanta', trades: IRRIGATION, start: '11-03', end: '11-20', peak: '11-13',
    en: 'The average first freeze in Atlanta comes around November 13. Freezing temperatures can affect exposed sprinkler parts, so irrigation winterizing is typically booked in the weeks around it.',
    es: 'La primera helada promedio en Atlanta llega alrededor del 13 de noviembre. Las temperaturas bajo cero pueden afectar las partes expuestas del riego, por eso la preparación del riego para el invierno se suele programar en las semanas cercanas.',
    source: SRC.ffcFrost, verifiedOn: R30, confidence: 'checked',
  },
  {
    id: 'irrigation-winterize-charlotte', topic: 'irrigation-winterize', centre: 'charlotte', trades: IRRIGATION, start: '10-26', end: '11-13', peak: '11-05',
    en: 'The average first freeze in Charlotte comes around November 5. Freezing temperatures can affect exposed sprinkler parts, so irrigation winterizing is typically booked in the weeks around it.',
    es: 'La primera helada promedio en Charlotte llega alrededor del 5 de noviembre. Las temperaturas bajo cero pueden afectar las partes expuestas del riego, por eso la preparación del riego para el invierno se suele programar en las semanas cercanas.',
    source: SRC.ncsuFrost, verifiedOn: R30, confidence: 'checked',
  },
  {
    id: 'irrigation-winterize-raleigh', topic: 'irrigation-winterize', centre: 'raleigh', trades: IRRIGATION, start: '10-20', end: '11-06', peak: '10-30',
    en: 'The average first freeze in Raleigh comes around October 30. Freezing temperatures can affect exposed sprinkler parts, so irrigation winterizing is typically booked in the weeks around it.',
    es: 'La primera helada promedio en Raleigh llega alrededor del 30 de octubre. Las temperaturas bajo cero pueden afectar las partes expuestas del riego, por eso la preparación del riego para el invierno se suele programar en las semanas cercanas.',
    source: SRC.ncsuFrost, verifiedOn: R30, confidence: 'checked',
  },
  {
    id: 'irrigation-winterize-austin', topic: 'irrigation-winterize', centre: 'austin', trades: IRRIGATION, start: '11-21', end: '12-08', peak: '12-01',
    en: 'The average first freeze in Austin comes around December 1. Freezing temperatures can affect exposed sprinkler parts, so irrigation winterizing is typically booked in the weeks around it.',
    es: 'La primera helada promedio en Austin llega alrededor del 1 de diciembre. Las temperaturas bajo cero pueden afectar las partes expuestas del riego, por eso la preparación del riego para el invierno se suele programar en las semanas cercanas.',
    source: SRC.ewxAustin, verifiedOn: R30, confidence: 'checked',
  },

  // Spring pre-emergent (VERIFY.md 4a, 4b, 4d), all checked: Atlanta Mar 1 at 52F (a UGA climate blog post, 2015, Atlanta named);
  // Raleigh by end of February in central NC and Charlotte very early March in the central and western Piedmont at 55F (NC State, the
  // regions named); Austin by mid-February (AgriLife Williamson County, which is part of the Austin metro).
  {
    id: 'pre-emergent-atlanta', topic: 'pre-emergent', centre: 'atlanta', trades: LAWN, start: '02-15', end: '03-15', peak: '03-01',
    en: 'A University of Georgia climate blog post puts spring pre-emergent timing around Atlanta near March 1, when soil near the surface typically reaches about 52°F. Timing can shift with the weather.',
    es: 'Una publicación del blog de clima de la Universidad de Georgia ubica el momento del preemergente de primavera en la zona de Atlanta cerca del 1 de marzo, cuando el suelo cerca de la superficie suele llegar a unos 52 °F. Las fechas pueden cambiar con el clima.',
    source: SRC.ugaCrabgrass, verifiedOn: R30, confidence: 'checked',
  },
  {
    id: 'pre-emergent-charlotte', topic: 'pre-emergent', centre: 'charlotte', trades: LAWN, start: '02-15', end: '03-10', peak: '03-01',
    en: 'NC State guidance for the central and western Piedmont typically points to very early March for spring pre-emergent, when soil holds near 55°F for a few days. Timing around Charlotte can shift with the weather.',
    es: 'La guía de NC State para el centro y el oeste del Piedmont suele indicar los primeros días de marzo para el preemergente de primavera, cuando el suelo se mantiene cerca de 55 °F por unos días. Las fechas en la zona de Charlotte pueden cambiar con el clima.',
    source: SRC.ncsuPreemergent, verifiedOn: R30, confidence: 'checked',
  },
  {
    id: 'pre-emergent-raleigh', topic: 'pre-emergent', centre: 'raleigh', trades: LAWN, start: '02-01', end: '02-28', peak: '02-20',
    en: 'NC State guidance says spring pre-emergent in central North Carolina is typically applied by the end of February, before soil holds near 55°F. Timing around Raleigh can shift with the weather.',
    es: 'La guía de NC State indica que el preemergente de primavera en el centro de Carolina del Norte se suele aplicar antes de fines de febrero, antes de que el suelo se mantenga cerca de 55 °F. Las fechas en la zona de Raleigh pueden cambiar con el clima.',
    source: SRC.ncsuPreemergent, verifiedOn: R30, confidence: 'checked',
  },
  {
    id: 'pre-emergent-austin', topic: 'pre-emergent', centre: 'austin', trades: LAWN, start: '01-25', end: '02-15', peak: '02-08',
    en: 'Texas A&M AgriLife in nearby Williamson County advises putting out spring pre-emergent by mid-February. Timing around Austin can shift with the weather.',
    es: 'Texas A&M AgriLife en el vecino condado de Williamson aconseja aplicar el preemergente de primavera antes de mediados de febrero. Las fechas en la zona de Austin pueden cambiar con el clima.',
    source: SRC.agrilifeWilliamson, verifiedOn: R30, confidence: 'checked',
  },

  // Pine and tree pollen wash season, Mar 15 to Apr 25, all checked: the peak is stated for North Georgia and metro Atlanta (FOX 5) and
  // for North Carolina (NC State), VERIFY.md 3a to 3c; the wash window around it is Holler's edges. Austin mountain cedar, Dec 15 to
  // Mar 1, Central Texas (VERIFY.md 3d).
  {
    id: 'pollen-atlanta', topic: 'pollen', centre: 'atlanta', trades: POLLEN, start: '03-15', end: '04-25', peak: '03-30',
    en: 'Tree pollen around Atlanta usually peaks from late March to mid-April. Pollen can leave a yellow film on decks, siding and cars, and spring washes are typically booked from mid-March through April.',
    es: 'El polen de los árboles en la zona de Atlanta suele alcanzar su punto máximo de fines de marzo a mediados de abril. El polen puede dejar una capa amarilla en terrazas, revestimientos y autos, y los lavados de primavera se suelen programar de mediados de marzo hasta abril.',
    source: SRC.fox5Pollen, verifiedOn: R30, confidence: 'checked',
  },
  {
    id: 'pollen-charlotte', topic: 'pollen', centre: 'charlotte', trades: POLLEN, start: '03-15', end: '04-25', peak: '03-31',
    en: 'Tree pollen in North Carolina typically peaks from late March into early April. Pollen can leave a yellow film on decks, siding and cars, and spring washes around Charlotte are typically booked from mid-March through April.',
    es: 'El polen de los árboles en Carolina del Norte suele alcanzar su punto máximo de fines de marzo a principios de abril. El polen puede dejar una capa amarilla en terrazas, revestimientos y autos, y los lavados de primavera en la zona de Charlotte se suelen programar de mediados de marzo hasta abril.',
    source: SRC.ncsuPinePollen, verifiedOn: R30, confidence: 'checked',
  },
  {
    id: 'pollen-raleigh', topic: 'pollen', centre: 'raleigh', trades: POLLEN, start: '03-15', end: '04-25', peak: '03-31',
    en: 'Tree pollen in North Carolina typically peaks from late March into early April. Pollen can leave a yellow film on decks, siding and cars, and spring washes around Raleigh are typically booked from mid-March through April.',
    es: 'El polen de los árboles en Carolina del Norte suele alcanzar su punto máximo de fines de marzo a principios de abril. El polen puede dejar una capa amarilla en terrazas, revestimientos y autos, y los lavados de primavera en la zona de Raleigh se suelen programar de mediados de marzo hasta abril.',
    source: SRC.ncsuPinePollen, verifiedOn: R30, confidence: 'checked',
  },
  {
    id: 'pollen-austin', topic: 'pollen', centre: 'austin', trades: ['cleaning'], start: '12-15', end: '03-01', peak: '01-15',
    en: 'Mountain cedar pollen season around Austin typically starts in mid-December, peaks in mid-January and eases toward early March. Pollen can leave a dusty film on cars and outdoor surfaces through the winter.',
    es: 'La temporada de polen de cedro de montaña en la zona de Austin suele empezar a mediados de diciembre, alcanzar su punto máximo a mediados de enero y bajar hacia principios de marzo. El polen puede dejar una capa de polvo en autos y superficies exteriores durante el invierno.',
    source: SRC.tamuCedar, verifiedOn: R30, confidence: 'checked',
  },

  // Fall tall fescue seeding (VERIFY.md 5a to 5c): NC Piedmont optimum Sep 1 to Oct 1 (NC State Carolina Lawns, Table 2b); Georgia
  // Piedmont "September to October" (UGA B1533).
  {
    id: 'fescue-seeding-atlanta', topic: 'fescue-seeding', centre: 'atlanta', trades: LAWN, start: '09-01', end: '10-31', peak: '09-30',
    en: 'University of Georgia guidance puts tall fescue seeding in the Georgia Piedmont, which includes Atlanta, in September and October. Fall seeding around Atlanta is usually booked in those weeks.',
    es: 'La guía de la Universidad de Georgia ubica la siembra de tall fescue en el Piedmont de Georgia, que incluye Atlanta, en septiembre y octubre. La siembra de otoño en la zona de Atlanta se suele programar en esas semanas.',
    source: SRC.ugaLawnsB1533, verifiedOn: R30, confidence: 'checked',
  },
  {
    id: 'fescue-seeding-charlotte', topic: 'fescue-seeding', centre: 'charlotte', trades: LAWN, start: '09-01', end: '10-01', peak: '09-15',
    en: 'NC State guidance puts the best tall fescue seeding window in the Piedmont from September 1 to October 1. Fall seeding around Charlotte is usually booked in that window.',
    es: 'La guía de NC State ubica el mejor período para sembrar tall fescue en el Piedmont del 1 de septiembre al 1 de octubre. La siembra de otoño en la zona de Charlotte se suele programar en esas semanas.',
    source: SRC.ncsuCarolinaLawns, verifiedOn: R30, confidence: 'checked',
  },
  {
    id: 'fescue-seeding-raleigh', topic: 'fescue-seeding', centre: 'raleigh', trades: LAWN, start: '09-01', end: '10-01', peak: '09-15',
    en: 'NC State guidance puts the best tall fescue seeding window in the Piedmont from September 1 to October 1. Fall seeding around Raleigh is usually booked in that window.',
    es: 'La guía de NC State ubica el mejor período para sembrar tall fescue en el Piedmont del 1 de septiembre al 1 de octubre. La siembra de otoño en la zona de Raleigh se suele programar en esas semanas.',
    source: SRC.ncsuCarolinaLawns, verifiedOn: R30, confidence: 'checked',
  },

  // Home-listing season prep (Zillow's 2025 sales, VERIFY.md 6; the prep window before the listing weeks is Holler's estimate, and the
  // line says so).
  {
    id: 'listing-prep-atlanta', topic: 'listing-prep', centre: 'atlanta', trades: LISTING, start: '04-15', end: '05-15', peak: '05-01',
    en: "Zillow's analysis of 2025 sales points to the first two weeks of May as the best time to list a home in Atlanta. Holler estimates that homes are often prepped for sale with yard work and exterior washes in the weeks before.",
    es: 'El análisis de Zillow de las ventas de 2025 señala las dos primeras semanas de mayo como el mejor momento para poner una casa a la venta en Atlanta. Holler estima que las casas a menudo se preparan para la venta con trabajo de jardín y lavado exterior en las semanas previas.',
    source: SRC.zillowList, verifiedOn: R30, confidence: 'estimate',
  },
  {
    id: 'listing-prep-charlotte', topic: 'listing-prep', centre: 'charlotte', trades: LISTING, start: '04-15', end: '05-15', peak: '05-01',
    en: "Zillow's analysis of 2025 sales points to the first two weeks of May as the best time to list a home in Charlotte. Holler estimates that homes are often prepped for sale with yard work and exterior washes in the weeks before.",
    es: 'El análisis de Zillow de las ventas de 2025 señala las dos primeras semanas de mayo como el mejor momento para poner una casa a la venta en Charlotte. Holler estima que las casas a menudo se preparan para la venta con trabajo de jardín y lavado exterior en las semanas previas.',
    source: SRC.zillowList, verifiedOn: R30, confidence: 'estimate',
  },
  {
    id: 'listing-prep-austin', topic: 'listing-prep', centre: 'austin', trades: LISTING, start: '03-01', end: '03-31', peak: '03-20',
    en: "Zillow's analysis of 2025 sales points to the last two weeks of March as the best time to list a home in Austin. Holler estimates that homes are often prepped for sale with yard work and exterior washes in the weeks before.",
    es: 'El análisis de Zillow de las ventas de 2025 señala las dos últimas semanas de marzo como el mejor momento para poner una casa a la venta en Austin. Holler estima que las casas a menudo se preparan para la venta con trabajo de jardín y lavado exterior en las semanas previas.',
    source: SRC.zillowList, verifiedOn: R30, confidence: 'estimate',
  },
];
