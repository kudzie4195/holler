/**
 * Per-trade facts for /for/<trade> pages. One entry per CategoryId in lib/signals/categories.ts
 * (the labels and groups are read from CATEGORIES at runtime; only the writing lives here).
 * tests/seo/trade-pages.test.ts fails when a CategoryId has no entry here, or an entry has no matching id.
 *
 * Each trade names 3 to 5 signal types that matter and one specific sentence on why each means work.
 * Signal types are the ones Holler actually collects: weather alerts, storm reports (hail, wind, tornado),
 * FEMA disaster declarations, earthquakes, building permits, 311 requests, inspections, new business
 * licenses, code violations, federal contracts, events, airport delays and public posts asking for a
 * recommendation. City record types exist only where a city publishes them.
 */
import type { SignalTypeId } from '@/lib/signals/capabilities';

export interface TradeSignal {
  signal: string;
  /** Which kind of record this sentence is about. The page shows it only when the trade really receives that type (TRADE_SIGNALS). */
  type: SignalTypeId;
  why: string;
}

export interface TradeFacts {
  /** Plural noun for the people on the page: "roofers". */
  noun: string;
  /** H1 and title stem: "Storm and hail alerts for roofers". */
  headline: string;
  /** One or two sentences under the headline that say what this trade gets. */
  lead: string;
  /**
   * Replacement headline and lead for a deployment where an optional key is missing and the default text leans on the signal type that
   * key feeds ('ask' or 'event'). Used by tradeHeadline and tradeLead in trade-view.ts. Only needed when the default names that type.
   */
  keyless?: { headline: string; lead: string };
  signals: TradeSignal[];
}

export const TRADE_FACTS: Record<string, TradeFacts> = {
  roofing: {
    noun: 'roofers',
    headline: 'Storm and hail alerts for roofers',
    lead: 'Hail and wind reports tell a roofer where to look. Holler shows you which towns just had one, with a link to the public report.',
    signals: [
      { signal: 'Hail reports', type: 'storm-report', why: 'Quarter-size hail in a town is worth a drive: owners nearby may want their roofs looked at. The report does not confirm damage.' },
      { signal: 'Wind and tornado reports', type: 'storm-report', why: 'Shingles lift and flashing tears long before anyone sees a leak, so a damaging-wind report is an early sign that roofs nearby may need a look.' },
      { signal: 'Severe thunderstorm and tornado warnings', type: 'weather-alert', why: 'A warning tells you which ZIP codes to watch once the storm clears.' },
      { signal: 'Federal disaster declarations', type: 'disaster', why: 'Insured storm claims flow after a declaration, and homeowners start calling roofers the same week.' },
      { signal: 'People asking for a roofer', type: 'ask', why: 'Someone posted publicly that they need a recommendation. Reply fast and you may be the only quote they get.' },
    ],
  },
  hvac: {
    noun: 'HVAC contractors',
    headline: 'Heat wave and cold snap alerts for HVAC companies',
    lead: 'Systems fail when the weather is at its worst. Holler flags the heat advisories and hard freezes that bring the emergency calls.',
    signals: [
      { signal: 'Excessive heat warnings', type: 'weather-alert', why: 'The first 95-degree week finds every weak compressor in town, and the calls start that afternoon.' },
      { signal: 'Winter storm and hard freeze warnings', type: 'weather-alert', why: 'Furnaces that were fine in October quit under a cold snap, and no-heat calls cannot wait.' },
      { signal: 'Storm and wind reports', type: 'storm-report', why: 'Lightning and power surges during a damaging storm burn out control boards and condensers, which is a repair order for you.' },
      { signal: 'Building permits for new construction and remodels', type: 'permit', why: 'A permit for a new house or addition means a system will be sized, bid and installed.' },
      { signal: 'People asking for AC or heating help', type: 'ask', why: 'A public post saying the AC died is someone asking for help right now.' },
    ],
  },
  plumbing: {
    noun: 'plumbers',
    headline: 'Freeze and flood alerts for plumbers',
    lead: 'Burst pipes, backed-up sewers and water heaters that quit all follow the weather. Holler watches freeze and flood warnings near you and links each one to its public source.',
    signals: [
      { signal: 'Freeze warnings and winter storms', type: 'weather-alert', why: 'Pipes in unheated crawl spaces split overnight, and the calls come in the morning when the thaw starts.' },
      { signal: 'Flood and flash flood warnings', type: 'weather-alert', why: 'Sump pumps fail and sewer lines back up when the ground is saturated.' },
      { signal: '311 water and sewer complaints', type: '311', why: 'A cluster of complaints on one street can mean a failed line that private plumbers get hired to fix on the property side.' },
      { signal: 'Building permits for remodels and new builds', type: 'permit', why: 'Every kitchen or bath remodel permit needs rough-in and fixtures from a licensed plumber.' },
      { signal: 'People asking for a plumber', type: 'ask', why: 'Someone is standing in an inch of water and typing. That post will not stay unanswered long.' },
    ],
  },
  electrical: {
    noun: 'electricians',
    headline: 'Storm and permit alerts for electricians',
    lead: 'Storms knock out service drops, and new construction needs wiring. Holler watches both sides of your calendar.',
    signals: [
      { signal: 'Severe storm and wind reports', type: 'storm-report', why: 'Torn-off service masts and fallen limbs on lines leave homeowners who cannot get power restored until an electrician signs off.' },
      { signal: 'Building permits for panel upgrades, EV chargers and remodels', type: 'permit', why: 'The permit already says electrical work is coming. It does not say who will do it.' },
      { signal: 'Federal disaster declarations', type: 'disaster', why: 'Rebuilding after a declared disaster means weeks of rewiring and inspections.' },
      { signal: 'New business licenses', type: 'business', why: 'A shop or office opening nearby needs lighting, outlets and signage wired before the doors open.' },
      { signal: 'Code violations', type: 'violation', why: 'A cited electrical hazard has a deadline, and the owner needs a licensed fix.' },
    ],
  },
  'tree-service': {
    noun: 'tree service crews',
    headline: 'Wind and storm alerts for tree service crews',
    lead: 'The best days in your business follow the worst weather. Holler tells you where the limbs came down.',
    signals: [
      { signal: 'Damaging wind and tornado reports', type: 'storm-report', why: 'A damaging-wind report marks where limbs may be down. Nobody with a tree on the driveway wants to wait a week.' },
      { signal: 'High wind and ice storm warnings', type: 'weather-alert', why: 'Ice-loaded limbs fail a day or two later, so the second wave of calls is predictable.' },
      { signal: 'Federal disaster declarations', type: 'disaster', why: 'Debris removal after a declared storm runs for weeks and often involves reimbursed cleanup contracts.' },
      { signal: '311 downed tree and hazard requests', type: '311', why: 'Residents report trees across property lines to the city, and the private side needs a crew.' },
      { signal: 'People asking for tree removal', type: 'ask', why: 'A public request for a stump or leaning tree quote is a job with a name and a street attached.' },
    ],
  },
  landscaping: {
    noun: 'landscapers',
    headline: 'Permit and code violation alerts for landscapers',
    lead: 'A new house is finished with bare dirt around it. Holler shows you new-home permits near you, with the street address, and the yards a city has cited.',
    signals: [
      { signal: 'Building permits for new homes and additions', type: 'permit', why: 'When the build is done, the yard still needs sod, beds or a lawn. Hang a flyer while the crews are finishing.' },
      { signal: 'New business licenses', type: 'business', why: 'A new restaurant or office with a patio usually wants planting and irrigation before opening day.' },
      { signal: 'Code violations for overgrowth and drainage', type: 'violation', why: 'A cited yard comes with a deadline. Some owners fix it themselves; others want a crew that can clear growth or fix grading.' },
      { signal: 'Flood and heavy rain warnings', type: 'weather-alert', why: 'Washouts and failed drainage lead to retaining walls, French drains and regrading calls.' },
      { signal: 'People asking for a landscaper', type: 'ask', why: 'Public requests for design or hardscape quotes show up every spring, and the first reply gets noticed.' },
    ],
  },
  // Round 23: this page promised "code violations for tall grass and weeds" and "311 overgrown lot complaints" everywhere. Measured
  // over 14 days of live records, 61 of the 65 named grass violations in the whole dataset are Austin and 4 are Chicago; Atlanta,
  // Charlotte and Raleigh have none, and most of what a lawn-care member really gets is new-home permits. The page now leads with the
  // permits, says where the named violations exist, and says what a new-home permit means for timing.
  'lawn-care': {
    noun: 'lawn care pros',
    headline: 'New-home permit and code violation alerts for lawn care pros',
    lead: 'Recurring mowing routes grow one house at a time. Holler points you at new yards going in near you, and at cited yards where the city names the problem.',
    signals: [
      { signal: 'Building permits for new homes', type: 'permit', why: 'A new house means a new owner with a fresh lawn and no mowing service yet. The yard goes in when the house is done, so this is a spring list, not a job this week.' },
      { signal: 'Code violations on a property', type: 'violation', why: 'The city has told an owner to fix something. Where the record names tall grass or an overgrown yard, Holler says so. Many counties write only "property violation", and Holler shows those words as they are.' },
      { signal: 'Severe storm and wind reports', type: 'storm-report', why: 'After a strong storm, limbs and leaves on lawns can mean one-time cleanups. A good cleanup can turn into a regular stop.' },
      { signal: '311 requests about yards and lots', type: '311', why: 'Where a city publishes overgrown-lot requests, Holler shows them by block. Not every city does.' },
      { signal: 'People asking for a lawn guy', type: 'ask', why: 'Someone posted that their mower guy quit. A quick, plain reply can turn into a weekly stop.' },
    ],
  },
  'snow-removal': {
    noun: 'snow plow operators',
    headline: 'Winter storm alerts for snow removal crews',
    lead: 'You make money on a handful of storms a year. Holler gives you the warning and the follow-up work.',
    signals: [
      { signal: 'Winter storm and blizzard warnings', type: 'weather-alert', why: 'A warning 24 hours out is time to confirm contracts, fuel trucks and call in the crew.' },
      { signal: 'Ice storm and freezing rain warnings', type: 'weather-alert', why: 'Salting and de-icing calls spike even when there is no plowable snow.' },
      { signal: 'Airport delays and ground stops', type: 'airport', why: 'A stop at the local airport tells you the storm is real and the roads will follow.' },
      { signal: 'New business licenses', type: 'business', why: 'A new storefront needs a lot cleared before the first winter, and most owners shop for a plow contract in the fall.' },
      { signal: 'People asking for plowing', type: 'ask', why: 'Someone with a driveway and a deadline is already posting. Seasonal contracts often start from one reply.' },
    ],
  },
  'pest-control': {
    noun: 'pest control companies',
    headline: 'Inspection and complaint alerts for pest control companies',
    lead: 'Pests are a public-record problem more often than you would think. Holler surfaces the inspections and complaints that point to a call.',
    signals: [
      { signal: 'Failed restaurant and food inspections', type: 'inspection', why: 'A pest finding on an inspection report comes with a re-inspection date, which is a deadline for a service visit.' },
      { signal: '311 rodent and pest complaints', type: '311', why: 'A cluster on one block points to a building owner who needs a treatment plan.' },
      { signal: 'New business licenses', type: 'business', why: 'Restaurants, daycares and grocers need a pest contract before they pass their first inspection.' },
      { signal: 'Flood and heavy rain warnings', type: 'weather-alert', why: 'Wet ground drives ants, roaches and rodents indoors within days.' },
      { signal: 'People asking for an exterminator', type: 'ask', why: 'A post about termites or bed bugs is urgent by nature. Reply first and fairly.' },
    ],
  },
  cleaning: {
    noun: 'house cleaners and pressure washers',
    headline: 'New-home and request alerts for cleaners and pressure washers',
    lead: 'Most cleaning work comes from people asking a neighbor for a name. Holler shows you who asked, and where new homes are permitted.',
    keyless: { headline: 'New-home and remodel alerts for cleaners and pressure washers', lead: 'A finished build needs a first clean, inside and out. Holler shows you new-home and remodel permits near you, with the street address.' },
    signals: [
      { signal: 'People asking for a cleaner', type: 'ask', why: 'Someone posted for a recurring or move-out clean. A good reply in the first hour gets read first.' },
      { signal: 'Building permits for new homes', type: 'permit', why: 'A finished build needs a post-construction clean before the owners move in.' },
      { signal: 'Federal disaster declarations', type: 'disaster', why: 'Households recovering from smoke or water damage need deep cleaning after the restoration crew leaves.' },
      { signal: 'New business licenses', type: 'business', why: 'A new salon or small office will need regular cleaning, and the license says it is opening.' },
      { signal: 'Severe storm reports', type: 'storm-report', why: 'Dust, mud and debris from a storm lead to one-time cleaning calls.' },
    ],
  },
  restoration: {
    noun: 'restoration companies',
    headline: 'Water, fire and storm damage alerts for restoration companies',
    lead: 'The first 48 hours decide who gets the job. Holler gives you the flood, fire and storm signals in the order they appear.',
    signals: [
      { signal: 'Flash flood and flood warnings', type: 'weather-alert', why: 'Basements fill fast, and water extraction has to start before mold does.' },
      { signal: 'Hail and wind reports', type: 'storm-report', why: 'Roof damage lets rain in, and the interior water claim follows the next storm.' },
      { signal: 'Federal disaster declarations', type: 'disaster', why: 'A declaration opens aid and insurance claims that fund weeks of mitigation work.' },
      { signal: 'Freeze warnings', type: 'weather-alert', why: 'Burst pipes flood a house while the owners are away, and the claim is almost always insured.' },
      { signal: 'People asking about water damage', type: 'ask', why: 'A homeowner posting about a soaked carpet needs a company that answers tonight.' },
    ],
  },
  'general-contractor': {
    noun: 'general contractors',
    headline: 'Building permit alerts for general contractors',
    lead: 'A permit means a project is real enough to file. Holler lists them as the city publishes them, with the address and the permit type.',
    signals: [
      { signal: 'Building permits for remodels and additions', type: 'permit', why: 'Owner-filed permits sometimes have no contractor named, which means the project is open to a bid.' },
      { signal: 'Code violations', type: 'violation', why: 'A cited property has a deadline and a budget, and the owner needs a builder to meet it.' },
      { signal: 'Federal contracts', type: 'contract', why: 'Awards and opportunities with a local place of performance show where public construction money is going.' },
      { signal: 'Federal disaster declarations', type: 'disaster', why: 'Rebuilding work follows a declaration for months, and small crews get hired by the dozen.' },
      { signal: 'People asking for a contractor', type: 'ask', why: 'A homeowner who asks neighbors for a name usually has a project ready and a quote request out.' },
    ],
  },
  painting: {
    noun: 'painters',
    headline: 'Code violation and storm report alerts for painters',
    lead: 'Fresh paint is the last step of almost every project. Holler shows you cited exteriors and storm damage while the job is still open.',
    signals: [
      { signal: 'Building permits for new homes and remodels', type: 'permit', why: 'Every finished build and gut remodel ends with a full interior and exterior paint job.' },
      { signal: 'Code violations for peeling paint and exteriors', type: 'violation', why: 'A citation has a clear fix and a deadline, so the owner wants a quote now.' },
      { signal: 'New business licenses', type: 'business', why: 'A new shop or office wants its walls and trim painted before opening.' },
      { signal: 'Hail and storm reports', type: 'storm-report', why: 'Storm-damaged siding and trim get repainted after repairs, often as part of an insurance job.' },
      { signal: 'People asking for a painter', type: 'ask', why: 'Public posts about repainting a room or a house are quote requests with a deadline.' },
    ],
  },
  'pool-spa': {
    noun: 'pool and spa pros',
    headline: 'Heat wave, storm and permit alerts for pool companies',
    lead: 'Pool work is seasonal and weather-driven. Holler tells you when the season turns and where pools are being built.',
    signals: [
      { signal: 'Excessive heat warnings', type: 'weather-alert', why: 'A hot spell sends homeowners to their pools, and neglected ones go green in a week.' },
      { signal: 'Severe storm and wind reports', type: 'storm-report', why: 'Storms fill pools with leaves and debris and knock out pumps and equipment.' },
      { signal: 'Building permits for pools and spas', type: 'permit', why: 'A pool permit means a new owner who will need a service plan, chemicals and a cover.' },
      { signal: 'Code violations for green or unfenced pools', type: 'violation', why: 'A citation forces a quick cleanup, and the owner often has no idea where to start.' },
      { signal: 'People asking for pool service', type: 'ask', why: 'A weekly service route is often won by the first company to answer a public question.' },
    ],
  },
  solar: {
    noun: 'solar installers',
    headline: 'Permit alerts for solar installers',
    lead: 'A roof or panel permit is the moment a homeowner is ready to hear about solar. Holler lists those permits where cities publish them.',
    signals: [
      { signal: 'Hail and wind reports', type: 'storm-report', why: 'A new roof is the cheapest time to add panels, and damaged roofs get replaced soon after.' },
      { signal: 'People asking for solar', type: 'ask', why: 'A homeowner posting that the power bill doubled and asking who installs panels is a shopper with a bill and a deadline.' },
      { signal: 'Excessive heat warnings', type: 'weather-alert', why: 'High summer bills and strained grids bring solar questions to the front of mind.' },
      { signal: 'Building permits for roofs and electrical upgrades', type: 'permit', why: 'A roof or panel permit is the right moment to pitch a solar and storage package.' },
      { signal: 'Federal contracts', type: 'contract', why: 'Public energy and facilities awards nearby can signal commercial solar demand.' },
    ],
  },
  'auto-glass': {
    noun: 'auto glass shops',
    headline: 'Hail and storm alerts for auto glass shops',
    lead: 'Big hail and windshields do not mix. Holler tells you which towns had a hail report, often before the claims come in.',
    signals: [
      { signal: 'Hail reports', type: 'storm-report', why: 'Quarter-size hail cracks windshields on every parked car in its path, and insurers often cover glass fully.' },
      { signal: 'High wind and tornado reports', type: 'storm-report', why: 'Flying debris chips and breaks glass, and mobile repair is what drivers search for next.' },
      { signal: 'Winter storm warnings', type: 'weather-alert', why: 'Road salt and gravel on icy roads mean more chips that spread into cracks in the cold.' },
      { signal: 'Federal disaster declarations', type: 'disaster', why: 'Fleet and household glass claims rise after a declared storm.' },
      { signal: 'People asking for windshield repair', type: 'ask', why: 'A driver who posts about a crack wants a same-week appointment and a price.' },
    ],
  },
  'auto-body': {
    noun: 'body shops',
    headline: 'Hail damage alerts for auto body and dent repair shops',
    lead: 'Paintless dent repair crews chase hail. Body shops get the claims that follow. Holler tells you where it fell.',
    signals: [
      { signal: 'Hail reports', type: 'storm-report', why: 'A report of golf-ball hail means hundreds of dented hoods and roofs in one ZIP code.' },
      { signal: 'Wind, tornado and flood warnings', type: 'weather-alert', why: 'Fallen limbs, flood-damaged cars and debris create collision and cosmetic repairs.' },
      { signal: 'Winter storm warnings', type: 'weather-alert', why: 'Icy roads bring a wave of fender benders in the first 48 hours.' },
      { signal: 'Federal disaster declarations', type: 'disaster', why: 'Claim volume jumps after a declared event, and shops with capacity get the overflow.' },
      { signal: 'People asking for a body shop', type: 'ask', why: 'A public post after a fender bender usually has an insurance estimate attached.' },
    ],
  },
  towing: {
    noun: 'tow operators',
    headline: 'Storm and road-condition alerts for towing companies',
    lead: 'Bad weather fills ditches and kills batteries. Holler tells you when to put another driver on the board.',
    signals: [
      { signal: 'Winter storm and ice warnings', type: 'weather-alert', why: 'Cars slide off roads in the first hour of freezing rain, and every one needs a tow.' },
      { signal: 'Flash flood warnings', type: 'weather-alert', why: 'Stalled cars in flooded underpasses are a recovery job and an impound opportunity.' },
      { signal: 'Cold snap advisories', type: 'weather-alert', why: 'Batteries die the first morning below freezing, which brings a flood of jump-start and roadside calls.' },
      { signal: 'Event notices', type: 'event', why: 'Big events mean tight parking, illegally parked cars and stranded vehicles after the crowd leaves.' },
      { signal: 'Airport delays', type: 'airport', why: 'Long delays and cancellations leave cars sitting in lots, and some do not start when the traveler returns.' },
    ],
  },
  'auto-repair': {
    noun: 'auto repair shops',
    headline: 'Cold snap and flood alerts for auto repair shops',
    lead: 'Weather breaks cars on a schedule. Holler tells you when it is about to, so you can staff the bays.',
    signals: [
      { signal: 'Cold snap and hard freeze warnings', type: 'weather-alert', why: 'Weak batteries and thin coolant fail the first very cold morning, and the shop phone starts at 7 a.m.' },
      { signal: 'Excessive heat warnings', type: 'weather-alert', why: 'Overheating engines and failed AC compressors cluster in the first heat wave.' },
      { signal: 'Flash flood warnings', type: 'weather-alert', why: 'Cars that drove through standing water show up with stalled engines and electrical faults.' },
      { signal: 'Hail reports', type: 'storm-report', why: 'Not just dents. Cracked lenses and damaged trim send owners looking for a shop that can do the whole job.' },
      { signal: 'People asking for a mechanic', type: 'ask', why: 'Someone posted that a warning light came on and they do not know who to trust.' },
    ],
  },
  moving: {
    noun: 'movers',
    headline: 'Permit alerts for moving companies',
    lead: 'Moves follow construction. Holler lists building permits where cities publish them, so you can see where homes are about to open.',
    signals: [
      { signal: 'Building permits for new homes and apartments', type: 'permit', why: 'A finished building turns into dozens of move-ins within weeks.' },
      { signal: 'New business licenses', type: 'business', why: 'A business that just registered at a new address often needs office or shop moving help.' },
      { signal: 'Federal contracts', type: 'contract', why: 'Public contracts with a local place of performance can mean agencies or contractors relocating staff and equipment.' },
      { signal: 'Federal disaster declarations', type: 'disaster', why: 'Displaced households need furniture moved to storage and then back home.' },
      { signal: 'People asking for movers', type: 'ask', why: 'A public post about a move next weekend is a dated, priced-by-the-hour job.' },
    ],
  },
  'junk-removal': {
    noun: 'junk haulers',
    headline: 'Storm debris and cleanout alerts for junk removal crews',
    lead: 'Cleanouts follow storms, foreclosures and renovations. Holler tells you where the pile is about to grow.',
    signals: [
      { signal: 'Severe storm and wind reports', type: 'storm-report', why: 'Fallen fences, soaked furniture and yard debris turn into haul-away jobs within days.' },
      { signal: 'Flood warnings', type: 'weather-alert', why: 'Flooded basements mean carpet, drywall and furniture at the curb.' },
      { signal: 'Code violations for debris and unkempt property', type: 'violation', why: 'A cited owner has a deadline to clear it out.' },
      { signal: 'Building permits for demolition and remodels', type: 'permit', why: 'Demo leaves debris, and a contractor often wants a hauler on call.' },
      { signal: '311 illegal dumping and bulk-item complaints', type: '311', why: 'Where residents report piles, private haulers get the paid cleanups.' },
    ],
  },
  locksmith: {
    noun: 'locksmiths',
    headline: 'New-business alerts for locksmiths',
    lead: 'Locksmith work is part emergency and part scheduled. Holler shows new businesses that need locks, and people posting that they are locked out.',
    keyless: { headline: 'New-business alerts for locksmiths', lead: 'Locksmith work is part emergency and part scheduled. Holler shows new businesses that need locks.' },
    signals: [
      { signal: 'New business licenses', type: 'business', why: 'A new shop or office needs locks keyed, rekeyed or fitted with access control before opening.' },
      { signal: 'Building permits for new homes and remodels', type: 'permit', why: 'New doors and hardware go in at the end of every build.' },
      { signal: 'Storm and wind reports', type: 'storm-report', why: 'Damaged doors and broken frames after a storm need a lock repair or a board-up.' },
      { signal: 'Federal disaster declarations', type: 'disaster', why: 'Displaced residents and repaired properties often need rekeying after restoration work.' },
      { signal: 'People asking for a locksmith', type: 'ask', why: 'Someone locked out is posting from a phone on the curb. Speed matters.' },
    ],
  },
  'real-estate': {
    noun: 'real estate agents',
    headline: 'Permit alerts for real estate agents',
    lead: 'The market moves with construction. Holler turns building permits into talking points for your area.',
    signals: [
      { signal: 'Building permits for new homes', type: 'permit', why: 'New construction in a neighborhood tells you where inventory and buyers are about to show up.' },
      { signal: 'New business licenses', type: 'business', why: 'A cluster of new businesses points to a neighborhood that is getting busier and more valuable.' },
      { signal: 'Storm and hail reports', type: 'storm-report', why: 'Damaged roofs create sellers who want to list before repairs and buyers who want a discount.' },
      { signal: 'Federal disaster declarations', type: 'disaster', why: 'A declaration changes insurance costs and lending in an area, which every client asks you about.' },
      { signal: 'People asking for an agent', type: 'ask', why: 'A public request for a recommended agent comes from someone already thinking of a move.' },
    ],
  },
  insurance: {
    noun: 'insurance agents',
    headline: 'Storm and disaster alerts for insurance agents',
    lead: 'Clients call their agent after the storm, and prospects start shopping. Holler tells you what happened before the phone rings.',
    signals: [
      { signal: 'Hail and wind reports', type: 'storm-report', why: 'Your policyholders in that town will file claims, and some will ask whether their deductible is worth paying.' },
      { signal: 'Federal disaster declarations', type: 'disaster', why: 'A declaration brings coverage questions from people who now realize what they are missing.' },
      { signal: 'Flood warnings', type: 'weather-alert', why: 'Flood damage is excluded from standard homeowner policies, so these calls become flood coverage conversations.' },
      { signal: 'New business licenses', type: 'business', why: 'A new business needs liability, property and workers comp before it can open.' },
      { signal: 'Building permits for new homes', type: 'permit', why: 'A buyer of a new house needs a policy by closing day.' },
    ],
  },
  'food-truck': {
    noun: 'food truck owners',
    headline: 'Event and crowd alerts for food trucks',
    lead: 'Where the crowd goes, the line forms. Holler lists the big events nearby so you can book a spot before the day.',
    keyless: { headline: 'Event permit alerts for food trucks', lead: 'Where the crowd goes, the line forms. Holler lists the city event permits nearby so you can book a spot before the day.' },
    signals: [
      { signal: 'Big events and concerts', type: 'event', why: 'A sold-out show or game puts thousands of hungry people within walking distance of a curb.' },
      { signal: 'City event permits', type: 'event-permit', why: 'Street fairs and festivals often need vendors, and organizers fill those spots weeks ahead.' },
      { signal: 'Federal contracts for construction and facilities', type: 'contract', why: 'Large job sites and crews on public projects often welcome a lunch truck.' },
      { signal: 'Weather alerts', type: 'weather-alert', why: 'Rain, heat and wind warnings tell you whether to skip an outdoor day.' },
      { signal: 'People asking for food trucks', type: 'ask', why: 'Someone planning a party or office lunch is looking for a truck to book.' },
    ],
  },
  catering: {
    noun: 'caterers',
    headline: 'Event alerts for caterers',
    lead: 'Catering is booked weeks ahead. Holler shows you the events and public projects that need food.',
    keyless: { headline: 'Event permit alerts for caterers', lead: 'Catering is booked weeks ahead. Holler shows you the event permits and public projects that need food.' },
    signals: [
      { signal: 'Big events', type: 'event', why: 'Conventions, tournaments and festivals bring organizers, sponsors and hospitality suites that need food.' },
      { signal: 'New business licenses', type: 'business', why: 'A new office or shop often throws a grand opening with food, and the owner has not booked it yet.' },
      { signal: 'Federal contracts', type: 'contract', why: 'A funded local project means kickoff meetings, trainings and staff lunches.' },
      { signal: 'Weather alerts', type: 'weather-alert', why: 'Severe weather can force an outdoor event to move inside or push a date, and caterers are first to hear.' },
      { signal: 'People asking for a caterer', type: 'ask', why: 'A public post for a wedding, office lunch or graduation is a booking request with a headcount.' },
    ],
  },
  'event-services': {
    noun: 'event service pros',
    headline: 'Big event alerts for DJs, photographers and rental crews',
    lead: 'Events pull in suppliers from miles around. Holler lists the large ones nearby so you can pitch before the vendor list closes.',
    keyless: { headline: 'Event permit alerts for DJs, photographers and rental crews', lead: 'Events pull in suppliers from miles around. Holler lists the permitted ones nearby so you can pitch before the vendor list closes.' },
    signals: [
      { signal: 'Big events and festivals', type: 'event', why: 'Organizers hire sound, lighting, photo and rental crews, usually weeks before the date.' },
      { signal: 'City event permits', type: 'event-permit', why: 'A permit for a street event means someone is already planning and has a budget.' },
      { signal: 'New business licenses', type: 'business', why: 'New venues and restaurants book launch events, and they often want photos and music.' },
      { signal: 'Weather alerts', type: 'weather-alert', why: 'Wind and storm warnings affect tents and outdoor stages, so rental crews have to plan.' },
      { signal: 'People asking for a DJ or photographer', type: 'ask', why: 'Wedding and party posts come with a date and usually a budget in the comments.' },
    ],
  },
  'rideshare-delivery': {
    noun: 'rideshare and delivery drivers',
    headline: 'Airport delay and event alerts for rideshare and delivery drivers',
    lead: 'Demand spikes when plans change. Holler tells you where the surge is about to be.',
    keyless: { headline: 'Airport delay alerts for rideshare and delivery drivers', lead: 'Demand spikes when plans change. Holler tells you about airport delays and weather that change where riders and orders go.' },
    signals: [
      { signal: 'Airport delays and ground stops', type: 'airport', why: 'Stranded travelers book rides and order food to the terminal, and a ground stop puts a wave of riders in your lane.' },
      { signal: 'Big events', type: 'event', why: 'Crowds leaving a stadium all want a ride in the same 20 minutes.' },
      { signal: 'Winter storm and heavy rain warnings', type: 'weather-alert', why: 'People who normally drive stay home and order delivery, and riders go up in the rain.' },
      { signal: 'Excessive heat warnings', type: 'weather-alert', why: 'Hot days push more people to order food in and take a car for short trips.' },
      { signal: 'Federal disaster declarations', type: 'disaster', why: 'Evacuations and road closures reshape demand for days.' },
    ],
  },
  childcare: {
    noun: 'childcare providers',
    headline: 'Parent request alerts for childcare providers',
    lead: 'Parents look for care when schedules break. Holler shows you the public posts where a parent asks for a nanny, sitter or daycare near you.',
    keyless: { headline: 'Alerts for childcare providers', lead: "Holler's childcare alerts depend on a source that is not switched on for this launch, so there is nothing to send childcare providers yet." },
    signals: [
      { signal: 'Winter storm and severe weather warnings', type: 'weather-alert', why: 'School closures leave families scrambling for same-day care.' },
      { signal: 'Federal disaster declarations', type: 'disaster', why: 'Displaced families and recovery workers need care for kids while they rebuild.' },
      { signal: 'New business licenses', type: 'business', why: 'A new office or clinic means new staff with young children and no care lined up.' },
      { signal: 'Building permits for new homes', type: 'permit', why: 'New neighborhoods fill with young families within a year of the first move-ins.' },
      { signal: 'People asking for a nanny or sitter', type: 'ask', why: 'A parent who posts is usually ready to interview this week.' },
    ],
  },
  beauty: {
    noun: 'hair and beauty pros',
    headline: 'Client request alerts for hair and beauty pros',
    lead: 'Beauty bookings follow weddings, proms and big nights out. Holler shows you the public posts where someone asks for a stylist.',
    keyless: { headline: 'Alerts for hair and beauty pros', lead: "Holler's beauty alerts depend on a source that is not switched on for this launch, so there is nothing to send hair and beauty pros yet." },
    signals: [
      { signal: 'Big events', type: 'event', why: 'Concerts, galas and festivals send clients looking for hair, nails and makeup the same week.' },
      { signal: 'New business licenses', type: 'business', why: 'A new salon or suite nearby may need booth renters or stylists, and a new office means clients.' },
      { signal: 'Building permits for new homes and apartments', type: 'permit', why: 'New residents are looking for a stylist before they know the area.' },
      { signal: 'Weather alerts', type: 'weather-alert', why: 'Storms and freezes cancel appointments. A heads-up lets you fill the day.' },
      { signal: 'People asking for a stylist', type: 'ask', why: 'A public post for a wedding party or a new cut is a booking in waiting.' },
    ],
  },
  'janitorial-commercial': {
    noun: 'commercial cleaning companies',
    headline: 'New-business and inspection alerts for commercial cleaners',
    lead: 'Commercial cleaning contracts run for years. Holler shows the new businesses and build-outs near you, before they open.',
    signals: [
      { signal: 'New business licenses', type: 'business', why: 'A business that just registered at an address needs a cleaning vendor before it opens.' },
      { signal: 'Building permits for commercial build-outs', type: 'permit', why: 'A build-out ends with a post-construction clean and then a recurring contract.' },
      { signal: 'Federal contracts', type: 'contract', why: 'Public facilities contracts with a local place of performance often include janitorial scopes or subcontract needs.' },
      { signal: 'Failed health inspections', type: 'inspection', why: 'A restaurant that failed an inspection has a re-inspection date and a reason to hire help.' },
      { signal: 'Severe storm and flood reports', type: 'storm-report', why: 'Offices that took on water or dust need a deep clean before reopening.' },
    ],
  },
  security: {
    noun: 'security companies',
    headline: 'Event permit and new-business alerts for security companies',
    lead: 'Guards and alarm systems are hired around events and openings. Holler shows you where the need is forming.',
    signals: [
      { signal: 'Big events', type: 'event', why: 'Concerts and festivals require licensed guards, and organizers book them weeks ahead.' },
      { signal: 'New business licenses', type: 'business', why: 'A new shop or office needs cameras, alarms and sometimes a guard before it stocks the shelves.' },
      { signal: 'Federal disaster declarations', type: 'disaster', why: 'Damaged buildings are vulnerable to theft until they are secured, and owners hire watch services.' },
      { signal: 'Code violations for vacant or unsecured buildings', type: 'violation', why: 'A cited vacant building is a liability the owner wants watched.' },
      { signal: 'Building permits for commercial construction', type: 'permit', why: 'Job sites hire overnight security to stop theft of tools and materials.' },
    ],
  },
  fencing: {
    noun: 'fence contractors',
    headline: 'Permit and code violation alerts for fence contractors',
    lead: 'Fences go up with new homes and get cited when they fall down. Holler shows you the permits and the violations.',
    signals: [
      { signal: 'Building permits for fences and new homes', type: 'permit', why: 'A fence permit is a signed-off job, and a new house usually wants a fence within the year.' },
      { signal: 'High wind and tornado reports', type: 'storm-report', why: 'Wood panels and posts fail first in a windstorm, which makes repair and replace quotes.' },
      { signal: 'Code violations for broken fences and pool barriers', type: 'violation', why: 'A citation sets a deadline, so the owner wants a crew soon.' },
      { signal: 'Federal disaster declarations', type: 'disaster', why: 'Rebuilding after a storm includes miles of fence line.' },
      { signal: 'People asking for a fence installer', type: 'ask', why: 'A homeowner with a dog and a gap in the yard is posting for quotes.' },
    ],
  },
  'concrete-paving': {
    noun: 'concrete and paving crews',
    headline: 'Permit and code violation alerts for concrete and paving crews',
    lead: 'Flatwork and asphalt are the first and last things on a building project. Holler spots both.',
    signals: [
      { signal: 'Building permits for new construction', type: 'permit', why: 'Footings, slabs, driveways and sidewalks all come from the same permit.' },
      { signal: 'Code violations for cracked sidewalks and drives', type: 'violation', why: 'Cities cite owners for trip hazards and the owner has to pay for the repair.' },
      { signal: 'Federal contracts', type: 'contract', why: 'Public road and facility awards nearby create subcontract work for local crews.' },
      { signal: 'Freeze and thaw warnings', type: 'weather-alert', why: 'Cycles of freezing and thawing crack slabs and pavement, and repair calls follow in spring.' },
      { signal: '311 pothole and sidewalk complaints', type: '311', why: 'Complaints on private lots and business parking areas mean a paving quote.' },
    ],
  },
  'windows-doors': {
    noun: 'window and door installers',
    headline: 'Permit and code violation alerts for window and door installers',
    lead: 'New builds need doors and windows, and cited properties need repairs. Holler shows you both.',
    signals: [
      { signal: 'Hail reports', type: 'storm-report', why: 'Large hail breaks window glazing and dents frames, and insurers often pay for replacement.' },
      { signal: 'High wind and tornado reports', type: 'storm-report', why: 'Doors and windows fail under pressure and flying debris, so board-up and replacement follow.' },
      { signal: 'Building permits for remodels and new homes', type: 'permit', why: 'Replacement windows and doors are written right into many remodel permits.' },
      { signal: 'Code violations', type: 'violation', why: 'Broken windows and damaged entries on cited properties have to be fixed by a deadline.' },
      { signal: 'People asking for a window company', type: 'ask', why: 'A homeowner comparing quotes for drafty windows posts for neighbors to weigh in.' },
    ],
  },
  'siding-gutters': {
    noun: 'siding and gutter crews',
    headline: 'Permit and code violation alerts for siding and gutter crews',
    lead: 'A new roof often brings new gutters. Holler shows you the roof and new-home permits near you, with the street address, and the exteriors a city has cited.',
    signals: [
      { signal: 'Hail reports', type: 'storm-report', why: 'Hail can dent gutters and crack siding. The report does not confirm damage, but owners nearby may want a look.' },
      { signal: 'High wind and tornado reports', type: 'storm-report', why: 'Strong wind can peel siding and pull gutters loose. A report marks the area, not the damage.' },
      { signal: 'Building permits for remodels and re-siding', type: 'permit', why: 'A siding or roof permit means the outside of the house is being worked on, and gutters often come up at the same time.' },
      { signal: 'Federal disaster declarations', type: 'disaster', why: 'After a declared disaster, owners may wait weeks for a crew, so local help can matter.' },
      { signal: 'Code violations for exterior repair', type: 'violation', why: 'A cited exterior comes with a date to fix it by.' },
    ],
  },
  flooring: {
    noun: 'flooring installers',
    headline: 'Permit alerts for flooring pros',
    lead: 'Flooring goes in at the end of every build. Holler finds the remodel and new-home permits while the job is still open.',
    signals: [
      { signal: 'Flood and flash flood warnings', type: 'weather-alert', why: 'Water-damaged carpet and hardwood has to be torn out and replaced after mitigation.' },
      { signal: 'Building permits for remodels and new homes', type: 'permit', why: 'Flooring is one of the last and largest line items in any finished project.' },
      { signal: 'New business licenses', type: 'business', why: 'A new shop or clinic needs commercial flooring before opening day.' },
      { signal: 'Federal disaster declarations', type: 'disaster', why: 'Rebuilding after a declared event includes floors in thousands of homes.' },
      { signal: 'People asking for flooring help', type: 'ask', why: 'A homeowner choosing between tile and vinyl is already shopping for an installer.' },
    ],
  },
  handyman: {
    noun: 'handymen',
    headline: 'Code violation and 311 alerts for handymen',
    lead: 'Handyman work is small repairs with a deadline. Holler shows you where the repairs are being demanded.',
    signals: [
      { signal: 'Code violations', type: 'violation', why: 'Cited owners need small repairs done quickly, from railings to broken steps, and cannot wait for a big contractor.' },
      { signal: '311 property complaints', type: '311', why: 'Complaints about peeling paint, broken gates or debris point to an owner with a to-do list.' },
      { signal: 'Severe storm and wind reports', type: 'storm-report', why: 'Torn screens, loose siding and fallen fences are small jobs in huge numbers after a storm.' },
      { signal: 'Building permits for small remodels', type: 'permit', why: 'Minor permits often mean punch lists and finish work the main contractor will not do.' },
      { signal: 'People asking for a handyman', type: 'ask', why: 'These posts come with a to-do list and a deadline, and one reply can fill a Saturday.' },
    ],
  },
  'signs-printing': {
    noun: 'sign and print shops',
    headline: 'New-business alerts for sign and print shops',
    lead: 'Every new business needs a sign. Holler shows you who is registering, and who is posting that they need a printer.',
    keyless: { headline: 'New-business alerts for sign and print shops', lead: 'Every new business needs a sign. Holler shows you who is registering.' },
    signals: [
      { signal: 'New business licenses', type: 'business', why: 'A business that has just registered needs a storefront sign, window graphics and printed menus or cards.' },
      { signal: 'Building permits for commercial build-outs', type: 'permit', why: 'A permit for a storefront build-out usually comes with a sign permit and a rush to open.' },
      { signal: 'Big events', type: 'event', why: 'Organizers and vendors order banners, tickets, shirts and wayfinding signs weeks ahead.' },
      { signal: 'Code violations for signage', type: 'violation', why: 'A cited sign has to be replaced or taken down by a deadline.' },
      { signal: 'People asking for a printer', type: 'ask', why: 'A public request for a banner or a run of shirts is a clear brief with a date.' },
    ],
  },
  'business-services': {
    noun: 'business service providers',
    headline: 'New-business license alerts for accountants, bookkeepers and other business services',
    lead: 'New companies need help they have never needed before. Holler shows you who just registered nearby.',
    signals: [
      { signal: 'New business licenses', type: 'business', why: 'A freshly licensed business needs bookkeeping, tax setup, insurance, a website or a payroll provider in its first month.' },
      { signal: 'Federal contracts', type: 'contract', why: 'Awardees with a local place of performance often need compliance, accounting and subcontracting help.' },
      { signal: 'Building permits for commercial build-outs', type: 'permit', why: 'An owner spending money on a build-out is about to open and has a long setup list.' },
      { signal: 'Federal disaster declarations', type: 'disaster', why: 'Businesses affected by a disaster need records, loan paperwork and claims support.' },
      { signal: 'People asking for an accountant or consultant', type: 'ask', why: 'A public post asking who to hire is the clearest sign of a buyer.' },
    ],
  },
  'public-adjuster': {
    noun: 'public adjusters',
    headline: 'Storm and disaster alerts for public adjusters',
    lead: 'Policyholders hire a public adjuster after a loss. Holler tells you where storms and disasters were just reported.',
    signals: [
      { signal: 'Hail and wind reports', type: 'storm-report', why: 'Roof and exterior damage over a wide area means many insured homeowners who are about to meet their carrier.' },
      { signal: 'Federal disaster declarations', type: 'disaster', why: 'A declaration marks the start of a long claim season with disputes over scope and value.' },
      { signal: 'Flood and flash flood warnings', type: 'weather-alert', why: 'Water losses are often disputed, and owners look for someone who works for them.' },
      { signal: 'Freeze warnings', type: 'weather-alert', why: 'Burst-pipe claims are common and carriers push back on the extent of damage.' },
      { signal: 'People asking about a claim', type: 'ask', why: 'A homeowner posting about a denied or low claim is looking for help right now.' },
    ],
  },
};
