/** What Holler watches for a trade, in plain words. Used only for the "nothing yet" state. Unknown trades get the default. */
const DEFAULT = [
  'weather alerts and storm reports',
  'building permits and 311 requests where the city publishes them',
  'federal contract awards',
  'big events',
  'neighbors asking for recommendations',
];

const BY_TRADE: Record<string, string[]> = {
  roofing: ['hail and wind reports', 'severe weather warnings', 'new building permits', 'neighbors asking for a roofer'],
  hvac: ['heat and cold alerts', 'new building permits', 'neighbors asking for AC or furnace help'],
  plumbing: ['freeze warnings', 'flood alerts', '311 water and sewer reports', 'neighbors asking for a plumber'],
  electrical: ['storm and outage-related weather alerts', 'new building permits', 'neighbors asking for an electrician'],
  'tree-service': ['high wind warnings', 'storm reports with tree damage', 'neighbors asking about fallen trees'],
  restoration: ['flood and storm alerts', 'FEMA declarations', 'neighbors asking about water or fire damage'],
  'snow-removal': ['winter storm warnings', 'neighbors asking for plowing'],
  'food-truck': ['big concerts, games and festivals', 'event permits', 'neighbors asking for food vendors'],
  catering: ['big events and festivals', 'neighbors asking for caterers'],
  'event-services': ['big events and festivals', 'neighbors asking for DJs, rentals and photographers'],
  'rideshare-delivery': ['airport delays', 'big events that bring crowds'],
  towing: ['storm and ice alerts', '311 abandoned-vehicle reports', 'neighbors asking for a tow'],
  'auto-glass': ['hail reports', 'neighbors asking for windshield help'],
  'auto-body': ['hail reports', 'neighbors asking for dent repair'],
};

export function watchesFor(trade: string): string[] {
  return BY_TRADE[trade] ?? DEFAULT;
}
