import type { CategoryId } from './categories';

/**
 * Round 20 SCORE: which kinds of public record each of the 41 trades can act on, as ONE table so it can be argued with. The scorecard
 * (scripts/trade-coverage.ts, npm run score:trades) reads it for the gap report only: "no source of a record type this trade acts on" and
 * the ranked build list. It never changes a label, a match or a card: the engine (lib/signals/lead-rules.ts, lib/signals/match.ts) alone
 * decides what a member gets, and the measured grid is computed from the engine, not from this table.
 *
 * The table is a judgement (assumed, not sourced): "acts on" means a member of the trade can reasonably turn a record of that type into a
 * call or a visit. Change a line here with a reason and the gap report and build list move with it; the measured grid does not.
 * Pure and client-safe: no imports beyond types.
 */

export type RecordType =
  // ---- record types live sources carry today ----
  | 'permit'
  | 'code-violation'
  | '311-request'
  | 'inspection'
  | 'business-licence'
  | 'event-permit'
  | 'weather-alert'
  | 'storm-report'
  | 'public-bid'
  | 'federal-award'
  | 'earthquake'
  | 'airport-delay'
  | 'disaster-declaration'
  // ---- record types no live source carries yet (candidates for the build list) ----
  | 'property-sale'
  | 'vehicle-crash'
  | 'fire-incident'
  | 'certificate-of-occupancy'
  | 'vacant-property'
  | 'other';

export interface RecordTypeInfo {
  id: RecordType;
  /** What the record is, in plain words (report only). */
  what: string;
  /** A live source of this type exists in the export the scorecard reads (informational; the scorecard measures presence per metro itself). */
  liveToday: boolean;
  /** A privacy point any new source of this type must respect (CONTEXT.md, round 20), shown next to it in the build list. */
  privacy?: string;
}

export const RECORD_TYPES: readonly RecordTypeInfo[] = [
  { id: 'permit', what: 'building and trade permits (new homes, remodels, roofs, pools, demolitions, fit-outs)', liveToday: true },
  { id: 'code-violation', what: 'code-enforcement orders and violations at a property', liveToday: true },
  { id: '311-request', what: '311 service requests (no heat, sewage backup, private graffiti, rodents at a building)', liveToday: true },
  { id: 'inspection', what: 'failed health and food-establishment inspections', liveToday: true },
  { id: 'business-licence', what: 'new business licences and registrations', liveToday: true },
  { id: 'event-permit', what: 'permitted public events and film shoots', liveToday: true },
  { id: 'weather-alert', what: 'National Weather Service warnings and advisories', liveToday: true },
  { id: 'storm-report', what: 'Storm Prediction Center hail and wind reports', liveToday: true },
  { id: 'public-bid', what: 'open public solicitations (federal and city bids)', liveToday: true },
  { id: 'federal-award', what: 'awarded federal contracts', liveToday: true },
  { id: 'earthquake', what: 'USGS earthquakes', liveToday: true },
  { id: 'airport-delay', what: 'FAA ground stops and delays', liveToday: true },
  { id: 'disaster-declaration', what: 'FEMA disaster declarations', liveToday: false },
  {
    id: 'property-sale',
    what: 'recorded property sales and deeds (a new owner moves in or takes over)',
    liveToday: false,
    privacy: 'never a buyer, seller, grantor, grantee, owner or party name for a residential sale: address, sale date, price band and property class only',
  },
  { id: 'vehicle-crash', what: 'police-reported motor vehicle crashes (city open data)', liveToday: false, privacy: 'location and time only; never a driver, victim or plate' },
  { id: 'fire-incident', what: 'fire department incidents at a structure', liveToday: false, privacy: 'address or block only; never an occupant' },
  { id: 'certificate-of-occupancy', what: 'certificates of occupancy (a new or converted building is ready to use)', liveToday: false },
  { id: 'vacant-property', what: 'vacant or abandoned building registrations', liveToday: false, privacy: 'address only; never an owner name unless it passes lib/contacts company rules' },
  { id: 'other', what: 'any record that fits none of the above', liveToday: true },
];

export interface TradeNeed {
  /** Record types this trade acts on, strongest first. */
  acts: readonly RecordType[];
  /** One line: why these. */
  why: string;
}

export const TRADE_NEEDS: Readonly<Record<CategoryId, TradeNeed>> = {
  roofing: { acts: ['storm-report', 'code-violation', 'property-sale', 'fire-incident', 'weather-alert'], why: 'Hail and wind reports and roof repair orders mean a roof to fix; roof permits are jobs already taken (feed only).' },
  hvac: { acts: ['311-request', 'code-violation', 'permit', 'property-sale'], why: 'No-heat complaints and heat orders are a broken system now; new builds and sales need equipment.' },
  plumbing: { acts: ['311-request', 'code-violation', 'permit', 'inspection', 'property-sale'], why: 'Sewage backups, no-water complaints and plumbing orders are a fix now; new builds need fit-out.' },
  electrical: { acts: ['permit', 'code-violation', 'property-sale', 'weather-alert'], why: 'New builds, solar and additions need wiring; electrical orders and storms mean repairs.' },
  'tree-service': { acts: ['storm-report', 'weather-alert', '311-request', 'code-violation'], why: 'Wind reports bring trees down; private tree complaints and overgrowth orders name a property.' },
  landscaping: { acts: ['permit', 'code-violation', 'property-sale', 'certificate-of-occupancy'], why: 'New homes need a yard; overgrowth orders and new owners want one fixed.' },
  'lawn-care': { acts: ['permit', 'code-violation', 'property-sale', 'vacant-property'], why: 'New homes, tall-grass orders, new owners and vacant lots all need mowing.' },
  'snow-removal': { acts: ['weather-alert', 'public-bid', 'business-licence'], why: 'Winter storm warnings drive the work; public lots and new storefronts sign seasonal contracts.' },
  'pest-control': { acts: ['inspection', '311-request', 'code-violation', 'business-licence'], why: 'Failed food inspections and rodent or roach orders at a named building need treatment.' },
  cleaning: { acts: ['property-sale', 'permit', 'certificate-of-occupancy', 'code-violation'], why: 'Move-in and move-out cleans follow sales; post-construction cleans follow new homes.' },
  restoration: { acts: ['311-request', 'storm-report', 'fire-incident', 'weather-alert', 'code-violation'], why: 'Sewage backups, floods, fires and mold orders are water, fire and storm damage to dry out.' },
  'general-contractor': { acts: ['code-violation', 'public-bid', 'fire-incident', 'property-sale'], why: 'Repair orders and open bids are work to price; fires and sales start rebuilds and remodels.' },
  painting: { acts: ['permit', 'code-violation', '311-request', 'property-sale'], why: 'New builds need paint; peeling-paint orders and private graffiti name a wall to paint.' },
  'pool-spa': { acts: ['permit', 'property-sale', 'code-violation'], why: 'Pool permits mean follow-on service; new owners and stagnant-pool orders need a pool fixed.' },
  solar: { acts: ['permit', 'property-sale'], why: 'New homes and re-roofs are the moment to add panels; new owners decide on energy.' },
  'auto-glass': { acts: ['storm-report', 'vehicle-crash'], why: 'Hail and crashes break windshields.' },
  'auto-body': { acts: ['storm-report', 'vehicle-crash'], why: 'Hail dents and collisions are body work.' },
  towing: { acts: ['vehicle-crash', 'weather-alert'], why: 'Crashes and flood or ice warnings strand vehicles.' },
  'auto-repair': { acts: ['vehicle-crash', 'storm-report'], why: 'Crashes and storm damage send cars to a shop.' },
  moving: { acts: ['property-sale', 'certificate-of-occupancy', 'permit'], why: 'A sale or a newly finished home means someone moves.' },
  'junk-removal': { acts: ['code-violation', '311-request', 'permit', 'property-sale', 'vacant-property', 'fire-incident'], why: 'Debris orders, demolitions, sales, vacant buildings and fires leave things to haul.' },
  locksmith: { acts: ['property-sale', 'business-licence', 'vacant-property', 'certificate-of-occupancy'], why: 'New owners rekey; new storefronts and secured vacant buildings need locks.' },
  'real-estate': { acts: ['property-sale', 'permit', 'code-violation', 'vacant-property'], why: 'Sales show the market; new homes, distress orders and vacant buildings are listings to win.' },
  insurance: { acts: ['property-sale', 'business-licence', 'permit', 'storm-report'], why: 'New owners, new businesses and new homes need cover; storms prompt reviews.' },
  'food-truck': { acts: ['event-permit', 'public-bid'], why: 'Permitted events need vendors; some cities bid vending spots.' },
  catering: { acts: ['event-permit', 'business-licence', 'public-bid'], why: 'Events and new offices order food; agencies bid catering.' },
  'event-services': { acts: ['event-permit', 'public-bid'], why: 'Permitted events need rentals, staging and photos.' },
  'rideshare-delivery': { acts: ['airport-delay', 'event-permit', 'weather-alert'], why: 'Delays, big events and bad weather move demand for rides.' },
  childcare: { acts: ['property-sale', 'permit', 'certificate-of-occupancy'], why: 'New households (sales, new homes) look for care; weak fit for public records.' },
  beauty: { acts: ['event-permit', 'business-licence'], why: 'Events bring bookings; new salons are chairs to rent; weak fit for public records.' },
  'janitorial-commercial': { acts: ['business-licence', 'certificate-of-occupancy', 'inspection', 'public-bid', 'permit'], why: 'New storefronts, newly occupied buildings, failed inspections and fit-outs need a cleaning contract.' },
  security: { acts: ['business-licence', 'certificate-of-occupancy', 'vacant-property', 'event-permit', 'permit'], why: 'New businesses, new buildings, vacant buildings, events and building sites need guards or cameras.' },
  fencing: { acts: ['permit', 'code-violation', 'property-sale', 'vacant-property'], why: 'Pools and new homes need fences; fence orders and vacant lots need them fixed or secured.' },
  'concrete-paving': { acts: ['permit', 'code-violation', 'public-bid'], why: 'New homes need driveways; sidewalk repair orders and paving bids are work to price.' },
  'windows-doors': { acts: ['permit', 'code-violation', 'property-sale', 'storm-report'], why: 'New builds need windows; window orders, new owners and hail mean replacements.' },
  'siding-gutters': { acts: ['storm-report', 'code-violation', 'permit', 'property-sale'], why: 'Hail and wind damage siding; exterior-wall orders and new builds need it.' },
  flooring: { acts: ['permit', 'property-sale', 'certificate-of-occupancy'], why: 'New builds and new owners put in floors.' },
  handyman: { acts: ['code-violation', '311-request', 'property-sale'], why: 'Small repair orders and new owners make lists of small jobs.' },
  'signs-printing': { acts: ['business-licence', 'event-permit', 'certificate-of-occupancy'], why: 'New businesses need signs; events need banners.' },
  'business-services': { acts: ['business-licence', 'certificate-of-occupancy'], why: 'New businesses need bookkeeping, payroll and IT set up.' },
  'public-adjuster': { acts: ['storm-report', 'fire-incident', 'weather-alert'], why: 'Storm and fire damage bring insurance claims.' },
};

const SUBTYPE_TYPE: Record<string, RecordType> = {
  permit: 'permit',
  violation: 'code-violation',
  '311': '311-request',
  inspection: 'inspection',
  business: 'business-licence',
  'event-permit': 'event-permit',
  bid: 'public-bid',
  // Round 20 SALES (review P2-3): a recorded property sale (lib/signals/adapters/sales.ts writes data.subtype 'sale').
  sale: 'property-sale',
};

const SOURCE_TYPE: Record<string, RecordType> = {
  nws: 'weather-alert',
  spc: 'storm-report',
  usgs: 'earthquake',
  faa: 'airport-delay',
  usaspending: 'federal-award',
  'sam-gov': 'public-bid',
  fema: 'disaster-declaration',
};

/** The record type of a stored row: its source for the national feeds, else its data.subtype, else its kind. */
export function recordTypeOf(r: { source?: string | null; kind?: string | null; subtype?: string | null; data?: { subtype?: unknown } | null }): RecordType {
  const src = (r.source ?? '').toLowerCase();
  if (SOURCE_TYPE[src]) return SOURCE_TYPE[src];
  const sub = typeof r.subtype === 'string' && r.subtype ? r.subtype : typeof r.data?.subtype === 'string' ? (r.data.subtype as string) : '';
  if (SUBTYPE_TYPE[sub]) return SUBTYPE_TYPE[sub];
  if (src.includes('bids')) return 'public-bid';
  const kind = (r.kind ?? '').toLowerCase();
  if (kind === 'permit') return 'permit';
  if (kind === 'event') return 'event-permit';
  return 'other';
}
