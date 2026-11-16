export type CategoryId =
  | 'roofing'
  | 'hvac'
  | 'plumbing'
  | 'electrical'
  | 'tree-service'
  | 'landscaping'
  | 'lawn-care'
  | 'snow-removal'
  | 'pest-control'
  | 'cleaning'
  | 'restoration'
  | 'general-contractor'
  | 'painting'
  | 'pool-spa'
  | 'solar'
  | 'auto-glass'
  | 'auto-body'
  | 'towing'
  | 'auto-repair'
  | 'moving'
  | 'junk-removal'
  | 'locksmith'
  | 'real-estate'
  | 'insurance'
  | 'food-truck'
  | 'catering'
  | 'event-services'
  | 'rideshare-delivery'
  | 'childcare'
  | 'beauty'
  | 'janitorial-commercial'
  | 'security';

export interface Category {
  id: CategoryId;
  label: string;
  keywords: string[];
}

export const CATEGORIES: Category[] = [
  { id: 'roofing', label: 'Roofing', keywords: ['roof', 'roofer', 'roofing', 'shingle', 'shingles', 'roof leak', 'hail damage', 'gutter', 'gutters', 'siding'] },
  { id: 'hvac', label: 'Heating and air (HVAC)', keywords: ['hvac', 'air conditioning', 'air conditioner', 'a/c', 'furnace', 'heater', 'heat pump', 'ac repair', 'ac unit', 'heating and cooling', 'no heat', 'ductwork', 'thermostat'] },
  { id: 'plumbing', label: 'Plumbing', keywords: ['plumber', 'plumbing', 'burst pipe', 'frozen pipe', 'frozen pipes', 'leaking pipe', 'water heater', 'clogged drain', 'sewer line', 'toilet', 'garbage disposal', 'sump pump'] },
  { id: 'electrical', label: 'Electrical', keywords: ['electrician', 'electrical', 'power outage', 'breaker', 'outlet', 'wiring', 'generator', 'panel upgrade', 'ev charger'] },
  { id: 'tree-service', label: 'Tree service', keywords: ['tree removal', 'tree service', 'tree trimming', 'arborist', 'fallen tree', 'downed tree', 'tree down', 'stump', 'stump grinding', 'storm debris', 'limbs'] },
  { id: 'landscaping', label: 'Landscaping', keywords: ['landscaper', 'landscaping', 'landscape', 'mulch', 'retaining wall', 'irrigation', 'sprinkler', 'hardscape', 'garden design', 'patio'] },
  { id: 'lawn-care', label: 'Lawn care', keywords: ['lawn care', 'lawn service', 'lawn mowing', 'mowing', 'mow', 'yard work', 'lawn guy', 'lawn', 'weed control', 'fertilizer', 'aeration', 'yard cleanup'] },
  { id: 'snow-removal', label: 'Snow removal', keywords: ['snow removal', 'snow plow', 'snow plowing', 'plow', 'plowing', 'snow shoveling', 'shovel', 'de-icing', 'deicing', 'salting', 'ice removal', 'driveway snow'] },
  { id: 'pest-control', label: 'Pest control', keywords: ['pest control', 'exterminator', 'termite', 'termites', 'roach', 'roaches', 'cockroach', 'bed bug', 'bed bugs', 'rodent', 'rodents', 'mice', 'rats', 'ants', 'wasp', 'hornet', 'mosquito', 'infestation'] },
  { id: 'cleaning', label: 'House cleaning', keywords: ['house cleaning', 'house cleaner', 'maid', 'maid service', 'cleaning lady', 'deep clean', 'deep cleaning', 'move out clean', 'move-out clean', 'housekeeper', 'pressure washing', 'power washing', 'window cleaning', 'carpet cleaning'] },
  { id: 'restoration', label: 'Water, fire and storm restoration', keywords: ['restoration', 'water damage', 'flood damage', 'flooding', 'fire damage', 'smoke damage', 'mold', 'mold remediation', 'mitigation', 'storm damage', 'water extraction', 'basement flood', 'tarp', 'board up', 'dry out'] },
  { id: 'general-contractor', label: 'General contractor', keywords: ['general contractor', 'contractor', 'remodel', 'remodeling', 'renovation', 'renovate', 'kitchen remodel', 'bathroom remodel', 'handyman', 'drywall', 'framing', 'building permit', 'construction', 'carpenter', 'deck', 'fence', 'fencing', 'flooring', 'concrete', 'foundation'] },
  { id: 'painting', label: 'Painting', keywords: ['painter', 'painting', 'house painter', 'interior paint', 'exterior paint', 'repaint', 'staining', 'cabinet painting'] },
  { id: 'pool-spa', label: 'Pool and spa', keywords: ['pool', 'pool service', 'pool cleaning', 'pool repair', 'hot tub', 'pool pump', 'pool opening', 'pool closing', 'swimming pool'] },
  { id: 'solar', label: 'Solar', keywords: ['solar', 'solar panel', 'solar panels', 'solar install', 'photovoltaic', 'battery backup', 'powerwall', 'net metering'] },
  { id: 'auto-glass', label: 'Auto glass', keywords: ['auto glass', 'windshield', 'windshield repair', 'windshield replacement', 'cracked windshield', 'car window', 'rock chip', 'chipped windshield'] },
  { id: 'auto-body', label: 'Auto body and dent repair', keywords: ['auto body', 'body shop', 'collision repair', 'dent repair', 'paintless dent', 'hail dent', 'hail dents', 'dented car', 'bumper', 'fender bender', 'car paint', 'car wreck'] },
  { id: 'towing', label: 'Towing and roadside', keywords: ['tow truck', 'towing', 'roadside assistance', 'jump start', 'dead battery', 'flat tire', 'stuck car', 'wrecker', 'lockout'] },
  { id: 'auto-repair', label: 'Auto repair', keywords: ['mechanic', 'auto repair', 'car repair', 'brakes', 'oil change', 'transmission', 'check engine', 'tire shop', 'tires', 'car won\'t start', 'smog', 'inspection sticker', 'alignment', 'battery replacement'] },
  { id: 'moving', label: 'Moving', keywords: ['mover', 'movers', 'moving company', 'moving help', 'moving truck', 'moving service', 'u-haul help', 'relocation', 'piano moving', 'loading help'] },
  { id: 'junk-removal', label: 'Junk removal and hauling', keywords: ['junk removal', 'junk hauling', 'haul away', 'hauling', 'dumpster', 'trash removal', 'debris removal', 'cleanout', 'estate cleanout', 'bulk pickup', 'furniture removal'] },
  { id: 'locksmith', label: 'Locksmith', keywords: ['locksmith', 'locked out', 'rekey', 're-key', 'lock change', 'lock repair', 'key replacement', 'smart lock', 'deadbolt'] },
  { id: 'real-estate', label: 'Real estate', keywords: ['realtor', 'real estate agent', 'real estate', 'home buyer', 'house hunting', 'selling my house', 'sell my home', 'listing agent', 'property manager', 'property management', 'home inspector', 'appraiser', 'mortgage broker'] },
  { id: 'insurance', label: 'Insurance', keywords: ['insurance', 'insurance agent', 'insurance claim', 'adjuster', 'public adjuster', 'homeowners insurance', 'auto insurance', 'flood insurance', 'renters insurance' ] },
  { id: 'food-truck', label: 'Food truck', keywords: ['food truck', 'food trucks', 'street food', 'taco truck', 'mobile kitchen', 'pop up kitchen', 'pop-up kitchen', 'vendor', 'vendors', 'street vendor'] },
  { id: 'catering', label: 'Catering', keywords: ['caterer', 'catering', 'catered', 'buffet', 'party food', 'meal prep', 'box lunches', 'private chef', 'bbq catering', 'event food'] },
  { id: 'event-services', label: 'Event services', keywords: ['dj', 'photographer', 'photography', 'event planner', 'event planning', 'party rental', 'tent rental', 'bounce house', 'wedding', 'balloon', 'florist', 'event rental', 'videographer', 'photo booth', 'stage rental', 'porta potty', 'portable toilet'] },
  { id: 'rideshare-delivery', label: 'Rideshare and delivery driving', keywords: ['uber', 'lyft', 'rideshare', 'ride share', 'doordash', 'ubereats', 'uber eats', 'grubhub', 'instacart', 'delivery driver', 'courier', 'airport ride', 'airport pickup', 'shuttle', 'taxi' ] },
  { id: 'childcare', label: 'Childcare', keywords: ['babysitter', 'babysitting', 'nanny', 'daycare', 'child care', 'childcare', 'after school care', 'preschool', 'au pair', 'summer camp', 'tutor', 'tutoring'] },
  { id: 'beauty', label: 'Hair and beauty', keywords: ['hair stylist', 'hairdresser', 'barber', 'braider', 'hair braiding', 'salon', 'nail tech', 'nails', 'lash tech', 'lashes', 'esthetician', 'makeup artist', 'wig install', 'massage', 'waxing', 'haircut'] },
  { id: 'janitorial-commercial', label: 'Commercial cleaning', keywords: ['janitorial', 'commercial cleaning', 'office cleaning', 'janitor', 'custodial', 'building maintenance', 'floor waxing', 'floor stripping', 'post construction cleanup', 'post-construction cleaning', 'restaurant cleaning', 'hood cleaning'] },
  { id: 'security', label: 'Security', keywords: ['security guard', 'security guards', 'security camera', 'security cameras', 'alarm system', 'home security', 'cctv', 'doorbell camera', 'surveillance', 'break-in', 'burglary', 'security system', 'event security'] },
];

export const CATEGORY_IDS: CategoryId[] = CATEGORIES.map((c) => c.id);

const CATEGORY_BY_ID = new Map<CategoryId, Category>(CATEGORIES.map((c) => [c.id, c]));

export function categoryById(id: string): Category | undefined {
  return CATEGORY_BY_ID.get(id as CategoryId);
}

export function isCategoryId(id: string): id is CategoryId {
  return CATEGORY_BY_ID.has(id as CategoryId);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

// Compiled once. Keywords match on word boundaries with an optional plural suffix.
const MATCHERS: { id: CategoryId; re: RegExp }[] = CATEGORIES.map((c) => ({
  id: c.id,
  re: new RegExp(
    `(?<![a-z0-9])(?:${c.keywords.map((k) => escapeRe(k.toLowerCase())).join('|')})(?:s|es)?(?![a-z0-9])`,
    'i',
  ),
}));

/** Keyword classifier: returns every category with at least one keyword hit, in CATEGORIES order. */
export function classifyText(text: string): CategoryId[] {
  if (!text) return [];
  const t = text.toLowerCase().replace(/[‘’]/g, "'");
  const out: CategoryId[] = [];
  for (const m of MATCHERS) if (m.re.test(t)) out.push(m.id);
  return out;
}
