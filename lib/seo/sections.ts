export type SectionId =
  | 'alerts'
  | 'storm'
  | 'disasters'
  | 'permits'
  | 'requests311'
  | 'inspections'
  | 'business'
  | 'violations'
  | 'contracts'
  | 'events'
  | 'airport'
  | 'asks';

export interface SectionDef {
  id: SectionId;
  title: string;
  /** noun used in generated sentences: [singular, plural] */
  noun: [string, string];
  blurb: string;
}

/** Display order matches SPEC Behaviour #9. */
export const SECTIONS: SectionDef[] = [
  { id: 'alerts', title: 'Active weather alerts', noun: ['active weather alert', 'active weather alerts'], blurb: 'Warnings and watches that have not expired yet.' },
  { id: 'storm', title: 'Storm reports', noun: ['storm report', 'storm reports'], blurb: 'Reports of hail, wind and tornadoes near here.' },
  { id: 'disasters', title: 'Disasters and earthquakes', noun: ['disaster or earthquake record', 'disaster and earthquake records'], blurb: 'Federal disaster declarations and recent earthquakes.' },
  { id: 'permits', title: 'Building permits', noun: ['building permit', 'building permits'], blurb: 'Permits filed with the city or county.' },
  { id: 'requests311', title: '311 requests', noun: ['311 request', '311 requests'], blurb: 'Service requests and complaints residents sent to the city.' },
  { id: 'inspections', title: 'Inspections', noun: ['inspection record', 'inspection records'], blurb: 'Health and safety inspection results published by the city.' },
  { id: 'business', title: 'New businesses', noun: ['new business license', 'new business licenses'], blurb: 'Business licenses newly issued or registered with the city. New shops and offices tend to need a lot of services.' },
  { id: 'violations', title: 'Code violations', noun: ['code violation', 'code violations'], blurb: 'Building and property code violations cited by the city. Each one usually means a repair is due.' },
  { id: 'contracts', title: 'Federal contracts', noun: ['federal contract', 'federal contracts'], blurb: 'Contract awards and opportunities with a local place of performance.' },
  { id: 'events', title: 'Big events', noun: ['big event', 'big events'], blurb: 'Large ticketed events and city event permits that bring crowds to town.' },
  { id: 'airport', title: 'Airport status', noun: ['airport status notice', 'airport status notices'], blurb: 'Delays and ground stops at nearby airports.' },
  // Kind 'ask' holds resident requests made on Holler (no key needed) and, only when their keys are set, public posts found through
  // search or Bluesky. The wording fits both and never says Holler reads social sites.
  { id: 'asks', title: 'Requests for local help', noun: ['request for local help', 'requests for local help'], blurb: 'People near here who asked for a local service. Each one names where it came from. Contact details are never shown.' },
];

export const SECTION_BY_ID: Record<SectionId, SectionDef> = Object.fromEntries(
  SECTIONS.map((s) => [s.id, s]),
) as Record<SectionId, SectionDef>;

const INSPECTION_RE = /inspect|health dep|restaurant|food service|sanitation/i;

/**
 * Which section a signal belongs to. Kinds map one to one except 'civic', which holds both
 * 311 requests, inspections, new businesses and code violations. The Socrata/ArcGIS adapters set
 * `data.subtype` ('permit' | '311' | 'inspection' | 'business' | 'violation' | 'event-permit'); that is used when present.
 * Events (kind 'event') stay in one section whether they are 'event-permit' or ticketed. The keyword regex on source id and title is only a
 * fallback for rows written before the subtype existed.
 */
export function sectionFor(kind: string, source: string, title: string, subtype?: string | null): SectionId | null {
  switch (kind) {
    case 'alert':
      return 'alerts';
    case 'report':
      return 'storm';
    case 'disaster':
    case 'quake':
      return 'disasters';
    case 'permit':
      return 'permits';
    case 'civic':
      // Round 20 SALES: a recorded property sale is never listed or counted on a public page (a home sale is about a household).
      if (subtype === 'sale') return null;
      if (subtype === 'inspection') return 'inspections';
      if (subtype === 'business') return 'business';
      if (subtype === 'violation') return 'violations';
      if (subtype === '311') return 'requests311';
      return INSPECTION_RE.test(`${source} ${title}`) ? 'inspections' : 'requests311';
    case 'contract':
      return 'contracts';
    case 'event':
      return 'events';
    case 'travel':
      return 'airport';
    case 'ask':
      return 'asks';
    default:
      return null;
  }
}

/** Short noun for the kind of signal, used in the "who this helps" block. */
export const KIND_NOUN: Record<string, string> = {
  alert: 'weather alerts',
  report: 'storm reports',
  disaster: 'disaster records',
  quake: 'earthquakes',
  permit: 'permits',
  civic: 'city records',
  contract: 'federal contracts',
  event: 'events',
  travel: 'airport notices',
  ask: 'requests for local help',
};
