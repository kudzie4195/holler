/**
 * The "Coming next" list: features the owner is thinking about building, shown so people can say "I want this".
 * Pure data and copy, safe to import from client code. The copy says what the idea is. It does not say the feature exists
 * and promises no date. No counts are ever shown to visitors.
 */
export const FEATURES = [
  {
    id: 'gov-bids',
    label: 'Local government bids',
    description: 'City and county work that is out for bid, matched to your trade and area.',
  },
  {
    id: 'asking-online',
    label: 'People asking online',
    description: 'Public posts where someone nearby asks for a pro in your trade.',
  },
  {
    id: 'city-weekly',
    label: 'Free weekly city email',
    description: 'One email a week with what changed in your city.',
  },
  {
    id: 'more-areas',
    label: 'More cities',
    description: 'Permits and city requests in more cities. Check your ZIP code and we will send one email when we reach it.',
  },
] as const;

export type FeatureId = (typeof FEATURES)[number]['id'];

export const FEATURE_IDS: readonly FeatureId[] = FEATURES.map((f) => f.id);

export function isFeatureId(v: unknown): v is FeatureId {
  return typeof v === 'string' && (FEATURE_IDS as readonly string[]).includes(v);
}

export const COMING_NEXT = {
  heading: 'Coming next',
  intro: 'We build what gets picked. Tell us what you want.',
  button: 'I want this',
  picked: 'Picked',
  thanks: 'Thanks. We noted your pick:',
  error: 'Could not save that. Try again later.',
} as const;

/** Where a pick came from. Stored as `page` (max 40 characters). */
export const INTEREST_PAGES = ['pricing', 'app'] as const;
export const PAGE_MAX = 40;

/** Keeps the page tag only when it is one of INTEREST_PAGES, else null. Never stores free text. */
export function cleanPage(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, PAGE_MAX);
  return (INTEREST_PAGES as readonly string[]).includes(s) ? s : null;
}
