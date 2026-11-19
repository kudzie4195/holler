// ../../components/format.ts
function formatDistance(mi) {
	if (mi == null || !Number.isFinite(mi)) return null;
	if (mi < 1) return "under 1 mi away";
	return `${mi < 10 ? mi.toFixed(1).replace(/\.0$/, "") : Math.round(mi)} mi away`;
}
// ../../lib/signals/intent.ts
/** Sources whose rows are people asking, regardless of kind. 'holler-request' is a resident request made on Holler. */
var ASKING_SOURCES = /* @__PURE__ */ new Set([
	"holler-request",
	"bluesky",
	"websearch-brave",
	"websearch-serper"
]);
/** data.subtype values written by the Socrata and ArcGIS adapters. */
var SPENDING_SUBTYPES = /* @__PURE__ */ new Set([
	"permit",
	"business",
	"event-permit"
]);
var DEMAND_SUBTYPES = /* @__PURE__ */ new Set([
	"311",
	"violation",
	"inspection"
]);
var SPENDING_KINDS = /* @__PURE__ */ new Set(["permit", "contract"]);
/** Heuristic public posts: matched by wording, so who wrote them and where they live is not on the record. */
var PUBLIC_POST_SOURCES = /* @__PURE__ */ new Set([
	"bluesky",
	"websearch-brave",
	"websearch-serper"
]);
/** Open federal solicitations: out for bid, nothing awarded. */
var OPEN_BID_SOURCES = /* @__PURE__ */ new Set(["sam-gov"]);
var norm = (v) => typeof v === "string" ? v.trim().toLowerCase() : "";
function intentOf(signal) {
	const kind = norm(signal.kind);
	const subtype = norm(signal.subtype);
	const source = norm(signal.source);
	if (kind === "ask" || ASKING_SOURCES.has(source)) return "asking";
	if (SPENDING_SUBTYPES.has(subtype)) return "spending";
	if (DEMAND_SUBTYPES.has(subtype)) return "demand";
	if (SPENDING_KINDS.has(kind)) return "spending";
	return "demand";
}
function intentLineKey(signal) {
	const kind = norm(signal.kind);
	const subtype = norm(signal.subtype);
	const source = norm(signal.source);
	if (PUBLIC_POST_SOURCES.has(source)) return "public-post";
	if (OPEN_BID_SOURCES.has(source)) return "open-bid";
	if (kind === "ask" || source === "holler-request") return "asking";
	if (subtype === "business") return "new-business";
	return intentOf(signal);
}
var INTENT_LABEL = {
	demand: "Demand sign",
	spending: "Spending activity",
	asking: "Someone asked"
};
/** One plain line under the label: what is confirmed and what is not. */
var INTENT_NOTE = {
	demand: "The event is on record. Whether anyone needs work is not confirmed.",
	spending: "Money is being spent here. The main contractor may already be chosen.",
	asking: "A resident asked for this service."
};
var LINE_BY_KEY = {
	demand: INTENT_NOTE.demand,
	spending: INTENT_NOTE.spending,
	asking: INTENT_NOTE.asking,
	"open-bid": "This work is out for bid. No contract has been awarded yet.",
	"new-business": "A new business registered here. It may need services as it opens.",
	"public-post": "A public post asked about this. Holler has not checked who wrote it."
};
/** The one plain line under the label for this signal. The label still comes from INTENT_LABEL[intentOf(signal)]. */
function intentLine(signal) {
	return LINE_BY_KEY[intentLineKey(signal)];
}
// ../../lib/signals/source-meta.ts
var SOURCE_META = {
	"nws": {
		id: "nws",
		label: "National Weather Service alerts",
		sourceUrl: "https://www.weather.gov/alerts"
	},
	"spc": {
		id: "spc",
		label: "NOAA Storm Prediction Center storm reports",
		sourceUrl: "https://www.spc.noaa.gov/climo/reports/"
	},
	"fema": {
		id: "fema",
		label: "FEMA disaster declarations",
		sourceUrl: "https://www.fema.gov/disaster/declarations"
	},
	"usgs": {
		id: "usgs",
		label: "USGS earthquakes",
		sourceUrl: "https://earthquake.usgs.gov/earthquakes/map/"
	},
	"faa": {
		id: "faa",
		label: "FAA airport status",
		sourceUrl: "https://nasstatus.faa.gov/"
	},
	"socrata-chicago-permits": {
		id: "socrata-chicago-permits",
		label: "Chicago open data: building permits",
		sourceUrl: "https://data.cityofchicago.org/d/ydr8-5enu"
	},
	"socrata-chicago-311": {
		id: "socrata-chicago-311",
		label: "Chicago open data: 311 requests",
		sourceUrl: "https://data.cityofchicago.org/d/v6vf-nfxy"
	},
	"socrata-chicago-inspections": {
		id: "socrata-chicago-inspections",
		label: "Chicago open data: food inspections",
		sourceUrl: "https://data.cityofchicago.org/d/4ijn-s7e5"
	},
	"socrata-nyc-permits": {
		id: "socrata-nyc-permits",
		label: "New York City open data: building permits",
		sourceUrl: "https://data.cityofnewyork.us/d/rbx6-tga4"
	},
	"socrata-nyc-311": {
		id: "socrata-nyc-311",
		label: "New York City open data: 311 requests",
		sourceUrl: "https://data.cityofnewyork.us/d/erm2-nwe9"
	},
	"socrata-nyc-inspections": {
		id: "socrata-nyc-inspections",
		label: "New York City open data: food inspections",
		sourceUrl: "https://data.cityofnewyork.us/d/43nn-pn8j"
	},
	"socrata-sf-permits": {
		id: "socrata-sf-permits",
		label: "San Francisco open data: building permits",
		sourceUrl: "https://data.sf.gov/d/i98e-djp9"
	},
	"socrata-sf-311": {
		id: "socrata-sf-311",
		label: "San Francisco open data: 311 requests",
		sourceUrl: "https://data.sf.gov/d/vw6y-z8j6"
	},
	"socrata-austin-permits": {
		id: "socrata-austin-permits",
		label: "Austin open data: building permits",
		sourceUrl: "https://data.austintexas.gov/d/3syk-w9eu"
	},
	"socrata-austin-311": {
		id: "socrata-austin-311",
		label: "Austin open data: 311 requests",
		sourceUrl: "https://data.austintexas.gov/d/xwdj-i9he"
	},
	"socrata-austin-inspections": {
		id: "socrata-austin-inspections",
		label: "Austin open data: food inspections",
		sourceUrl: "https://data.austintexas.gov/d/ecmv-9xxi"
	},
	"socrata-seattle-permits": {
		id: "socrata-seattle-permits",
		label: "Seattle open data: building permits",
		sourceUrl: "https://data.seattle.gov/d/76t5-zqzr"
	},
	"socrata-la-permits": {
		id: "socrata-la-permits",
		label: "Los Angeles open data: building permits",
		sourceUrl: "https://data.lacity.org/d/pi9x-tg5x"
	},
	"socrata-dallas-311": {
		id: "socrata-dallas-311",
		label: "Dallas open data: 311 requests",
		sourceUrl: "https://www.dallasopendata.com/d/d7e7-envw"
	},
	"socrata-nola-permits": {
		id: "socrata-nola-permits",
		label: "New Orleans open data: building permits",
		sourceUrl: "https://data.nola.gov/d/rcm3-fn58"
	},
	"socrata-nola-311": {
		id: "socrata-nola-311",
		label: "New Orleans open data: 311 requests",
		sourceUrl: "https://data.nola.gov/d/2jgv-pqrq"
	},
	"socrata-batonrouge-permits": {
		id: "socrata-batonrouge-permits",
		label: "Baton Rouge open data: building permits",
		sourceUrl: "https://data.brla.gov/d/7fq7-8j7r"
	},
	"socrata-batonrouge-311": {
		id: "socrata-batonrouge-311",
		label: "Baton Rouge open data: 311 requests",
		sourceUrl: "https://data.brla.gov/d/7ixm-mnvx"
	},
	"socrata-cincinnati-permits": {
		id: "socrata-cincinnati-permits",
		label: "Cincinnati open data: building permits",
		sourceUrl: "https://data.cincinnati-oh.gov/d/thvx-5mem"
	},
	"socrata-cincinnati-311": {
		id: "socrata-cincinnati-311",
		label: "Cincinnati open data: 311 requests",
		sourceUrl: "https://data.cincinnati-oh.gov/d/gcej-gmiw"
	},
	"socrata-cambridge-permits": {
		id: "socrata-cambridge-permits",
		label: "Cambridge open data: building permits",
		sourceUrl: "https://data.cambridgema.gov/d/3wsm-e5jx"
	},
	"socrata-norfolk-permits": {
		id: "socrata-norfolk-permits",
		label: "Norfolk open data: building permits",
		sourceUrl: "https://data.norfolk.gov/d/fahm-yuh4"
	},
	"socrata-buffalo-permits": {
		id: "socrata-buffalo-permits",
		label: "Buffalo open data: building permits",
		sourceUrl: "https://data.buffalony.gov/d/9p2d-f3yt"
	},
	"socrata-montgomery-permits": {
		id: "socrata-montgomery-permits",
		label: "Montgomery County open data: building permits",
		sourceUrl: "https://data.montgomerycountymd.gov/d/m88u-pqki"
	},
	"socrata-orlando-permits": {
		id: "socrata-orlando-permits",
		label: "Orlando open data: building permits",
		sourceUrl: "https://data.cityoforlando.net/d/ryhf-m453"
	},
	"socrata-kansascity-311": {
		id: "socrata-kansascity-311",
		label: "Kansas City open data: 311 requests",
		sourceUrl: "https://data.kcmo.org/d/d4px-6rwg"
	},
	"socrata-cambridge-311": {
		id: "socrata-cambridge-311",
		label: "Cambridge open data: 311 requests",
		sourceUrl: "https://data.cambridgema.gov/d/2z9k-mv9g"
	},
	"socrata-oakland-311": {
		id: "socrata-oakland-311",
		label: "Oakland open data: 311 requests",
		sourceUrl: "https://data.oaklandca.gov/d/quth-gb8e"
	},
	"socrata-chicago-violations": {
		id: "socrata-chicago-violations",
		label: "Chicago open data: code violations",
		sourceUrl: "https://data.cityofchicago.org/d/22u3-xenr"
	},
	"socrata-austin-violations": {
		id: "socrata-austin-violations",
		label: "Austin open data: code violations",
		sourceUrl: "https://data.austintexas.gov/d/6wtj-zbtb"
	},
	"socrata-chicago-business": {
		id: "socrata-chicago-business",
		label: "Chicago open data: new business licenses",
		sourceUrl: "https://data.cityofchicago.org/d/uupf-x98q"
	},
	"socrata-sf-business": {
		id: "socrata-sf-business",
		label: "San Francisco open data: new business licenses",
		sourceUrl: "https://data.sf.gov/d/g8m3-pdis"
	},
	"socrata-la-business": {
		id: "socrata-la-business",
		label: "Los Angeles open data: new business licenses",
		sourceUrl: "https://data.lacity.org/d/6rrh-rzua"
	},
	"socrata-nyc-business": {
		id: "socrata-nyc-business",
		label: "New York City open data: new business licenses",
		sourceUrl: "https://data.cityofnewyork.us/d/w7w3-xahh"
	},
	"socrata-orlando-business": {
		id: "socrata-orlando-business",
		label: "Orlando open data: new business licenses",
		sourceUrl: "https://data.cityoforlando.net/d/7388-4re5"
	},
	"socrata-nyc-events": {
		id: "socrata-nyc-events",
		label: "New York City open data: special event permits",
		sourceUrl: "https://data.cityofnewyork.us/d/tvpp-9vvx"
	},
	"socrata-chicago-events": {
		id: "socrata-chicago-events",
		label: "Chicago open data: special event permits",
		sourceUrl: "https://data.cityofchicago.org/d/pk66-w54g"
	},
	"arcgis-dekalb-permits": {
		id: "arcgis-dekalb-permits",
		label: "DeKalb County open data: building permits",
		sourceUrl: "https://dcgis.dekalbcountyga.gov/mapping/rest/services/Building_Permit_Applications/MapServer/0"
	},
	"arcgis-raleigh-permits": {
		id: "arcgis-raleigh-permits",
		label: "Raleigh open data: building permits",
		sourceUrl: "https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Building_Permits/FeatureServer/0"
	},
	"arcgis-dc-permits": {
		id: "arcgis-dc-permits",
		label: "Washington open data: building permits",
		sourceUrl: "https://maps2.dcgis.dc.gov/DCGIS/rest/services/FEEDS/DCRA/MapServer/4"
	},
	"arcgis-mecklenburg-permits": {
		id: "arcgis-mecklenburg-permits",
		label: "Mecklenburg County open data: building permits",
		sourceUrl: "https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits_Accela/FeatureServer/0"
	},
	"arcgis-atlanta-permits": {
		id: "arcgis-atlanta-permits",
		label: "Atlanta open data: building permits",
		sourceUrl: "https://services5.arcgis.com/5RxyIIJ9boPdptdo/arcgis/rest/services/building_permit_featureLayer/FeatureServer/0"
	},
	"arcgis-dekalb-violations": {
		id: "arcgis-dekalb-violations",
		label: "DeKalb County open data: code violations",
		sourceUrl: "https://dcgis.dekalbcountyga.gov/mapping/rest/services/Hansen/CodeEnforcementCasesInspections/FeatureServer/0"
	},
	"arcgis-johnscreek-permits": {
		id: "arcgis-johnscreek-permits",
		label: "Johns Creek open data: building permits",
		sourceUrl: "https://services1.arcgis.com/bqfNVPUK3HOnCFmA/ArcGIS/rest/services/Building_Permits_Issued/FeatureServer/0"
	},
	"arcgis-cobb-residential-permits": {
		id: "arcgis-cobb-residential-permits",
		label: "Cobb County open data: building permits",
		sourceUrl: "https://gis.cobbcounty.org/gisserver/rest/services/comdev/Accela_PermitsDashboard/FeatureServer/4"
	},
	"arcgis-cobb-commercial-permits": {
		id: "arcgis-cobb-commercial-permits",
		label: "Cobb County open data: building permits",
		sourceUrl: "https://gis.cobbcounty.org/gisserver/rest/services/comdev/Accela_PermitsDashboard/FeatureServer/1"
	},
	"arcgis-cobb-multiunit-permits": {
		id: "arcgis-cobb-multiunit-permits",
		label: "Cobb County open data: building permits",
		sourceUrl: "https://gis.cobbcounty.org/gisserver/rest/services/comdev/Accela_PermitsDashboard/FeatureServer/3"
	},
	"usaspending": {
		id: "usaspending",
		label: "Federal contract awards (USAspending.gov)",
		sourceUrl: "https://www.usaspending.gov/"
	},
	"sam-gov": {
		id: "sam-gov",
		label: "Federal bid opportunities (SAM.gov)",
		sourceUrl: "https://sam.gov/"
	},
	"ticketmaster": {
		id: "ticketmaster",
		label: "Big events this week (Ticketmaster)",
		sourceUrl: "https://www.ticketmaster.com/"
	},
	"bluesky": {
		id: "bluesky",
		label: "People asking on Bluesky",
		sourceUrl: "https://bsky.app/"
	},
	"websearch-brave": {
		id: "websearch-brave",
		label: "People asking for recommendations (web search)",
		sourceUrl: "https://search.brave.com/"
	},
	"websearch-serper": {
		id: "websearch-serper",
		label: "People asking for recommendations (web search)",
		sourceUrl: "https://serper.dev/"
	},
	"holler-request": {
		id: "holler-request",
		label: "Requests made on Holler",
		sourceUrl: "/request"
	}
};
function getSourceMeta(sourceId) {
	return SOURCE_META[(sourceId ?? "").toLowerCase()];
}
// ../../lib/signals/categories.ts
var CATEGORY_GROUPS = [
	{
		id: "home",
		label: "Home and property"
	},
	{
		id: "storm",
		label: "Storm and disaster"
	},
	{
		id: "auto",
		label: "Auto"
	},
	{
		id: "business",
		label: "Business services"
	},
	{
		id: "food-events",
		label: "Food and events"
	},
	{
		id: "other",
		label: "Other services"
	}
];
var CATEGORIES = [
	{
		id: "roofing",
		label: "Roofing",
		group: "home",
		keywords: [
			"roof",
			"roofer",
			"roofing",
			"shingle",
			"shingles",
			"roof leak",
			"hail damage",
			"gutter",
			"gutters",
			"siding"
		]
	},
	{
		id: "hvac",
		label: "Heating and air (HVAC)",
		group: "home",
		keywords: [
			"hvac",
			"air conditioning",
			"air conditioner",
			"a/c",
			"furnace",
			"heater",
			"heat pump",
			"ac repair",
			"ac unit",
			"heating and cooling",
			"no heat",
			"ductwork",
			"thermostat"
		]
	},
	{
		id: "plumbing",
		label: "Plumbing",
		group: "home",
		keywords: [
			"plumber",
			"plumbing",
			"burst pipe",
			"frozen pipe",
			"frozen pipes",
			"leaking pipe",
			"water heater",
			"clogged drain",
			"sewer line",
			"toilet",
			"garbage disposal",
			"sump pump"
		]
	},
	{
		id: "electrical",
		label: "Electrical",
		group: "home",
		keywords: [
			"electrician",
			"electrical",
			"power outage",
			"breaker",
			"outlet",
			"wiring",
			"generator",
			"panel upgrade",
			"ev charger"
		]
	},
	{
		id: "tree-service",
		label: "Tree service",
		group: "storm",
		keywords: [
			"tree removal",
			"tree service",
			"tree trimming",
			"arborist",
			"fallen tree",
			"downed tree",
			"tree down",
			"stump",
			"stump grinding",
			"storm debris",
			"limbs"
		]
	},
	{
		id: "landscaping",
		label: "Landscaping",
		group: "home",
		keywords: [
			"landscaper",
			"landscaping",
			"landscape",
			"mulch",
			"retaining wall",
			"irrigation",
			"sprinkler",
			"hardscape",
			"garden design",
			"patio"
		]
	},
	{
		id: "lawn-care",
		label: "Lawn care",
		group: "home",
		keywords: [
			"lawn care",
			"lawn service",
			"lawn mowing",
			"mowing",
			"mow",
			"yard work",
			"lawn guy",
			"lawn",
			"weed control",
			"fertilizer",
			"aeration",
			"yard cleanup"
		]
	},
	{
		id: "snow-removal",
		label: "Snow removal",
		group: "storm",
		keywords: [
			"snow removal",
			"snow plow",
			"snow plowing",
			"plow",
			"plowing",
			"snow shoveling",
			"shovel",
			"de-icing",
			"deicing",
			"salting",
			"ice removal",
			"driveway snow"
		]
	},
	{
		id: "pest-control",
		label: "Pest control",
		group: "home",
		keywords: [
			"pest control",
			"exterminator",
			"termite",
			"termites",
			"roach",
			"roaches",
			"cockroach",
			"bed bug",
			"bed bugs",
			"rodent",
			"rodents",
			"mice",
			"rats",
			"ants",
			"wasp",
			"hornet",
			"mosquito",
			"infestation"
		]
	},
	{
		id: "cleaning",
		label: "House cleaning",
		group: "home",
		keywords: [
			"house cleaning",
			"house cleaner",
			"maid",
			"maid service",
			"cleaning lady",
			"deep clean",
			"deep cleaning",
			"move out clean",
			"move-out clean",
			"housekeeper",
			"pressure washing",
			"power washing",
			"window cleaning",
			"carpet cleaning"
		]
	},
	{
		id: "restoration",
		label: "Water, fire and storm restoration",
		group: "storm",
		keywords: [
			"restoration",
			"water damage",
			"flood damage",
			"flooding",
			"fire damage",
			"smoke damage",
			"mold",
			"mold remediation",
			"mitigation",
			"storm damage",
			"water extraction",
			"basement flood",
			"tarp",
			"board up",
			"dry out"
		]
	},
	{
		id: "general-contractor",
		label: "General contractor",
		group: "home",
		keywords: [
			"general contractor",
			"contractor",
			"remodel",
			"remodeling",
			"renovation",
			"renovate",
			"kitchen remodel",
			"bathroom remodel",
			"handyman",
			"drywall",
			"framing",
			"building permit",
			"construction",
			"carpenter",
			"deck",
			"fence",
			"fencing",
			"flooring",
			"concrete",
			"foundation"
		]
	},
	{
		id: "painting",
		label: "Painting",
		group: "home",
		keywords: [
			"painter",
			"painting",
			"house painter",
			"interior paint",
			"exterior paint",
			"repaint",
			"staining",
			"cabinet painting"
		]
	},
	{
		id: "pool-spa",
		label: "Pool and spa",
		group: "home",
		keywords: [
			"pool",
			"pool service",
			"pool cleaning",
			"pool repair",
			"hot tub",
			"pool pump",
			"pool opening",
			"pool closing",
			"swimming pool"
		]
	},
	{
		id: "solar",
		label: "Solar",
		group: "home",
		keywords: [
			"solar",
			"solar panel",
			"solar panels",
			"solar install",
			"photovoltaic",
			"battery backup",
			"powerwall",
			"net metering"
		]
	},
	{
		id: "auto-glass",
		label: "Auto glass",
		group: "auto",
		keywords: [
			"auto glass",
			"windshield",
			"windshield repair",
			"windshield replacement",
			"cracked windshield",
			"car window",
			"rock chip",
			"chipped windshield"
		]
	},
	{
		id: "auto-body",
		label: "Auto body and dent repair",
		group: "auto",
		keywords: [
			"auto body",
			"body shop",
			"collision repair",
			"dent repair",
			"paintless dent",
			"hail dent",
			"hail dents",
			"dented car",
			"bumper",
			"fender bender",
			"car paint",
			"car wreck"
		]
	},
	{
		id: "towing",
		label: "Towing and roadside",
		group: "auto",
		keywords: [
			"tow truck",
			"towing",
			"roadside assistance",
			"jump start",
			"dead battery",
			"flat tire",
			"stuck car",
			"wrecker",
			"lockout"
		]
	},
	{
		id: "auto-repair",
		label: "Auto repair",
		group: "auto",
		keywords: [
			"mechanic",
			"auto repair",
			"car repair",
			"brakes",
			"oil change",
			"transmission",
			"check engine",
			"tire shop",
			"tires",
			"car won't start",
			"smog",
			"inspection sticker",
			"alignment",
			"battery replacement"
		]
	},
	{
		id: "moving",
		label: "Moving",
		group: "other",
		keywords: [
			"mover",
			"movers",
			"moving company",
			"moving help",
			"moving truck",
			"moving service",
			"u-haul help",
			"relocation",
			"piano moving",
			"loading help"
		]
	},
	{
		id: "junk-removal",
		label: "Junk removal and hauling",
		group: "home",
		keywords: [
			"junk removal",
			"junk hauling",
			"haul away",
			"hauling",
			"dumpster",
			"trash removal",
			"debris removal",
			"cleanout",
			"estate cleanout",
			"bulk pickup",
			"furniture removal"
		]
	},
	{
		id: "locksmith",
		label: "Locksmith",
		group: "home",
		keywords: [
			"locksmith",
			"locked out",
			"rekey",
			"re-key",
			"lock change",
			"lock repair",
			"key replacement",
			"smart lock",
			"deadbolt"
		]
	},
	{
		id: "real-estate",
		label: "Real estate",
		group: "other",
		keywords: [
			"realtor",
			"real estate agent",
			"real estate",
			"home buyer",
			"house hunting",
			"selling my house",
			"sell my home",
			"listing agent",
			"property manager",
			"property management",
			"home inspector",
			"appraiser",
			"mortgage broker"
		]
	},
	{
		id: "insurance",
		label: "Insurance",
		group: "business",
		keywords: [
			"insurance",
			"insurance agent",
			"insurance claim",
			"adjuster",
			"public adjuster",
			"homeowners insurance",
			"auto insurance",
			"flood insurance",
			"renters insurance"
		]
	},
	{
		id: "food-truck",
		label: "Food truck",
		group: "food-events",
		keywords: [
			"food truck",
			"food trucks",
			"street food",
			"taco truck",
			"mobile kitchen",
			"pop up kitchen",
			"pop-up kitchen",
			"vendor",
			"vendors",
			"street vendor"
		]
	},
	{
		id: "catering",
		label: "Catering",
		group: "food-events",
		keywords: [
			"caterer",
			"catering",
			"catered",
			"buffet",
			"party food",
			"meal prep",
			"box lunches",
			"private chef",
			"bbq catering",
			"event food"
		]
	},
	{
		id: "event-services",
		label: "Event services",
		group: "food-events",
		keywords: [
			"dj",
			"photographer",
			"photography",
			"event planner",
			"event planning",
			"party rental",
			"tent rental",
			"bounce house",
			"wedding",
			"balloon",
			"florist",
			"event rental",
			"videographer",
			"photo booth",
			"stage rental",
			"porta potty",
			"portable toilet"
		]
	},
	{
		id: "rideshare-delivery",
		label: "Rideshare and delivery driving",
		group: "other",
		keywords: [
			"uber",
			"lyft",
			"rideshare",
			"ride share",
			"doordash",
			"ubereats",
			"uber eats",
			"grubhub",
			"instacart",
			"delivery driver",
			"courier",
			"airport ride",
			"airport pickup",
			"shuttle",
			"taxi"
		]
	},
	{
		id: "childcare",
		label: "Childcare",
		group: "other",
		keywords: [
			"babysitter",
			"babysitting",
			"nanny",
			"daycare",
			"child care",
			"childcare",
			"after school care",
			"preschool",
			"au pair",
			"summer camp",
			"tutor",
			"tutoring"
		]
	},
	{
		id: "beauty",
		label: "Hair and beauty",
		group: "other",
		keywords: [
			"hair stylist",
			"hairdresser",
			"barber",
			"braider",
			"hair braiding",
			"salon",
			"nail tech",
			"nails",
			"lash tech",
			"lashes",
			"esthetician",
			"makeup artist",
			"wig install",
			"massage",
			"waxing",
			"haircut"
		]
	},
	{
		id: "janitorial-commercial",
		label: "Commercial cleaning",
		group: "business",
		keywords: [
			"janitorial",
			"commercial cleaning",
			"office cleaning",
			"janitor",
			"custodial",
			"building maintenance",
			"floor waxing",
			"floor stripping",
			"post construction cleanup",
			"post-construction cleaning",
			"restaurant cleaning",
			"hood cleaning"
		]
	},
	{
		id: "security",
		label: "Security",
		group: "business",
		keywords: [
			"security guard",
			"security guards",
			"security camera",
			"security cameras",
			"alarm system",
			"home security",
			"cctv",
			"doorbell camera",
			"surveillance",
			"break-in",
			"burglary",
			"security system",
			"event security"
		]
	},
	{
		id: "fencing",
		label: "Fencing",
		group: "home",
		keywords: [
			"fence",
			"fencing",
			"fence installation",
			"fence repair",
			"fence company",
			"chain link",
			"privacy fence",
			"wood fence",
			"vinyl fence",
			"iron fence",
			"gate installation",
			"fence contractor"
		]
	},
	{
		id: "concrete-paving",
		label: "Concrete and paving",
		group: "home",
		keywords: [
			"concrete contractor",
			"concrete work",
			"driveway paving",
			"driveway replacement",
			"new driveway",
			"driveway repair",
			"driveway installation",
			"paving",
			"paver",
			"pavers",
			"asphalt",
			"sidewalk repair",
			"patio slab",
			"stamped concrete",
			"flatwork",
			"sealcoating",
			"blacktop",
			"concrete"
		]
	},
	{
		id: "windows-doors",
		label: "Windows and doors",
		group: "home",
		keywords: [
			"window replacement",
			"replacement windows",
			"new windows",
			"window installation",
			"window installer",
			"door replacement",
			"entry door",
			"front door",
			"garage door",
			"sliding door",
			"patio door",
			"storm door",
			"windows and doors",
			"door installation"
		]
	},
	{
		id: "siding-gutters",
		label: "Siding and gutters",
		group: "home",
		keywords: [
			"siding",
			"vinyl siding",
			"gutter",
			"gutters",
			"gutter cleaning",
			"gutter installation",
			"seamless gutters",
			"downspout",
			"fascia",
			"soffit",
			"gutter guards"
		]
	},
	{
		id: "flooring",
		label: "Flooring",
		group: "home",
		keywords: [
			"flooring",
			"hardwood floors",
			"hardwood floor",
			"floor installation",
			"laminate flooring",
			"vinyl plank",
			"tile installer",
			"tile installation",
			"carpet installation",
			"refinish floors",
			"floor refinishing",
			"epoxy floor"
		]
	},
	{
		id: "handyman",
		label: "Handyman",
		group: "home",
		keywords: [
			"handyman",
			"handy man",
			"odd jobs",
			"home repair",
			"small repairs",
			"minor repairs",
			"honey do",
			"furniture assembly",
			"tv mounting",
			"drywall patch",
			"caulking"
		]
	},
	{
		id: "signs-printing",
		label: "Signs and printing",
		group: "business",
		keywords: [
			"sign shop",
			"signage",
			"custom signs",
			"storefront sign",
			"banner",
			"banners",
			"vinyl banner",
			"yard signs",
			"business cards",
			"flyers",
			"printing",
			"print shop",
			"vehicle wrap",
			"vehicle wraps",
			"window decals",
			"screen printing",
			"t-shirt printing"
		]
	},
	{
		id: "business-services",
		label: "Bookkeeping, payroll and IT setup",
		group: "business",
		keywords: [
			"bookkeeping",
			"bookkeeper",
			"payroll",
			"point of sale",
			"pos system",
			"it support",
			"it setup",
			"managed it",
			"network setup",
			"accounting",
			"accountant",
			"tax preparation",
			"tax preparer",
			"business consultant",
			"web design",
			"virtual assistant",
			"cybersecurity",
			"wifi setup",
			"merchant services",
			"credit card processing"
		]
	},
	{
		id: "public-adjuster",
		label: "Public adjuster",
		group: "storm",
		keywords: [
			"public adjuster",
			"public adjusters",
			"insurance adjuster",
			"claim denied",
			"claim denial",
			"underpaid claim",
			"insurance claim help",
			"storm claim",
			"hail claim",
			"roof claim",
			"supplement claim"
		]
	}
];
CATEGORIES.map((c) => c.id);
new Map(CATEGORIES.map((c) => [c.id, c]));
function escapeRe(s) {
	return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
CATEGORIES.map((c) => ({
	id: c.id,
	re: new RegExp(`(?<![a-z0-9])(?:${c.keywords.map((k) => escapeRe(k.toLowerCase())).join("|")})(?:s|es)?(?![a-z0-9])`, "i")
}));
// ../../lib/plan/limits.ts
var TIERS = ["starter", "pro"];
var PLAN_LIMITS = {
	starter: {
		areas: 1,
		extraAreas: 0,
		trades: 5,
		keywords: 0
	},
	pro: {
		areas: 3,
		extraAreas: 2,
		trades: 15,
		keywords: 5
	}
};
Math.max(...TIERS.map((t) => PLAN_LIMITS[t].trades));
Math.max(...TIERS.map((t) => PLAN_LIMITS[t].extraAreas));
Math.max(...TIERS.map((t) => PLAN_LIMITS[t].keywords));
/**
* Display names. The internal id `starter` stays everywhere (code, database, Stripe metadata and product id); only the name shown to
* people is "Solo". Read names from here, never type them.
*/
var TIER_NAMES = {
	starter: "Solo",
	pro: "Pro"
};
// ../../lib/stripe/plans.ts
/**
* THE price list, in cents. Every price shown anywhere (pricing cards, settings, the /pricing page, JSON-LD, SEO copy, llms.txt,
* lib/plan/public-prices.ts for the apps) is derived from this table through formatUsd or is tested against it
* (tests/plan/pricing.test.ts, tests/plan/no-old-prices.test.ts).
* The key `starter` is the internal plan id (database, Stripe metadata, product id); its display name is TIER_NAMES.starter ("Solo").
* A change here reaches new checkouts and member-initiated plan switches only. Existing subscription items keep the amount they were
* created with: nothing in this repo re-prices them (tests/money/grandfathering.test.ts).
*/
var PRICES_CENTS = {
	starter: {
		monthly: 799,
		annual: 7999
	},
	pro: {
		monthly: 1399,
		annual: 13999
	}
};
PRICES_CENTS.starter.monthly;
PRICES_CENTS.starter.annual;
function priceCents(tier, plan) {
	return PRICES_CENTS[tier][plan];
}
/** Whole-percent saving of the yearly price against twelve monthly payments, computed from PRICES_CENTS. */
function annualSavingsPercent(tier) {
	const m = PRICES_CENTS[tier].monthly * 12;
	return Math.round((m - PRICES_CENTS[tier].annual) / m * 100);
}
annualSavingsPercent("starter");
/** Cents saved by paying yearly instead of twelve monthly payments. */
function annualSavingsCents(tier) {
	return PRICES_CENTS[tier].monthly * 12 - PRICES_CENTS[tier].annual;
}
/** The yearly saving counted in monthly payments (Solo: 1589 / 799 = 1.99; Pro: 2789 / 1399 = 1.99). */
function annualMonthsSaved(tier) {
	return annualSavingsCents(tier) / PRICES_CENTS[tier].monthly;
}
/**
* THE annual saving phrase. "about 2 months free" only when the yearly saving is within MONTHS_FREE_TOLERANCE of a whole number
* (at least 1) of monthly payments. Otherwise "save N%", with N computed from the cents. Never a hand-typed number.
*/
function annualSavingLabel(tier) {
	const whole = annualMonthsFree(tier);
	if (whole !== null) return `about ${whole} ${whole === 1 ? "month" : "months"} free`;
	return `save ${annualSavingsPercent(tier)}%`;
}
/** The whole number of free months the yearly price is worth, or null when the math does not support "about N months free". */
function annualMonthsFree(tier) {
	const months = annualMonthsSaved(tier);
	const whole = Math.round(months);
	return whole >= 1 && Math.abs(months - whole) <= .05 ? whole : null;
}
/** "$7.99", "$79.99", "$13.99", "$139.99": whole dollars drop the cents ("$10"). */
function formatUsd(cents) {
	const dollars = Math.floor(cents / 100);
	const rest = cents % 100;
	return rest === 0 ? `$${dollars}` : `$${dollars}.${String(rest).padStart(2, "0")}`;
}
/** Display price for a tier and interval, from the table above. */
function priceLabel(tier, plan) {
	return formatUsd(priceCents(tier, plan));
}
/** Plain decimal string for schema.org Offer.price ("13.99", "139.99"). */
function priceDecimal(tier, plan) {
	return (priceCents(tier, plan) / 100).toFixed(2);
}
priceLabel("starter", "monthly"), priceLabel("starter", "annual");
// ../../lib/plan/public-prices.ts
/**
* THE public price list for the mobile apps (Capacitor iOS and Android) and the App Store / Play listings.
*
* Pure and dependency-light on purpose: relative imports only (no '@/' alias, no env, no server code, no Next), so a separate app
* build can import this file as is. Every amount comes from lib/stripe/plans.ts PRICES_CENTS and every name from lib/plan/limits.ts
* TIER_NAMES; tests/plan/public-prices.test.ts checks that nothing here is typed by hand.
*
* Store identifiers are fixed strings: once a product id exists in App Store Connect or Play Console it cannot be renamed, so they
* must never be derived from a display name. The internal plan id stays `starter` (database, Stripe metadata); the store-facing
* plan key and entitlement are `solo`.
*/
/** Store product ids, the pattern of the owner's other apps: <app id>.<entitlement>.<monthly|yearly>. Fixed strings, never derived. */
var STORE_PRODUCT_IDS = {
	solo: {
		monthly: "com.localholler.app.solo.monthly",
		annual: "com.localholler.app.solo.yearly"
	},
	pro: {
		monthly: "com.localholler.app.pro.monthly",
		annual: "com.localholler.app.pro.yearly"
	}
};
var ENTITLEMENTS = ["solo", "pro"];
/** Internal plan id (holler_profiles.plan, Stripe metadata.tier) for each entitlement, and back. */
var TIER_FOR_ENTITLEMENT = {
	solo: "starter",
	pro: "pro"
};
function interval(tier, plan, storeProductId) {
	const display = priceLabel(tier, plan);
	return {
		storeProductId,
		cents: PRICES_CENTS[tier][plan],
		decimal: priceDecimal(tier, plan),
		display,
		displayLong: `${display} ${plan === "annual" ? "a year" : "a month"}`,
		displayShort: `${display}/${plan === "annual" ? "yr" : "mo"}`,
		period: plan === "annual" ? "P1Y" : "P1M"
	};
}
function plan(entitlement) {
	const tier = TIER_FOR_ENTITLEMENT[entitlement];
	const l = PLAN_LIMITS[tier];
	return {
		entitlement,
		tier,
		name: TIER_NAMES[tier],
		monthly: interval(tier, "monthly", STORE_PRODUCT_IDS[entitlement].monthly),
		annual: interval(tier, "annual", STORE_PRODUCT_IDS[entitlement].annual),
		annualSaving: annualSavingLabel(tier),
		annualMonthsFree: annualMonthsFree(tier),
		annualSavingsPercent: annualSavingsPercent(tier),
		limits: {
			serviceAreas: l.areas,
			trades: l.trades,
			keywordWatches: l.keywords
		}
	};
}
var PUBLIC_PRICES = {
	currency: "USD",
	/** Free trial length in days. The web trial needs no card; store trials are set up to match this length. */
	trialDays: 14,
	/** ISO 8601 trial period for store introductory offers: "P7D". */
	trialPeriod: `P14D`,
	plans: {
		solo: plan("solo"),
		pro: plan("pro")
	}
};
ENTITLEMENTS.flatMap((e) => [STORE_PRODUCT_IDS[e].monthly, STORE_PRODUCT_IDS[e].annual]);
export { CATEGORIES, CATEGORY_GROUPS, INTENT_LABEL, PLAN_LIMITS, PUBLIC_PRICES, formatDistance, getSourceMeta, intentLine, intentLineKey, intentOf };
