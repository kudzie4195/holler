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
export interface TradeSignal {
  signal: string;
  why: string;
}

export interface TradeFacts {
  /** Plural noun for the people on the page: "roofers". */
  noun: string;
  /** H1 and title stem: "Storm and hail alerts for roofers". */
  headline: string;
  /** One or two sentences under the headline that say what this trade gets. */
  lead: string;
  signals: TradeSignal[];
}

export const TRADE_FACTS: Record<string, TradeFacts> = {
  roofing: {
    noun: 'roofers',
    headline: 'Storm and hail alerts for roofers',
    lead: 'Hail and wind do the selling for a roofer. Holler tells you which towns just took a hit, while the homeowners are still looking at the ceiling stain.',
    signals: [
      { signal: 'Hail reports', why: 'A report of quarter-size hail in a town usually means a whole neighborhood of roofs to inspect within days.' },
      { signal: 'Wind and tornado reports', why: 'Shingles lift and flashing tears long before anyone sees a leak, so a damaging-wind report is a lead list in waiting.' },
      { signal: 'Severe thunderstorm and tornado warnings', why: 'A warning tells you which zip codes to canvass first once the storm clears.' },
      { signal: 'Federal disaster declarations', why: 'Insured storm claims flow after a declaration, and homeowners start calling roofers the same week.' },
      { signal: 'People asking for a roofer', why: 'Someone posted publicly that they need a recommendation. Reply fast and you may be the only quote they get.' },
    ],
  },
  hvac: {
    noun: 'HVAC contractors',
    headline: 'Heat wave and cold snap alerts for HVAC companies',
    lead: 'Systems fail when the weather is at its worst. Holler flags the heat advisories and hard freezes that bring the emergency calls.',
    signals: [
      { signal: 'Excessive heat warnings', why: 'The first 95-degree week finds every weak compressor in town, and the calls start that afternoon.' },
      { signal: 'Winter storm and hard freeze warnings', why: 'Furnaces that were fine in October quit under a cold snap, and no-heat calls cannot wait.' },
      { signal: 'Power outage and storm reports', why: 'Surges after an outage take out control boards and condensers, which is a repair order for you.' },
      { signal: 'Building permits for new construction and remodels', why: 'A permit for a new house or addition means a system will be sized, bid and installed.' },
      { signal: 'People asking for AC or heating help', why: 'A public post saying the AC died is about as warm as a lead gets.' },
    ],
  },
  plumbing: {
    noun: 'plumbers',
    headline: 'Freeze and flood alerts for plumbers',
    lead: 'Burst pipes, backed-up sewers and water heaters that quit all follow the weather. Holler warns you before the phone starts ringing.',
    signals: [
      { signal: 'Freeze warnings and winter storms', why: 'Pipes in unheated crawl spaces split overnight, and the calls come in the morning when the thaw starts.' },
      { signal: 'Flood and flash flood warnings', why: 'Sump pumps fail and sewer lines back up when the ground is saturated.' },
      { signal: '311 water and sewer complaints', why: 'A cluster of complaints on one street can mean a failed line that private plumbers get hired to fix on the property side.' },
      { signal: 'Building permits for remodels and new builds', why: 'Every kitchen or bath remodel permit needs rough-in and fixtures from a licensed plumber.' },
      { signal: 'People asking for a plumber', why: 'Someone is standing in an inch of water and typing. That post will not stay unanswered long.' },
    ],
  },
  electrical: {
    noun: 'electricians',
    headline: 'Outage, storm and permit alerts for electricians',
    lead: 'Storms knock out service drops, and new construction needs wiring. Holler watches both sides of your calendar.',
    signals: [
      { signal: 'Severe storm and wind reports', why: 'Torn-off service masts and fallen limbs on lines leave homeowners who cannot get power restored until an electrician signs off.' },
      { signal: 'Building permits for panel upgrades, EV chargers and remodels', why: 'The permit already says electrical work is coming, and the owner often has not hired anyone yet.' },
      { signal: 'Federal disaster declarations', why: 'Rebuilding after a declared disaster means weeks of rewiring and inspections.' },
      { signal: 'New business licenses', why: 'A shop or office opening nearby needs lighting, outlets and signage wired before the doors open.' },
      { signal: 'Code violations', why: 'A cited electrical hazard has a deadline, and the owner needs a licensed fix.' },
    ],
  },
  'tree-service': {
    noun: 'tree service crews',
    headline: 'Wind and storm alerts for tree service crews',
    lead: 'The best days in your business follow the worst weather. Holler tells you where the limbs came down.',
    signals: [
      { signal: 'Damaging wind and tornado reports', why: 'Each report is a town with trees on roofs, fences and driveways, and nobody wants to wait a week.' },
      { signal: 'High wind and ice storm warnings', why: 'Ice-loaded limbs fail a day or two later, so the second wave of calls is predictable.' },
      { signal: 'Federal disaster declarations', why: 'Debris removal after a declared storm runs for weeks and often involves reimbursed cleanup contracts.' },
      { signal: '311 downed tree and hazard requests', why: 'Residents report trees across property lines to the city, and the private side needs a crew.' },
      { signal: 'People asking for tree removal', why: 'A public request for a stump or leaning tree quote is a job with a name and a street attached.' },
    ],
  },
  landscaping: {
    noun: 'landscapers',
    headline: 'Permit and new-business alerts for landscapers',
    lead: 'New homes and new storefronts all need grass, beds and walls. Holler finds the permits before the lot is finished.',
    signals: [
      { signal: 'Building permits for new homes and additions', why: 'A finished house with bare dirt around it is a design and install job that starts when the permit closes.' },
      { signal: 'New business licenses', why: 'A new restaurant or office with a patio usually wants planting and irrigation before opening day.' },
      { signal: 'Code violations for overgrowth and drainage', why: 'A cited yard has a deadline, and the owner needs someone who can fix grading or clear growth.' },
      { signal: 'Flood and heavy rain warnings', why: 'Washouts and failed drainage lead to retaining walls, French drains and regrading calls.' },
      { signal: 'People asking for a landscaper', why: 'Public requests for design or hardscape quotes show up every spring, and the first reply gets noticed.' },
    ],
  },
  'lawn-care': {
    noun: 'lawn care pros',
    headline: 'Storm cleanup and new-home alerts for lawn care pros',
    lead: 'Recurring mowing routes grow one house at a time. Holler points you at new homes, cited yards and post-storm cleanup.',
    signals: [
      { signal: 'Building permits for new homes', why: 'A new house means a new owner with a fresh lawn and no mowing service yet.' },
      { signal: 'Code violations for tall grass and weeds', why: 'The city already told the owner to fix it. A weekly mowing contract solves the problem for good.' },
      { signal: 'Severe storm and wind reports', why: 'Limbs and leaves on lawns turn into one-time cleanup jobs that often convert to routes.' },
      { signal: '311 overgrown lot complaints', why: 'Neighbors reporting a lot to the city often means the owner needs help quickly.' },
      { signal: 'People asking for a lawn guy', why: 'Someone just posted that their mower guy quit. That is a route stop for the next reply.' },
    ],
  },
  'snow-removal': {
    noun: 'snow plow operators',
    headline: 'Winter storm alerts for snow removal crews',
    lead: 'You make money on a handful of storms a year. Holler gives you the warning and the follow-up work.',
    signals: [
      { signal: 'Winter storm and blizzard warnings', why: 'A warning 24 hours out is time to confirm contracts, fuel trucks and call in the crew.' },
      { signal: 'Ice storm and freezing rain warnings', why: 'Salting and de-icing calls spike even when there is no plowable snow.' },
      { signal: 'Airport delays and ground stops', why: 'A stop at the local airport tells you the storm is real and the roads will follow.' },
      { signal: 'New business licenses', why: 'A new storefront needs a lot cleared before the first winter, and most owners shop for a plow contract in the fall.' },
      { signal: 'People asking for plowing', why: 'Someone with a driveway and a deadline is already posting. Seasonal contracts often start from one reply.' },
    ],
  },
  'pest-control': {
    noun: 'pest control companies',
    headline: 'Inspection and complaint alerts for pest control companies',
    lead: 'Pests are a public-record problem more often than you would think. Holler surfaces the inspections and complaints that point to a call.',
    signals: [
      { signal: 'Failed restaurant and food inspections', why: 'A pest finding on an inspection report comes with a re-inspection date, which is a deadline for a service visit.' },
      { signal: '311 rodent and pest complaints', why: 'A cluster on one block points to a building owner who needs a treatment plan.' },
      { signal: 'New business licenses', why: 'Restaurants, daycares and grocers need a pest contract before they pass their first inspection.' },
      { signal: 'Flood and heavy rain warnings', why: 'Wet ground drives ants, roaches and rodents indoors within days.' },
      { signal: 'People asking for an exterminator', why: 'A post about termites or bed bugs is urgent by nature. Reply first and fairly.' },
    ],
  },
  cleaning: {
    noun: 'house cleaners',
    headline: 'New-home and request alerts for house cleaners',
    lead: 'Most cleaning work comes from people asking a neighbor for a name. Holler shows you who asked, and where new homes are opening.',
    signals: [
      { signal: 'People asking for a cleaner', why: 'Someone posted for a recurring or move-out clean. A good reply in the first hour often wins it.' },
      { signal: 'Building permits for new homes', why: 'A finished build needs a post-construction clean before the owners move in.' },
      { signal: 'Federal disaster declarations', why: 'Households recovering from smoke or water damage need deep cleaning after the restoration crew leaves.' },
      { signal: 'New business licenses', why: 'A new salon or small office needs regular cleaning, and the owner is picking a vendor right now.' },
      { signal: 'Severe storm reports', why: 'Dust, mud and debris from a storm lead to one-time cleaning calls.' },
    ],
  },
  restoration: {
    noun: 'restoration companies',
    headline: 'Water, fire and storm damage alerts for restoration companies',
    lead: 'The first 48 hours decide who gets the job. Holler gives you the flood, fire and storm signals in the order they appear.',
    signals: [
      { signal: 'Flash flood and flood warnings', why: 'Basements fill fast, and water extraction has to start before mold does.' },
      { signal: 'Hail and wind reports', why: 'Roof damage lets rain in, and the interior water claim follows the next storm.' },
      { signal: 'Federal disaster declarations', why: 'A declaration opens aid and insurance claims that fund weeks of mitigation work.' },
      { signal: 'Freeze warnings', why: 'Burst pipes flood a house while the owners are away, and the claim is almost always insured.' },
      { signal: 'People asking about water damage', why: 'A homeowner posting about a soaked carpet needs a company that answers tonight.' },
    ],
  },
  'general-contractor': {
    noun: 'general contractors',
    headline: 'Building permit alerts for general contractors',
    lead: 'A permit filed is a project that is real, funded and often still looking for a builder. Holler lists them as the city publishes them.',
    signals: [
      { signal: 'Building permits for remodels and additions', why: 'Owner-filed permits sometimes have no contractor named, which means the project is open to a bid.' },
      { signal: 'Code violations', why: 'A cited property has a deadline and a budget, and the owner needs a builder to meet it.' },
      { signal: 'Federal contracts', why: 'Awards and opportunities with a local place of performance show where public construction money is going.' },
      { signal: 'Federal disaster declarations', why: 'Rebuilding work follows a declaration for months, and small crews get hired by the dozen.' },
      { signal: 'People asking for a contractor', why: 'A homeowner who asks neighbors for a name usually has a project ready and a quote request out.' },
    ],
  },
  painting: {
    noun: 'painters',
    headline: 'Permit and code violation alerts for painters',
    lead: 'Fresh paint is the last step of almost every project. Holler lets you find the project at the first.',
    signals: [
      { signal: 'Building permits for new homes and remodels', why: 'Every finished build and gut remodel ends with a full interior and exterior paint job.' },
      { signal: 'Code violations for peeling paint and exteriors', why: 'A citation has a clear fix and a deadline, so the owner wants a quote now.' },
      { signal: 'New business licenses', why: 'A new shop or office wants its walls and trim painted before opening.' },
      { signal: 'Hail and storm reports', why: 'Storm-damaged siding and trim get repainted after repairs, often as part of an insurance job.' },
      { signal: 'People asking for a painter', why: 'Public posts about repainting a room or a house are quote requests with a deadline.' },
    ],
  },
  'pool-spa': {
    noun: 'pool and spa pros',
    headline: 'Heat wave, storm and permit alerts for pool companies',
    lead: 'Pool work is seasonal and weather-driven. Holler tells you when the season turns and where pools are being built.',
    signals: [
      { signal: 'Excessive heat warnings', why: 'A hot spell sends homeowners to their pools, and neglected ones go green in a week.' },
      { signal: 'Severe storm and wind reports', why: 'Storms fill pools with leaves and debris and knock out pumps and equipment.' },
      { signal: 'Building permits for pools and spas', why: 'A pool permit means a new owner who will need a service plan, chemicals and a cover.' },
      { signal: 'Code violations for green or unfenced pools', why: 'A citation forces a quick cleanup, and the owner often has no idea where to start.' },
      { signal: 'People asking for pool service', why: 'A weekly service route is often won by the first company to answer a public question.' },
    ],
  },
  solar: {
    noun: 'solar installers',
    headline: 'Hail, outage and permit alerts for solar installers',
    lead: 'Solar buyers act on rate hikes, outages and roof replacements. Holler flags the moments when they decide.',
    signals: [
      { signal: 'Hail and wind reports', why: 'A new roof is the cheapest time to add panels, and damaged roofs get replaced soon after.' },
      { signal: 'Power outage and storm reports', why: 'Long outages turn battery backup from a nice idea into a must-have for homeowners who just lost food and heat.' },
      { signal: 'Excessive heat warnings', why: 'High summer bills and strained grids bring solar questions to the front of mind.' },
      { signal: 'Building permits for roofs and electrical upgrades', why: 'A roof or panel permit is the right moment to pitch a solar and storage package.' },
      { signal: 'Federal contracts', why: 'Public energy and facilities awards nearby can signal commercial solar demand.' },
    ],
  },
  'auto-glass': {
    noun: 'auto glass shops',
    headline: 'Hail and storm alerts for auto glass shops',
    lead: 'One hailstorm cracks thousands of windshields. Holler tells you which town it hit before the claims come in.',
    signals: [
      { signal: 'Hail reports', why: 'Quarter-size hail cracks windshields on every parked car in its path, and insurers often cover glass fully.' },
      { signal: 'High wind and tornado reports', why: 'Flying debris chips and breaks glass, and mobile repair is what drivers search for next.' },
      { signal: 'Winter storm warnings', why: 'Road salt and gravel on icy roads mean more chips that spread into cracks in the cold.' },
      { signal: 'Federal disaster declarations', why: 'Fleet and household glass claims rise after a declared storm.' },
      { signal: 'People asking for windshield repair', why: 'A driver who posts about a crack wants a same-week appointment and a price.' },
    ],
  },
  'auto-body': {
    noun: 'body shops',
    headline: 'Hail damage alerts for auto body and dent repair shops',
    lead: 'Paintless dent repair crews chase hail. Body shops get the claims that follow. Holler tells you where it fell.',
    signals: [
      { signal: 'Hail reports', why: 'A report of golf-ball hail means hundreds of dented hoods and roofs in one zip code.' },
      { signal: 'Wind, tornado and flood warnings', why: 'Fallen limbs, flood-damaged cars and debris create collision and cosmetic repairs.' },
      { signal: 'Winter storm warnings', why: 'Icy roads bring a wave of fender benders in the first 48 hours.' },
      { signal: 'Federal disaster declarations', why: 'Claim volume jumps after a declared event, and shops with capacity get the overflow.' },
      { signal: 'People asking for a body shop', why: 'A public post after a fender bender usually has an insurance estimate attached.' },
    ],
  },
  towing: {
    noun: 'tow operators',
    headline: 'Storm and road-condition alerts for towing companies',
    lead: 'Bad weather fills ditches and kills batteries. Holler tells you when to put another driver on the board.',
    signals: [
      { signal: 'Winter storm and ice warnings', why: 'Cars slide off roads in the first hour of freezing rain, and every one needs a tow.' },
      { signal: 'Flash flood warnings', why: 'Stalled cars in flooded underpasses are a recovery job and an impound opportunity.' },
      { signal: 'Cold snap advisories', why: 'Batteries die the first morning below freezing, which brings a flood of jump-start and roadside calls.' },
      { signal: 'Event notices', why: 'Big events mean tight parking, illegally parked cars and stranded vehicles after the crowd leaves.' },
      { signal: 'Airport delays', why: 'Long delays and cancellations leave cars sitting in lots, and some do not start when the traveler returns.' },
    ],
  },
  'auto-repair': {
    noun: 'auto repair shops',
    headline: 'Cold snap and flood alerts for auto repair shops',
    lead: 'Weather breaks cars on a schedule. Holler tells you when it is about to, so you can staff the bays.',
    signals: [
      { signal: 'Cold snap and hard freeze warnings', why: 'Weak batteries and thin coolant fail the first very cold morning, and the shop phone starts at 7 a.m.' },
      { signal: 'Excessive heat warnings', why: 'Overheating engines and failed AC compressors cluster in the first heat wave.' },
      { signal: 'Flash flood warnings', why: 'Cars that drove through standing water show up with stalled engines and electrical faults.' },
      { signal: 'Hail reports', why: 'Not just dents. Cracked lenses and damaged trim send owners looking for a shop that can do the whole job.' },
      { signal: 'People asking for a mechanic', why: 'Someone posted that a warning light came on and they do not know who to trust.' },
    ],
  },
  moving: {
    noun: 'movers',
    headline: 'New-business and permit alerts for moving companies',
    lead: 'Moves follow construction and new leases. Holler shows where homes and offices are opening up.',
    signals: [
      { signal: 'Building permits for new homes and apartments', why: 'A finished building turns into dozens of move-ins within weeks.' },
      { signal: 'New business licenses', why: 'A business that just registered at a new address often needs office or shop moving help.' },
      { signal: 'Federal contracts', why: 'Public contracts with a local place of performance can mean agencies or contractors relocating staff and equipment.' },
      { signal: 'Federal disaster declarations', why: 'Displaced households need furniture moved to storage and then back home.' },
      { signal: 'People asking for movers', why: 'A public post about a move next weekend is a dated, priced-by-the-hour job.' },
    ],
  },
  'junk-removal': {
    noun: 'junk haulers',
    headline: 'Storm debris and cleanout alerts for junk removal crews',
    lead: 'Cleanouts follow storms, foreclosures and renovations. Holler tells you where the pile is about to grow.',
    signals: [
      { signal: 'Severe storm and wind reports', why: 'Fallen fences, soaked furniture and yard debris turn into haul-away jobs within days.' },
      { signal: 'Flood warnings', why: 'Flooded basements mean carpet, drywall and furniture at the curb.' },
      { signal: 'Code violations for debris and unkempt property', why: 'A cited owner has a deadline to clear it out.' },
      { signal: 'Building permits for demolition and remodels', why: 'Demo leaves debris, and a contractor often wants a hauler on call.' },
      { signal: '311 illegal dumping and bulk-item complaints', why: 'Where residents report piles, private haulers get the paid cleanups.' },
    ],
  },
  locksmith: {
    noun: 'locksmiths',
    headline: 'New-business and storm alerts for locksmiths',
    lead: 'Locksmith work is part emergency and part scheduled. Holler covers both sides.',
    signals: [
      { signal: 'New business licenses', why: 'A new shop or office needs locks keyed, rekeyed or fitted with access control before opening.' },
      { signal: 'Building permits for new homes and remodels', why: 'New doors and hardware go in at the end of every build.' },
      { signal: 'Storm and wind reports', why: 'Damaged doors and broken frames after a storm need a lock repair or a board-up.' },
      { signal: 'Federal disaster declarations', why: 'Displaced residents and repaired properties often need rekeying after restoration work.' },
      { signal: 'People asking for a locksmith', why: 'Someone locked out is posting from a phone on the curb. Speed matters.' },
    ],
  },
  'real-estate': {
    noun: 'real estate agents',
    headline: 'Permit and storm alerts for real estate agents',
    lead: 'The market moves with construction, disasters and new employers. Holler turns public records into talking points for your area.',
    signals: [
      { signal: 'Building permits for new homes', why: 'New construction in a neighborhood tells you where inventory and buyers are about to show up.' },
      { signal: 'New business licenses', why: 'A cluster of new businesses points to a neighborhood that is getting busier and more valuable.' },
      { signal: 'Storm and hail reports', why: 'Damaged roofs create sellers who want to list before repairs and buyers who want a discount.' },
      { signal: 'Federal disaster declarations', why: 'A declaration changes insurance costs and lending in an area, which every client asks you about.' },
      { signal: 'People asking for an agent', why: 'A public request for a recommended agent comes from someone already thinking of a move.' },
    ],
  },
  insurance: {
    noun: 'insurance agents',
    headline: 'Storm and disaster alerts for insurance agents',
    lead: 'Clients call their agent after the storm, and prospects start shopping. Holler tells you what happened before the phone rings.',
    signals: [
      { signal: 'Hail and wind reports', why: 'Your policyholders in that town will file claims, and some will ask whether their deductible is worth paying.' },
      { signal: 'Federal disaster declarations', why: 'A declaration brings coverage questions from people who now realize what they are missing.' },
      { signal: 'Flood warnings', why: 'Flood damage is excluded from standard homeowner policies, so these calls become flood coverage conversations.' },
      { signal: 'New business licenses', why: 'A new business needs liability, property and workers comp before it can open.' },
      { signal: 'Building permits for new homes', why: 'A buyer of a new house needs a policy by closing day.' },
    ],
  },
  'food-truck': {
    noun: 'food truck owners',
    headline: 'Event and crowd alerts for food trucks',
    lead: 'Where the crowd goes, the line forms. Holler lists the big events nearby so you can book a spot before the day.',
    signals: [
      { signal: 'Big events and concerts', why: 'A sold-out show or game puts thousands of hungry people within walking distance of a curb.' },
      { signal: 'City event permits', why: 'Street fairs and festivals often need vendors, and organizers fill those spots weeks ahead.' },
      { signal: 'Federal contracts for construction and facilities', why: 'Large job sites and crews on public projects often welcome a lunch truck.' },
      { signal: 'Weather alerts', why: 'Rain, heat and wind warnings tell you whether to skip an outdoor day.' },
      { signal: 'People asking for food trucks', why: 'Someone planning a party or office lunch is looking for a truck to book.' },
    ],
  },
  catering: {
    noun: 'caterers',
    headline: 'Event and new-business alerts for caterers',
    lead: 'Catering is booked weeks ahead. Holler shows you the events, openings and public projects that need food.',
    signals: [
      { signal: 'Big events', why: 'Conventions, tournaments and festivals bring organizers, sponsors and hospitality suites that need food.' },
      { signal: 'New business licenses', why: 'A new office or shop often throws a grand opening with food, and the owner has not booked it yet.' },
      { signal: 'Federal contracts', why: 'A funded local project means kickoff meetings, trainings and staff lunches.' },
      { signal: 'Weather alerts', why: 'Severe weather can force an outdoor event to move inside or push a date, and caterers are first to hear.' },
      { signal: 'People asking for a caterer', why: 'A public post for a wedding, office lunch or graduation is a booking request with a headcount.' },
    ],
  },
  'event-services': {
    noun: 'event service pros',
    headline: 'Big event alerts for DJs, photographers and rental crews',
    lead: 'Events pull in suppliers from miles around. Holler lists the large ones nearby so you can pitch before the vendor list closes.',
    signals: [
      { signal: 'Big events and festivals', why: 'Organizers hire sound, lighting, photo and rental crews, usually weeks before the date.' },
      { signal: 'City event permits', why: 'A permit for a street event means someone is already planning and has a budget.' },
      { signal: 'New business licenses', why: 'New venues and restaurants book launch events, and they often want photos and music.' },
      { signal: 'Weather alerts', why: 'Wind and storm warnings affect tents and outdoor stages, so rental crews have to plan.' },
      { signal: 'People asking for a DJ or photographer', why: 'Wedding and party posts come with a date and usually a budget in the comments.' },
    ],
  },
  'rideshare-delivery': {
    noun: 'rideshare and delivery drivers',
    headline: 'Airport delay, event and weather alerts for rideshare and delivery drivers',
    lead: 'Demand spikes when plans change. Holler tells you where the surge is about to be.',
    signals: [
      { signal: 'Airport delays and ground stops', why: 'Stranded travelers book rides and order food to the terminal, and a ground stop puts a wave of riders in your lane.' },
      { signal: 'Big events', why: 'Crowds leaving a stadium all want a ride in the same 20 minutes.' },
      { signal: 'Winter storm and heavy rain warnings', why: 'People who normally drive stay home and order delivery, and riders go up in the rain.' },
      { signal: 'Excessive heat warnings', why: 'Hot days push more people to order food in and take a car for short trips.' },
      { signal: 'Federal disaster declarations', why: 'Evacuations and road closures reshape demand for days.' },
    ],
  },
  childcare: {
    noun: 'childcare providers',
    headline: 'Weather and new-business alerts for childcare providers',
    lead: 'Parents look for care when schedules break. Holler flags the closures and the new employers that cause it.',
    signals: [
      { signal: 'Winter storm and severe weather warnings', why: 'School closures leave families scrambling for same-day care.' },
      { signal: 'Federal disaster declarations', why: 'Displaced families and recovery workers need care for kids while they rebuild.' },
      { signal: 'New business licenses', why: 'A new office or clinic means new staff with young children and no care lined up.' },
      { signal: 'Building permits for new homes', why: 'New neighborhoods fill with young families within a year of the first move-ins.' },
      { signal: 'People asking for a nanny or sitter', why: 'A parent who posts is usually ready to interview this week.' },
    ],
  },
  beauty: {
    noun: 'hair and beauty pros',
    headline: 'Event and new-business alerts for hair and beauty pros',
    lead: 'Beauty bookings follow weddings, proms, openings and big nights out. Holler shows you which are coming.',
    signals: [
      { signal: 'Big events', why: 'Concerts, galas and festivals send clients looking for hair, nails and makeup the same week.' },
      { signal: 'New business licenses', why: 'A new salon or suite nearby may need booth renters or stylists, and a new office means clients.' },
      { signal: 'Building permits for new homes and apartments', why: 'New residents are looking for a stylist before they know the area.' },
      { signal: 'Weather alerts', why: 'Storms and freezes cancel appointments. A heads-up lets you fill the day.' },
      { signal: 'People asking for a stylist', why: 'A public post for a wedding party or a new cut is a booking in waiting.' },
    ],
  },
  'janitorial-commercial': {
    noun: 'commercial cleaning companies',
    headline: 'New-business and permit alerts for commercial cleaners',
    lead: 'Commercial cleaning contracts run for years. Holler finds the buildings that are opening and the owners still choosing.',
    signals: [
      { signal: 'New business licenses', why: 'A business that just registered at an address needs a cleaning vendor before it opens.' },
      { signal: 'Building permits for commercial build-outs', why: 'A build-out ends with a post-construction clean and then a recurring contract.' },
      { signal: 'Federal contracts', why: 'Public facilities contracts with a local place of performance often include janitorial scopes or subcontract needs.' },
      { signal: 'Failed health inspections', why: 'A restaurant that failed an inspection has a re-inspection date and a reason to hire help.' },
      { signal: 'Severe storm and flood reports', why: 'Offices that took on water or dust need a deep clean before reopening.' },
    ],
  },
  security: {
    noun: 'security companies',
    headline: 'Event, new-business and violation alerts for security companies',
    lead: 'Guards and alarm systems are hired around events and openings. Holler shows you where the need is forming.',
    signals: [
      { signal: 'Big events', why: 'Concerts and festivals require licensed guards, and organizers book them weeks ahead.' },
      { signal: 'New business licenses', why: 'A new shop or office needs cameras, alarms and sometimes a guard before it stocks the shelves.' },
      { signal: 'Federal disaster declarations', why: 'Damaged buildings are vulnerable to theft until they are secured, and owners hire watch services.' },
      { signal: 'Code violations for vacant or unsecured buildings', why: 'A cited vacant building is a liability the owner wants watched.' },
      { signal: 'Building permits for commercial construction', why: 'Job sites hire overnight security to stop theft of tools and materials.' },
    ],
  },
  fencing: {
    noun: 'fence contractors',
    headline: 'Permit and storm alerts for fence contractors',
    lead: 'Fences go up with new homes and come down in the wind. Holler covers both.',
    signals: [
      { signal: 'Building permits for fences and new homes', why: 'A fence permit is a signed-off job, and a new house usually wants a fence within the year.' },
      { signal: 'High wind and tornado reports', why: 'Wood panels and posts fail first in a windstorm, which makes repair and replace quotes.' },
      { signal: 'Code violations for broken fences and pool barriers', why: 'A citation sets a deadline, so the owner wants a crew soon.' },
      { signal: 'Federal disaster declarations', why: 'Rebuilding after a storm includes miles of fence line.' },
      { signal: 'People asking for a fence installer', why: 'A homeowner with a dog and a gap in the yard is posting for quotes.' },
    ],
  },
  'concrete-paving': {
    noun: 'concrete and paving crews',
    headline: 'Permit and code violation alerts for concrete and paving crews',
    lead: 'Flatwork and asphalt are the first and last things on a building project. Holler spots both.',
    signals: [
      { signal: 'Building permits for new construction', why: 'Footings, slabs, driveways and sidewalks all come from the same permit.' },
      { signal: 'Code violations for cracked sidewalks and drives', why: 'Cities cite owners for trip hazards and the owner has to pay for the repair.' },
      { signal: 'Federal contracts', why: 'Public road and facility awards nearby create subcontract work for local crews.' },
      { signal: 'Freeze and thaw warnings', why: 'Cycles of freezing and thawing crack slabs and pavement, and repair calls follow in spring.' },
      { signal: '311 pothole and sidewalk complaints', why: 'Complaints on private lots and business parking areas mean a paving quote.' },
    ],
  },
  'windows-doors': {
    noun: 'window and door installers',
    headline: 'Hail, storm and permit alerts for window and door installers',
    lead: 'Storms break glass and new builds need openings. Holler tells you which.',
    signals: [
      { signal: 'Hail reports', why: 'Large hail breaks window glazing and dents frames, and insurers often pay for replacement.' },
      { signal: 'High wind and tornado reports', why: 'Doors and windows fail under pressure and flying debris, so board-up and replacement follow.' },
      { signal: 'Building permits for remodels and new homes', why: 'Replacement windows and doors are written right into many remodel permits.' },
      { signal: 'Code violations', why: 'Broken windows and damaged entries on cited properties have to be fixed by a deadline.' },
      { signal: 'People asking for a window company', why: 'A homeowner comparing quotes for drafty windows posts for neighbors to weigh in.' },
    ],
  },
  'siding-gutters': {
    noun: 'siding and gutter crews',
    headline: 'Hail, wind and permit alerts for siding and gutter crews',
    lead: 'Hail dents gutters and wind peels siding. Both show up in storm reports a few days before the quotes.',
    signals: [
      { signal: 'Hail reports', why: 'Dented gutters and cracked siding are easy for owners to spot and easy for insurers to approve.' },
      { signal: 'High wind and tornado reports', why: 'Siding panels peel and gutters pull away, and the owner needs a fix before the next rain.' },
      { signal: 'Building permits for remodels and re-siding', why: 'A siding permit is a job in progress, and gutters nearly always get replaced at the same time.' },
      { signal: 'Federal disaster declarations', why: 'Large claim volume means more homeowners and fewer available crews.' },
      { signal: 'Code violations for exterior repair', why: 'Cited exteriors have a cure date, and a quote request is next.' },
    ],
  },
  flooring: {
    noun: 'flooring installers',
    headline: 'Flood, permit and new-business alerts for flooring pros',
    lead: 'Floors are replaced after floods and installed at the end of every build. Holler finds both.',
    signals: [
      { signal: 'Flood and flash flood warnings', why: 'Water-damaged carpet and hardwood has to be torn out and replaced after mitigation.' },
      { signal: 'Building permits for remodels and new homes', why: 'Flooring is one of the last and largest line items in any finished project.' },
      { signal: 'New business licenses', why: 'A new shop or clinic needs commercial flooring before opening day.' },
      { signal: 'Federal disaster declarations', why: 'Rebuilding after a declared event includes floors in thousands of homes.' },
      { signal: 'People asking for flooring help', why: 'A homeowner choosing between tile and vinyl is already shopping for an installer.' },
    ],
  },
  handyman: {
    noun: 'handymen',
    headline: 'Code violation and 311 alerts for handymen',
    lead: 'Handyman work is small repairs with a deadline. Holler shows you where the repairs are being demanded.',
    signals: [
      { signal: 'Code violations', why: 'Cited owners need small repairs done quickly, from railings to broken steps, and cannot wait for a big contractor.' },
      { signal: '311 property complaints', why: 'Complaints about peeling paint, broken gates or debris point to an owner with a to-do list.' },
      { signal: 'Severe storm and wind reports', why: 'Torn screens, loose siding and fallen fences are small jobs in huge numbers after a storm.' },
      { signal: 'Building permits for small remodels', why: 'Minor permits often mean punch lists and finish work the main contractor will not do.' },
      { signal: 'People asking for a handyman', why: 'These posts come with a to-do list and a deadline, and one reply can fill a Saturday.' },
    ],
  },
  'signs-printing': {
    noun: 'sign and print shops',
    headline: 'New-business and event alerts for sign and print shops',
    lead: 'Every new business needs a sign and every event needs banners. Holler shows you who is opening and what is coming.',
    signals: [
      { signal: 'New business licenses', why: 'A business that has just registered needs a storefront sign, window graphics and printed menus or cards.' },
      { signal: 'Building permits for commercial build-outs', why: 'A permit for a storefront build-out usually comes with a sign permit and a rush to open.' },
      { signal: 'Big events and city event permits', why: 'Organizers and vendors order banners, tickets, shirts and wayfinding signs weeks ahead.' },
      { signal: 'Code violations for signage', why: 'A cited sign has to be replaced or taken down by a deadline.' },
      { signal: 'People asking for a printer', why: 'A public request for a banner or a run of shirts is a clear brief with a date.' },
    ],
  },
  'business-services': {
    noun: 'business service providers',
    headline: 'New-business license alerts for accountants, bookkeepers and other business services',
    lead: 'New companies need help they have never needed before. Holler shows you who just registered nearby.',
    signals: [
      { signal: 'New business licenses', why: 'A freshly licensed business needs bookkeeping, tax setup, insurance, a website or a payroll provider in its first month.' },
      { signal: 'Federal contracts', why: 'Awardees with a local place of performance often need compliance, accounting and subcontracting help.' },
      { signal: 'Building permits for commercial build-outs', why: 'An owner spending money on a build-out is about to open and has a long setup list.' },
      { signal: 'Federal disaster declarations', why: 'Businesses affected by a disaster need records, loan paperwork and claims support.' },
      { signal: 'People asking for an accountant or consultant', why: 'A public post asking who to hire is the clearest sign of a buyer.' },
    ],
  },
  'public-adjuster': {
    noun: 'public adjusters',
    headline: 'Storm and disaster alerts for public adjusters',
    lead: 'Policyholders hire a public adjuster after a loss. Holler tells you where the losses just happened.',
    signals: [
      { signal: 'Hail and wind reports', why: 'Roof and exterior damage over a wide area means many insured homeowners who are about to meet their carrier.' },
      { signal: 'Federal disaster declarations', why: 'A declaration marks the start of a long claim season with disputes over scope and value.' },
      { signal: 'Flood and flash flood warnings', why: 'Water losses are often disputed, and owners look for someone who works for them.' },
      { signal: 'Freeze warnings', why: 'Burst-pipe claims are common and carriers push back on the extent of damage.' },
      { signal: 'People asking about a claim', why: 'A homeowner posting about a denied or low claim is looking for help right now.' },
    ],
  },
};
