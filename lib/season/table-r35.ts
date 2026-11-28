import type { SeasonRow } from './table';

/**
 * Round 35: the second batch of season rows, live only while HOLLER_SEASON_R35_ENABLED is on (lib/season/active.ts seasonR35Enabled,
 * seasonTable). With the switch off, activeSeasons reads SEASON_TABLE alone and its output is the same as before this file existed.
 *
 * Everything in lib/season/table.ts applies here unchanged: the HOW TO EDIT A ROW notes, the ONE confidence rule, the wording rules, the
 * "Public source" link under each line. tests/season/r35.test.ts runs those checks on every row below.
 *
 * WHAT IS HERE, and why nothing else. A row needs a public page that states its anchor date, fetched and read on the day in `verifiedOn`.
 *  - armyworm: fall armyworm season for lawn care (UGA Extension Georgia, NC State North Carolina, Texas A&M AgriLife Extension Texas).
 *  - pollen (cleaning, gutters, and a spring wash row for Austin): the pollen peak the existing pollen rows already cite, for the trades
 *    those rows do not reach. They share the topic `pollen`, and this array comes after SEASON_TABLE, so a member who holds both parts
 *    of the pressure-washing chip still gets the pressure-washing line only (one line per topic, the first row wins a tie).
 *  Already on main since round 30 and not repeated: spring pre-emergent for lawn care and landscaping (all four metros, Feb to Mar), and
 *  the pressure-washing pollen line for Atlanta, Charlotte and Raleigh. Not built, with the reason: spring irrigation start-up (its
 *  three anchor pages could not be fetched on 2026-11-28, so no row can say it was verified today), oak wilt and mosquito rows (the
 *  trades are on the waitlist or not marketed, BIO.md), fall pre-emergent (no source read), Austin brush collection (VERIFY.md 4).
 *
 * CONFIDENCE, as the table's rule reads here. 'checked': the cited page states the anchor itself as usual timing, with months, for the
 * metro or a region it names (UGA for Georgia: July to September; NC State for North Carolina: late July through mid-October; AgriLife
 * for the Austin area: the article is about Central Texas and its horticulturist is in Travis County, the quoted sentence is general: oak pollen in March and April; FOX 5 and NC State for the pollen peak the existing rows use). Window edges Holler
 * sets around that anchor do not change the label. 'estimate': the gutter rows (the clean-out after the pollen peak is Holler's own
 * link, no page dates it or mentions gutters, like the gutter rows after leaf drop; the line says only "after the peak") and the Austin armyworm row (the Texas A&M page gives a season word,
 * "late summer or early fall", with no month and no region in the sentence).
 */

// Sources, each fetched and read on 2026-11-28 (the quoted sentence is the one the line rests on, 15 words or fewer).
const SRC = {
  // "the fall armyworm problem recurs each year from July to September" (UGA CAES Circular 1335, Fall Armyworm in Georgia: Biology and
  // Management in Turfgrass, published 2025-06-17; statewide).
  ugaFallArmyworm: 'https://fieldreport.caes.uga.edu/publications/C1335/',
  // "FAW activity in NC generally ranges from late July through mid-October" (NC Turf Bugs, NC State University, 2021-08-05).
  ncsuTurfBugs: 'https://ncturfbugs.wordpress.ncsu.edu/2021/08/05/fall-armyworms-alert/',
  // "Usually, infestations take place in late summer or early fall" (Insects in the City, Texas A&M AgriLife Extension, 2021-08-30;
  // fall armyworms in home lawns, an Austin-based IPM specialist is quoted).
  agrilifeCitybugs: 'https://citybugs.tamu.edu/2021/08/30/be-on-the-lookout-for-armyworms/',
  // "The season runs from late February to May, but peaks during late March and mid-April." (FOX 5 Atlanta, 2026-02-18).
  fox5Pollen: 'https://www.fox5atlanta.com/news/georgia-pollen-count-explained-seasonal-allergies',
  // "tree pollen counts typically peaking between late March and early April" (NC State Extension, 2026-03-04).
  ncsuPinePollen: 'https://forestry.ces.ncsu.edu/news/pine-pollen-season',
  // "Oak trees typically flower and produce their pollen in March and April." (AgriLife Today, 2018-04-07; Central Texas, Travis County
  // experts quoted).
  agrilifeOakPollen: 'https://agrilifetoday.tamu.edu/2018/04/07/central-texans-getting-more-than-fair-share-of-oak-pollen/',
} as const;

/** Day the sources above were read. */
const R35 = '2026-11-28';

const LAWN_CARE = ['lawn-care'] as const;
const CLEANING = ['cleaning'] as const;
const GUTTERS = ['siding-gutters'] as const;
/** The "Pressure washing" chip's parts (lib/plan/composite-trades.ts PRESSURE_WASHING_PARTS): both must be held. */
const PRESSURE_WASHING = ['cleaning', 'siding-gutters'] as const;

export const SEASON_TABLE_R35: readonly SeasonRow[] = [
  // Fall armyworm, lawn care only. One line per metro, shown in the weeks the source gives for the state. Never a fact about a lawn.
  {
    id: 'armyworm-atlanta', topic: 'armyworm', centre: 'atlanta', trades: LAWN_CARE, start: '08-01', end: '09-30', peak: '09-01',
    en: 'A University of Georgia Extension circular says fall armyworms recur in Georgia turfgrass each year from July to September. Holler estimates that around Atlanta, lawn-care visits to check for caterpillars are typically booked in August and September.',
    es: 'Una circular de la Extensión de la Universidad de Georgia indica que el gusano cogollero (fall armyworm) vuelve al césped de Georgia cada año de julio a septiembre. Holler estima que, en la zona de Atlanta, las visitas de cuidado del césped para revisar si hay orugas se suelen programar en agosto y septiembre.',
    source: SRC.ugaFallArmyworm, verifiedOn: R35, confidence: 'checked',
  },
  {
    id: 'armyworm-charlotte', topic: 'armyworm', centre: 'charlotte', trades: LAWN_CARE, start: '07-25', end: '10-15', peak: '09-01',
    en: "NC State's NC Turf Bugs blog says fall armyworm activity in North Carolina generally ranges from late July through mid-October. Holler estimates that around Charlotte, lawn-care visits to check for caterpillars are typically booked within that range.",
    es: 'El blog NC Turf Bugs de NC State indica que la actividad del gusano cogollero (fall armyworm) en Carolina del Norte suele ir de fines de julio a mediados de octubre. Holler estima que, en la zona de Charlotte, las visitas de cuidado del césped para revisar si hay orugas se suelen programar dentro de ese período.',
    source: SRC.ncsuTurfBugs, verifiedOn: R35, confidence: 'checked',
  },
  {
    id: 'armyworm-raleigh', topic: 'armyworm', centre: 'raleigh', trades: LAWN_CARE, start: '07-25', end: '10-15', peak: '09-01',
    en: "NC State's NC Turf Bugs blog says fall armyworm activity in North Carolina generally ranges from late July through mid-October. Holler estimates that around Raleigh, lawn-care visits to check for caterpillars are typically booked within that range.",
    es: 'El blog NC Turf Bugs de NC State indica que la actividad del gusano cogollero (fall armyworm) en Carolina del Norte suele ir de fines de julio a mediados de octubre. Holler estima que, en la zona de Raleigh, las visitas de cuidado del césped para revisar si hay orugas se suelen programar dentro de ese período.',
    source: SRC.ncsuTurfBugs, verifiedOn: R35, confidence: 'checked',
  },
  {
    id: 'armyworm-austin', topic: 'armyworm', centre: 'austin', trades: LAWN_CARE, start: '08-15', end: '10-15', peak: '09-15',
    en: 'A Texas A&M AgriLife Extension blog says fall armyworm infestations in home lawns usually take place in late summer or early fall. Holler estimates that around Austin, lawn-care visits to check for caterpillars are typically booked from mid-August to mid-October.',
    es: 'Un blog de la Extensión Texas A&M AgriLife indica que las infestaciones del gusano cogollero (fall armyworm) en céspedes residenciales suelen ocurrir a fines del verano o principios del otoño. Holler estima que, en la zona de Austin, las visitas de cuidado del césped para revisar si hay orugas se suelen programar de mediados de agosto a mediados de octubre.',
    source: SRC.agrilifeCitybugs, verifiedOn: R35, confidence: 'estimate',
  },

  // Spring pollen, pressure washing in Austin: the existing Austin row is the winter cedar season (ends Mar 1), so a pressure washer had
  // no pollen line in March and April. Same AND rule as the other pollen rows. First in this array so it wins the topic over the two
  // rows below for a member who holds both parts of the chip.
  {
    id: 'pollen-wash-austin', topic: 'pollen', centre: 'austin', trades: CLEANING, allTrades: PRESSURE_WASHING, start: '03-01', end: '04-30', peak: '03-31',
    en: 'Texas A&M AgriLife says oak trees typically flower and produce their pollen in March and April. Pollen can leave a dusty film on cars and outdoor surfaces. Holler estimates that spring washes around Austin are typically booked from March through April.',
    es: 'Texas A&M AgriLife indica que los robles suelen florecer y producir su polen en marzo y abril. El polen puede dejar una capa de polvo en autos y superficies exteriores. Holler estima que, en la zona de Austin, los lavados de primavera se suelen programar de marzo a fines de abril.',
    source: SRC.agrilifeOakPollen, verifiedOn: R35, confidence: 'checked',
  },

  // Spring pollen, house cleaning (no pressure-washing line: that one is for the chip). The window runs around the stated peak.
  {
    id: 'pollen-cleaning-atlanta', topic: 'pollen', centre: 'atlanta', trades: CLEANING, start: '03-15', end: '04-25', peak: '03-30',
    en: 'Tree pollen around Atlanta usually peaks from late March to mid-April. Holler estimates that spring deep cleans around Atlanta are typically booked from mid-March through April.',
    es: 'El polen de los árboles en la zona de Atlanta suele alcanzar su punto máximo de fines de marzo a mediados de abril. Holler estima que, en la zona de Atlanta, las limpiezas profundas de primavera se suelen programar de mediados de marzo a fines de abril.',
    source: SRC.fox5Pollen, verifiedOn: R35, confidence: 'checked',
  },
  {
    id: 'pollen-cleaning-charlotte', topic: 'pollen', centre: 'charlotte', trades: CLEANING, start: '03-15', end: '04-25', peak: '03-31',
    en: 'Tree pollen in North Carolina typically peaks from late March into early April. Holler estimates that spring deep cleans around Charlotte are typically booked from mid-March through April.',
    es: 'El polen de los árboles en Carolina del Norte suele alcanzar su punto máximo de fines de marzo a principios de abril. Holler estima que, en la zona de Charlotte, las limpiezas profundas de primavera se suelen programar de mediados de marzo a fines de abril.',
    source: SRC.ncsuPinePollen, verifiedOn: R35, confidence: 'checked',
  },
  {
    id: 'pollen-cleaning-raleigh', topic: 'pollen', centre: 'raleigh', trades: CLEANING, start: '03-15', end: '04-25', peak: '03-31',
    en: 'Tree pollen in North Carolina typically peaks from late March into early April. Holler estimates that spring deep cleans around Raleigh are typically booked from mid-March through April.',
    es: 'El polen de los árboles en Carolina del Norte suele alcanzar su punto máximo de fines de marzo a principios de abril. Holler estima que, en la zona de Raleigh, las limpiezas profundas de primavera se suelen programar de mediados de marzo a fines de abril.',
    source: SRC.ncsuPinePollen, verifiedOn: R35, confidence: 'checked',
  },
  {
    id: 'pollen-cleaning-austin', topic: 'pollen', centre: 'austin', trades: CLEANING, start: '03-01', end: '04-30', peak: '03-31',
    en: 'Texas A&M AgriLife says oak trees typically flower and produce their pollen in March and April. Holler estimates that spring deep cleans around Austin are typically booked from March through April.',
    es: 'Texas A&M AgriLife indica que los robles suelen florecer y producir su polen en marzo y abril. Holler estima que, en la zona de Austin, las limpiezas profundas de primavera se suelen programar de marzo a fines de abril.',
    source: SRC.agrilifeOakPollen, verifiedOn: R35, confidence: 'checked',
  },

  // Spring gutter clean-outs, Atlanta, Charlotte and Raleigh only. No page links pollen to gutters or dates a clean-out, so the row is an
  // 'estimate' and the line states only a timing: Holler's booking window comes AFTER the peak the source gives (Atlanta late March to
  // mid-April, North Carolina late March to early April), and the row does not show before that window opens (Apr 15). It says nothing
  // about what pollen does to a gutter. No Austin row: the AgriLife page puts oak pollen through all of April, so no sourced "after".
  {
    id: 'pollen-gutters-atlanta', topic: 'pollen', centre: 'atlanta', trades: GUTTERS, start: '04-15', end: '05-10', peak: '04-25',
    en: 'Tree pollen around Atlanta usually peaks from late March to mid-April. Holler estimates that spring gutter clean-outs around Atlanta are typically booked after the peak, from mid-April to early May.',
    es: 'El polen de los árboles en la zona de Atlanta suele alcanzar su punto máximo de fines de marzo a mediados de abril. Holler estima que, en la zona de Atlanta, las limpiezas de canaletas en primavera se suelen programar después de ese punto máximo, de mediados de abril a principios de mayo.',
    source: SRC.fox5Pollen, verifiedOn: R35, confidence: 'estimate',
  },
  {
    id: 'pollen-gutters-charlotte', topic: 'pollen', centre: 'charlotte', trades: GUTTERS, start: '04-15', end: '05-10', peak: '04-25',
    en: 'Tree pollen in North Carolina typically peaks from late March into early April. Holler estimates that spring gutter clean-outs around Charlotte are typically booked after the peak, from mid-April to early May.',
    es: 'El polen de los árboles en Carolina del Norte suele alcanzar su punto máximo de fines de marzo a principios de abril. Holler estima que, en la zona de Charlotte, las limpiezas de canaletas en primavera se suelen programar después de ese punto máximo, de mediados de abril a principios de mayo.',
    source: SRC.ncsuPinePollen, verifiedOn: R35, confidence: 'estimate',
  },
  {
    id: 'pollen-gutters-raleigh', topic: 'pollen', centre: 'raleigh', trades: GUTTERS, start: '04-15', end: '05-10', peak: '04-25',
    en: 'Tree pollen in North Carolina typically peaks from late March into early April. Holler estimates that spring gutter clean-outs around Raleigh are typically booked after the peak, from mid-April to early May.',
    es: 'El polen de los árboles en Carolina del Norte suele alcanzar su punto máximo de fines de marzo a principios de abril. Holler estima que, en la zona de Raleigh, las limpiezas de canaletas en primavera se suelen programar después de ese punto máximo, de mediados de abril a principios de mayo.',
    source: SRC.ncsuPinePollen, verifiedOn: R35, confidence: 'estimate',
  },
];
