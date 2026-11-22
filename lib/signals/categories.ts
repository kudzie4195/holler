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
  | 'security'
  | 'fencing'
  | 'concrete-paving'
  | 'windows-doors'
  | 'siding-gutters'
  | 'flooring'
  | 'handyman'
  | 'signs-printing'
  | 'business-services'
  | 'public-adjuster';

export type CategoryGroup = 'home' | 'storm' | 'auto' | 'business' | 'food-events' | 'other';

export const CATEGORY_GROUPS: { id: CategoryGroup; label: string }[] = [
  { id: 'home', label: 'Home and property' },
  { id: 'storm', label: 'Storm and disaster' },
  { id: 'auto', label: 'Auto' },
  { id: 'business', label: 'Business services' },
  { id: 'food-events', label: 'Food and events' },
  { id: 'other', label: 'Other services' },
];

export interface Category {
  id: CategoryId;
  label: string;
  group: CategoryGroup;
  keywords: string[];
}

export const CATEGORIES: Category[] = [
  { id: 'roofing', label: 'Roofing', group: 'home', keywords: ['roof', 'roofer', 'roofing', 'shingle', 'shingles', 'roof leak', 'hail damage', 'gutter', 'gutters', 'siding'] },
  { id: 'hvac', label: 'Heating and air (HVAC)', group: 'home', keywords: ['hvac', 'air conditioning', 'air conditioner', 'a/c', 'furnace', 'heater', 'heat pump', 'ac repair', 'ac unit', 'heating and cooling', 'no heat', 'ductwork', 'thermostat'] },
  { id: 'plumbing', label: 'Plumbing', group: 'home', keywords: ['plumber', 'plumbing', 'burst pipe', 'frozen pipe', 'frozen pipes', 'leaking pipe', 'water heater', 'clogged drain', 'sewer line', 'toilet', 'garbage disposal', 'sump pump'] },
  { id: 'electrical', label: 'Electrical', group: 'home', keywords: ['electrician', 'electrical', 'power outage', 'breaker', 'outlet', 'wiring', 'generator', 'panel upgrade', 'ev charger'] },
  { id: 'tree-service', label: 'Tree service', group: 'storm', keywords: ['tree removal', 'tree service', 'tree trimming', 'arborist', 'fallen tree', 'downed tree', 'tree down', 'stump', 'stump grinding', 'storm debris', 'limbs'] },
  { id: 'landscaping', label: 'Landscaping', group: 'home', keywords: ['landscaper', 'landscaping', 'landscape', 'mulch', 'retaining wall', 'irrigation', 'lawn sprinkler', 'hardscape', 'garden design', 'patio'] },
  { id: 'lawn-care', label: 'Lawn care', group: 'home', keywords: ['lawn care', 'lawn service', 'lawn mowing', 'mowing', 'mow', 'yard work', 'lawn guy', 'lawn', 'weed control', 'fertilizer', 'aeration', 'yard cleanup'] },
  { id: 'snow-removal', label: 'Snow removal', group: 'storm', keywords: ['snow removal', 'snow plow', 'snow plowing', 'plow', 'plowing', 'snow shoveling', 'shovel', 'de-icing', 'deicing', 'salting', 'ice removal', 'driveway snow'] },
  { id: 'pest-control', label: 'Pest control', group: 'home', keywords: ['pest control', 'exterminator', 'termite', 'termites', 'roach', 'roaches', 'cockroach', 'bed bug', 'bed bugs', 'rodent', 'rodents', 'mice', 'rats', 'ants', 'wasp', 'hornet', 'mosquito', 'infestation'] },
  { id: 'cleaning', label: 'House cleaning', group: 'home', keywords: ['house cleaning', 'house cleaner', 'maid', 'maid service', 'cleaning lady', 'deep clean', 'deep cleaning', 'move out clean', 'move-out clean', 'housekeeper', 'pressure washing', 'power washing', 'window cleaning', 'carpet cleaning'] },
  { id: 'restoration', label: 'Water, fire and storm restoration', group: 'storm', keywords: ['restoration', 'water damage', 'flood damage', 'flooding', 'fire damage', 'smoke damage', 'mold', 'mold remediation', 'mitigation', 'storm damage', 'water extraction', 'basement flood', 'tarp', 'board up', 'dry out'] },
  { id: 'general-contractor', label: 'General contractor', group: 'home', keywords: ['general contractor', 'contractor', 'remodel', 'remodeling', 'renovation', 'renovate', 'kitchen remodel', 'bathroom remodel', 'handyman', 'drywall', 'framing', 'building permit', 'construction', 'carpenter', 'deck', 'fence', 'fencing', 'flooring', 'concrete', 'foundation'] },
  { id: 'painting', label: 'Painting', group: 'home', keywords: ['painter', 'painting', 'house painter', 'interior paint', 'exterior paint', 'repaint', 'staining', 'cabinet painting'] },
  { id: 'pool-spa', label: 'Pool and spa', group: 'home', keywords: ['pool', 'pool service', 'pool cleaning', 'pool repair', 'hot tub', 'pool pump', 'pool opening', 'pool closing', 'swimming pool'] },
  { id: 'solar', label: 'Solar', group: 'home', keywords: ['solar', 'solar panel', 'solar panels', 'solar install', 'photovoltaic', 'battery backup', 'powerwall', 'net metering'] },
  { id: 'auto-glass', label: 'Auto glass', group: 'auto', keywords: ['auto glass', 'windshield', 'windshield repair', 'windshield replacement', 'cracked windshield', 'car window', 'rock chip', 'chipped windshield'] },
  { id: 'auto-body', label: 'Auto body and dent repair', group: 'auto', keywords: ['auto body', 'body shop', 'collision repair', 'dent repair', 'paintless dent', 'hail dent', 'hail dents', 'dented car', 'bumper', 'fender bender', 'car paint', 'car wreck'] },
  { id: 'towing', label: 'Towing and roadside', group: 'auto', keywords: ['tow truck', 'towing', 'roadside assistance', 'jump start', 'dead battery', 'flat tire', 'stuck car', 'wrecker', 'lockout'] },
  { id: 'auto-repair', label: 'Auto repair', group: 'auto', keywords: ['mechanic', 'auto repair', 'car repair', 'brakes', 'oil change', 'transmission', 'check engine', 'tire shop', 'tires', 'car won\'t start', 'smog', 'inspection sticker', 'alignment', 'battery replacement'] },
  { id: 'moving', label: 'Moving', group: 'other', keywords: ['mover', 'movers', 'moving company', 'moving help', 'moving truck', 'moving service', 'u-haul help', 'relocation', 'piano moving', 'loading help'] },
  { id: 'junk-removal', label: 'Junk removal and hauling', group: 'home', keywords: ['junk removal', 'junk hauling', 'haul away', 'hauling', 'dumpster', 'trash removal', 'debris removal', 'cleanout', 'estate cleanout', 'bulk pickup', 'furniture removal'] },
  { id: 'locksmith', label: 'Locksmith', group: 'home', keywords: ['locksmith', 'locked out', 'rekey', 're-key', 'lock change', 'lock repair', 'key replacement', 'smart lock', 'deadbolt'] },
  { id: 'real-estate', label: 'Real estate', group: 'other', keywords: ['realtor', 'real estate agent', 'real estate', 'home buyer', 'house hunting', 'selling my house', 'sell my home', 'listing agent', 'property manager', 'property management', 'home inspector', 'appraiser', 'mortgage broker'] },
  { id: 'insurance', label: 'Insurance', group: 'business', keywords: ['insurance', 'insurance agent', 'insurance claim', 'adjuster', 'public adjuster', 'homeowners insurance', 'auto insurance', 'flood insurance', 'renters insurance' ] },
  { id: 'food-truck', label: 'Food truck', group: 'food-events', keywords: ['food truck', 'food trucks', 'street food', 'taco truck', 'mobile kitchen', 'pop up kitchen', 'pop-up kitchen', 'vendor', 'vendors', 'street vendor'] },
  { id: 'catering', label: 'Catering', group: 'food-events', keywords: ['caterer', 'catering', 'catered', 'buffet', 'party food', 'meal prep', 'box lunches', 'private chef', 'bbq catering', 'event food'] },
  { id: 'event-services', label: 'Event services', group: 'food-events', keywords: ['dj', 'photographer', 'photography', 'event planner', 'event planning', 'party rental', 'tent rental', 'bounce house', 'wedding', 'balloon', 'florist', 'event rental', 'videographer', 'photo booth', 'stage rental', 'porta potty', 'portable toilet'] },
  { id: 'rideshare-delivery', label: 'Rideshare and delivery driving', group: 'other', keywords: ['uber', 'lyft', 'rideshare', 'ride share', 'doordash', 'ubereats', 'uber eats', 'grubhub', 'instacart', 'delivery driver', 'courier', 'airport ride', 'airport pickup', 'shuttle', 'taxi' ] },
  { id: 'childcare', label: 'Childcare', group: 'other', keywords: ['babysitter', 'babysitting', 'nanny', 'daycare', 'child care', 'childcare', 'after school care', 'preschool', 'au pair', 'summer camp', 'tutor', 'tutoring'] },
  { id: 'beauty', label: 'Hair and beauty', group: 'other', keywords: ['hair stylist', 'hairdresser', 'barber', 'braider', 'hair braiding', 'salon', 'nail tech', 'nails', 'lash tech', 'lashes', 'esthetician', 'makeup artist', 'wig install', 'massage', 'waxing', 'haircut'] },
  { id: 'janitorial-commercial', label: 'Commercial cleaning', group: 'business', keywords: ['janitorial', 'commercial cleaning', 'office cleaning', 'janitor', 'custodial', 'building maintenance', 'floor waxing', 'floor stripping', 'post construction cleanup', 'post-construction cleaning', 'restaurant cleaning', 'hood cleaning'] },
  { id: 'security', label: 'Security', group: 'business', keywords: ['security guard', 'security guards', 'security camera', 'security cameras', 'alarm system', 'home security', 'cctv', 'doorbell camera', 'surveillance', 'break-in', 'burglary', 'security system', 'event security'] },
  { id: 'fencing', label: 'Fencing', group: 'home', keywords: ['fence', 'fencing', 'fence installation', 'fence repair', 'fence company', 'chain link', 'privacy fence', 'wood fence', 'vinyl fence', 'iron fence', 'gate installation', 'fence contractor'] },
  { id: 'concrete-paving', label: 'Concrete and paving', group: 'home', keywords: ['concrete contractor', 'concrete work', 'driveway paving', 'driveway replacement', 'new driveway', 'driveway repair', 'driveway installation', 'paving', 'paver', 'pavers', 'asphalt', 'sidewalk repair', 'patio slab', 'stamped concrete', 'flatwork', 'sealcoating', 'blacktop', 'concrete'] },
  { id: 'windows-doors', label: 'Windows and doors', group: 'home', keywords: ['window replacement', 'replacement windows', 'new windows', 'window installation', 'window installer', 'door replacement', 'entry door', 'front door', 'garage door', 'sliding door', 'patio door', 'storm door', 'windows and doors', 'door installation'] },
  { id: 'siding-gutters', label: 'Siding and gutters', group: 'home', keywords: ['siding', 'vinyl siding', 'gutter', 'gutters', 'gutter cleaning', 'gutter installation', 'seamless gutters', 'downspout', 'fascia', 'soffit', 'gutter guards'] },
  { id: 'flooring', label: 'Flooring', group: 'home', keywords: ['flooring', 'hardwood floors', 'hardwood floor', 'floor installation', 'laminate flooring', 'vinyl plank', 'tile installer', 'tile installation', 'carpet installation', 'refinish floors', 'floor refinishing', 'epoxy floor'] },
  { id: 'handyman', label: 'Handyman', group: 'home', keywords: ['handyman', 'handy man', 'odd jobs', 'home repair', 'small repairs', 'minor repairs', 'honey do', 'furniture assembly', 'tv mounting', 'drywall patch', 'caulking'] },
  { id: 'signs-printing', label: 'Signs and printing', group: 'business', keywords: ['sign shop', 'signage', 'custom signs', 'storefront sign', 'banner', 'banners', 'vinyl banner', 'yard signs', 'business cards', 'flyers', 'printing', 'print shop', 'vehicle wrap', 'vehicle wraps', 'window decals', 'screen printing', 't-shirt printing'] },
  { id: 'business-services', label: 'Bookkeeping, payroll and IT setup', group: 'business', keywords: ['bookkeeping', 'bookkeeper', 'payroll', 'point of sale', 'pos system', 'it support', 'it setup', 'managed it', 'network setup', 'accounting', 'accountant', 'tax preparation', 'tax preparer', 'business consultant', 'web design', 'virtual assistant', 'cybersecurity', 'wifi setup', 'merchant services', 'credit card processing'] },
  { id: 'public-adjuster', label: 'Public adjuster', group: 'storm', keywords: ['public adjuster', 'public adjusters', 'insurance adjuster', 'claim denied', 'claim denial', 'underpaid claim', 'insurance claim help', 'storm claim', 'hail claim', 'roof claim', 'supplement claim'] },
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
