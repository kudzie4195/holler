/**
 * Display labels for CategoryId values. LOCAL map built from the ids listed in SPEC.md because
 * lib/signals/categories.ts (W2) did not exist yet. Unknown ids fall back to a prettified id.
 */
const TRADE_LABELS: Record<string, string> = {
  roofing: 'Roofing',
  hvac: 'HVAC',
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  'tree-service': 'Tree service',
  landscaping: 'Landscaping',
  'lawn-care': 'Lawn care',
  'snow-removal': 'Snow removal',
  'pest-control': 'Pest control',
  cleaning: 'Cleaning',
  restoration: 'Restoration',
  'general-contractor': 'General contracting',
  painting: 'Painting',
  'pool-spa': 'Pool and spa',
  solar: 'Solar',
  'auto-glass': 'Auto glass',
  'auto-body': 'Auto body',
  towing: 'Towing',
  'auto-repair': 'Auto repair',
  moving: 'Moving',
  'junk-removal': 'Junk removal',
  locksmith: 'Locksmith',
  'real-estate': 'Real estate',
  insurance: 'Insurance',
  'food-truck': 'Food trucks',
  catering: 'Catering',
  'event-services': 'Event services',
  'rideshare-delivery': 'Rideshare and delivery',
  childcare: 'Childcare',
  beauty: 'Beauty',
  'janitorial-commercial': 'Commercial janitorial',
  security: 'Security',
};

export function tradeLabel(id: string): string {
  if (TRADE_LABELS[id]) return TRADE_LABELS[id];
  const s = id.replace(/[-_]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
