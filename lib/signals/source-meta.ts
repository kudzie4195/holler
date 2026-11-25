/**
 * Static source metadata (id, label, sourceUrl) for every adapter in lib/signals/registry.ts ALL_ADAPTERS.
 * Client-safe: the registry imports every adapter (and lib/env), so client components import this instead.
 * Derived from the adapter configs on 2026-11-17; tests/signals/core/source-meta.test.ts fails if it drifts from ALL_ADAPTERS.
 * One entry is not an adapter: 'holler-request', the public record of a resident request made on Holler (lib/requests). It needs no
 * key and reads nothing outside Holler; its link is the /request page on this site (a relative URL, so this file stays client-safe).
 */
export interface SourceMeta {
  id: string;
  label: string;
  sourceUrl: string;
}

export const SOURCE_META: Record<string, SourceMeta> = {
  "nws": { id: "nws", label: "National Weather Service alerts", sourceUrl: "https://www.weather.gov/alerts" },
  "spc": { id: "spc", label: "NOAA Storm Prediction Center storm reports", sourceUrl: "https://www.spc.noaa.gov/climo/reports/" },
  "lsr": { id: "lsr", label: "NWS local storm reports", sourceUrl: "https://mesonet.agron.iastate.edu/lsr/" },
  "fema": { id: "fema", label: "FEMA disaster declarations", sourceUrl: "https://www.fema.gov/disaster/declarations" },
  "usgs": { id: "usgs", label: "USGS earthquakes", sourceUrl: "https://earthquake.usgs.gov/earthquakes/map/" },
  "faa": { id: "faa", label: "FAA airport status", sourceUrl: "https://nasstatus.faa.gov/" },
  "socrata-chicago-permits": { id: "socrata-chicago-permits", label: "Chicago open data: building permits", sourceUrl: "https://data.cityofchicago.org/d/ydr8-5enu" },
  "socrata-chicago-311": { id: "socrata-chicago-311", label: "Chicago open data: 311 requests", sourceUrl: "https://data.cityofchicago.org/d/v6vf-nfxy" },
  "socrata-chicago-inspections": { id: "socrata-chicago-inspections", label: "Chicago open data: food inspections", sourceUrl: "https://data.cityofchicago.org/d/4ijn-s7e5" },
  "socrata-nyc-permits": { id: "socrata-nyc-permits", label: "New York City open data: building permits", sourceUrl: "https://data.cityofnewyork.us/d/rbx6-tga4" },
  "socrata-nyc-311": { id: "socrata-nyc-311", label: "New York City open data: 311 requests", sourceUrl: "https://data.cityofnewyork.us/d/erm2-nwe9" },
  "socrata-nyc-inspections": { id: "socrata-nyc-inspections", label: "New York City open data: food inspections", sourceUrl: "https://data.cityofnewyork.us/d/43nn-pn8j" },
  "socrata-sf-permits": { id: "socrata-sf-permits", label: "San Francisco open data: building permits", sourceUrl: "https://data.sf.gov/d/i98e-djp9" },
  "socrata-sf-311": { id: "socrata-sf-311", label: "San Francisco open data: 311 requests", sourceUrl: "https://data.sf.gov/d/vw6y-z8j6" },
  "socrata-austin-permits": { id: "socrata-austin-permits", label: "Austin open data: building permits", sourceUrl: "https://data.austintexas.gov/d/3syk-w9eu" },
  "socrata-austin-311": { id: "socrata-austin-311", label: "Austin open data: 311 requests", sourceUrl: "https://data.austintexas.gov/d/xwdj-i9he" },
  "socrata-austin-inspections": { id: "socrata-austin-inspections", label: "Austin open data: food inspections", sourceUrl: "https://data.austintexas.gov/d/ecmv-9xxi" },
  "socrata-seattle-permits": { id: "socrata-seattle-permits", label: "Seattle open data: building permits", sourceUrl: "https://data.seattle.gov/d/76t5-zqzr" },
  "socrata-la-permits": { id: "socrata-la-permits", label: "Los Angeles open data: building permits", sourceUrl: "https://data.lacity.org/d/pi9x-tg5x" },
  "socrata-dallas-311": { id: "socrata-dallas-311", label: "Dallas open data: 311 requests", sourceUrl: "https://www.dallasopendata.com/d/d7e7-envw" },
  "socrata-nola-permits": { id: "socrata-nola-permits", label: "New Orleans open data: building permits", sourceUrl: "https://data.nola.gov/d/rcm3-fn58" },
  "socrata-nola-311": { id: "socrata-nola-311", label: "New Orleans open data: 311 requests", sourceUrl: "https://data.nola.gov/d/2jgv-pqrq" },
  "socrata-batonrouge-permits": { id: "socrata-batonrouge-permits", label: "Baton Rouge open data: building permits", sourceUrl: "https://data.brla.gov/d/7fq7-8j7r" },
  "socrata-cincinnati-permits": { id: "socrata-cincinnati-permits", label: "Cincinnati open data: building permits", sourceUrl: "https://data.cincinnati-oh.gov/d/thvx-5mem" },
  "socrata-cincinnati-311": { id: "socrata-cincinnati-311", label: "Cincinnati open data: 311 requests", sourceUrl: "https://data.cincinnati-oh.gov/d/gcej-gmiw" },
  "socrata-cambridge-permits": { id: "socrata-cambridge-permits", label: "Cambridge open data: building permits", sourceUrl: "https://data.cambridgema.gov/d/3wsm-e5jx" },
  "socrata-norfolk-permits": { id: "socrata-norfolk-permits", label: "Norfolk open data: building permits", sourceUrl: "https://data.norfolk.gov/d/fahm-yuh4" },
  "socrata-buffalo-permits": { id: "socrata-buffalo-permits", label: "Buffalo open data: building permits", sourceUrl: "https://data.buffalony.gov/d/9p2d-f3yt" },
  "socrata-montgomery-permits": { id: "socrata-montgomery-permits", label: "Montgomery County open data: building permits", sourceUrl: "https://data.montgomerycountymd.gov/d/m88u-pqki" },
  "socrata-orlando-permits": { id: "socrata-orlando-permits", label: "Orlando open data: building permits", sourceUrl: "https://data.cityoforlando.net/d/ryhf-m453" },
  "socrata-kansascity-311": { id: "socrata-kansascity-311", label: "Kansas City open data: 311 requests", sourceUrl: "https://data.kcmo.org/d/d4px-6rwg" },
  "socrata-cambridge-311": { id: "socrata-cambridge-311", label: "Cambridge open data: 311 requests", sourceUrl: "https://data.cambridgema.gov/d/2z9k-mv9g" },
  "socrata-oakland-311": { id: "socrata-oakland-311", label: "Oakland open data: 311 requests", sourceUrl: "https://data.oaklandca.gov/d/quth-gb8e" },
  "socrata-chicago-violations": { id: "socrata-chicago-violations", label: "Chicago open data: code violations", sourceUrl: "https://data.cityofchicago.org/d/22u3-xenr" },
  "socrata-austin-violations": { id: "socrata-austin-violations", label: "Austin open data: code violations", sourceUrl: "https://data.austintexas.gov/d/6wtj-zbtb" },
  "socrata-chicago-business": { id: "socrata-chicago-business", label: "Chicago open data: new business licenses", sourceUrl: "https://data.cityofchicago.org/d/uupf-x98q" },
  "socrata-sf-business": { id: "socrata-sf-business", label: "San Francisco open data: new business licenses", sourceUrl: "https://data.sf.gov/d/g8m3-pdis" },
  "socrata-la-business": { id: "socrata-la-business", label: "Los Angeles open data: new business licenses", sourceUrl: "https://data.lacity.org/d/6rrh-rzua" },
  "socrata-nyc-business": { id: "socrata-nyc-business", label: "New York City open data: new business licenses", sourceUrl: "https://data.cityofnewyork.us/d/w7w3-xahh" },
  "socrata-orlando-business": { id: "socrata-orlando-business", label: "Orlando open data: new business licenses", sourceUrl: "https://data.cityoforlando.net/d/7388-4re5" },
  "socrata-nyc-events": { id: "socrata-nyc-events", label: "New York City open data: special event permits", sourceUrl: "https://data.cityofnewyork.us/d/tvpp-9vvx" },
  "socrata-chicago-events": { id: "socrata-chicago-events", label: "Chicago open data: special event permits", sourceUrl: "https://data.cityofchicago.org/d/pk66-w54g" },
  "carto-phl-permits": { id: "carto-phl-permits", label: "Philadelphia open data: building permits", sourceUrl: "https://opendataphilly.org/datasets/licenses-and-inspections-building-permits/" },
  "carto-phl-violations": { id: "carto-phl-violations", label: "Philadelphia open data: code violations", sourceUrl: "https://opendataphilly.org/datasets/licenses-and-inspections-violations/" },
  "carto-phl-business": { id: "carto-phl-business", label: "Philadelphia open data: new business licenses", sourceUrl: "https://opendataphilly.org/datasets/licenses-and-inspections-business-licenses/" },
  // Round 20 SALES (lib/signals/adapters/sales-datasets.ts), all on probation.
  "socrata-nyc-acris-sales": { id: "socrata-nyc-acris-sales", label: "New York open data: property sales", sourceUrl: "https://data.cityofnewyork.us/d/bnx9-e6tj" },
  "socrata-cook-sales": { id: "socrata-cook-sales", label: "Cook County open data: property sales", sourceUrl: "https://datacatalog.cookcountyil.gov/d/wvhk-k5uv" },
  "carto-phl-sales": { id: "carto-phl-sales", label: "Philadelphia open data: property sales", sourceUrl: "https://opendataphilly.org/datasets/real-estate-transfers/" },
  "arcgis-miamidade-sales": { id: "arcgis-miamidade-sales", label: "Miami-Dade County open data: property sales", sourceUrl: "https://opendata.miamidade.gov/datasets/bf92e51f90a8426cae904ebc15018067" },
  "arcgis-dekalb-permits": { id: "arcgis-dekalb-permits", label: "DeKalb County open data: building permits", sourceUrl: "https://dcgis.dekalbcountyga.gov/mapping/rest/services/Building_Permit_Applications/MapServer/0" },
  "arcgis-raleigh-permits": { id: "arcgis-raleigh-permits", label: "Raleigh open data: building permits", sourceUrl: "https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Building_Permits/FeatureServer/0" },
  "arcgis-dc-permits": { id: "arcgis-dc-permits", label: "Washington open data: building permits", sourceUrl: "https://maps2.dcgis.dc.gov/DCGIS/rest/services/FEEDS/DCRA/MapServer/4" },
  "arcgis-mecklenburg-permits": { id: "arcgis-mecklenburg-permits", label: "Mecklenburg County open data: building permits", sourceUrl: "https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits_Accela/FeatureServer/0" },
  "arcgis-atlanta-permits": { id: "arcgis-atlanta-permits", label: "Atlanta open data: building permits", sourceUrl: "https://services5.arcgis.com/5RxyIIJ9boPdptdo/arcgis/rest/services/building_permit_featureLayer/FeatureServer/0" },
  "arcgis-dekalb-violations": { id: "arcgis-dekalb-violations", label: "DeKalb County open data: code violations", sourceUrl: "https://dcgis.dekalbcountyga.gov/mapping/rest/services/Hansen/CodeEnforcementCasesInspections/FeatureServer/0" },
  "arcgis-johnscreek-permits": { id: "arcgis-johnscreek-permits", label: "Johns Creek open data: building permits", sourceUrl: "https://services1.arcgis.com/bqfNVPUK3HOnCFmA/ArcGIS/rest/services/Building_Permits_Issued/FeatureServer/0" },
  "arcgis-cobb-residential-permits": { id: "arcgis-cobb-residential-permits", label: "Cobb County open data: building permits", sourceUrl: "https://gis.cobbcounty.org/gisserver/rest/services/comdev/Accela_PermitsDashboard/FeatureServer/4" },
  "arcgis-cobb-commercial-permits": { id: "arcgis-cobb-commercial-permits", label: "Cobb County open data: building permits", sourceUrl: "https://gis.cobbcounty.org/gisserver/rest/services/comdev/Accela_PermitsDashboard/FeatureServer/1" },
  "arcgis-cobb-multiunit-permits": { id: "arcgis-cobb-multiunit-permits", label: "Cobb County open data: building permits", sourceUrl: "https://gis.cobbcounty.org/gisserver/rest/services/comdev/Accela_PermitsDashboard/FeatureServer/3" },
  // Round 19 coverage (ON PROBATION: samples only, never shown to members until promoted).
  "socrata-dallas-permits": { id: "socrata-dallas-permits", label: "Dallas open data: building permits", sourceUrl: "https://www.dallasopendata.com/d/e7gq-4sah" },
  "arcgis-arlington-permits": { id: "arcgis-arlington-permits", label: "Arlington open data: building permits", sourceUrl: "https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/1" },
  "arcgis-miamidade-permits": { id: "arcgis-miamidade-permits", label: "Miami-Dade County open data: building permits", sourceUrl: "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/ArcGIS/rest/services/miamidade_permit_data/FeatureServer/0" },
  "arcgis-miamidade-violations": { id: "arcgis-miamidade-violations", label: "Miami-Dade County open data: code violations", sourceUrl: "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/ArcGIS/rest/services/CodeComplianceViolation_Open_View/FeatureServer/0" },
  "arcgis-miamidade-building-violations": { id: "arcgis-miamidade-building-violations", label: "Miami-Dade County open data: code violations", sourceUrl: "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/ArcGIS/rest/services/BuildingViolation_gdb/FeatureServer/0" },
  "arcgis-phoenix-permits": { id: "arcgis-phoenix-permits", label: "Phoenix open data: building permits", sourceUrl: "https://mapportal.phoenix.gov/pds/rest/services/ShapePHX/ShapePHXPermitsPoints/MapServer/0" },
  "arcgis-tempe-permits": { id: "arcgis-tempe-permits", label: "Tempe open data: building permits", sourceUrl: "https://services.arcgis.com/lQySeXwbBg53XWDi/arcgis/rest/services/building_permits/FeatureServer/0" },
  "arcgis-houston-311": { id: "arcgis-houston-311", label: "Houston open data: 311 requests", sourceUrl: "https://mycity2.houstontx.gov/pubgis01/rest/services/311/D365_SR311_PROD/MapServer/0" },
  "socrata-nyc-hpd-violations": { id: "socrata-nyc-hpd-violations", label: "New York City open data: code violations", sourceUrl: "https://data.cityofnewyork.us/d/wvxf-dwi5" },
  "socrata-nyc-rodent-violations": { id: "socrata-nyc-rodent-violations", label: "New York City open data: code violations", sourceUrl: "https://data.cityofnewyork.us/d/p937-wjvj" },
  "socrata-montgomery-violations": { id: "socrata-montgomery-violations", label: "Montgomery County open data: code violations", sourceUrl: "https://data.montgomerycountymd.gov/d/k9nj-z35d" },
  "arcgis-phoenix-violations": { id: "arcgis-phoenix-violations", label: "Phoenix open data: code violations", sourceUrl: "https://maps.phoenix.gov/pub/rest/services/Public/NSD_Property_Maintenance/MapServer/0" },
  "arcgis-dc-311": { id: "arcgis-dc-311", label: "Washington open data: 311 requests", sourceUrl: "https://maps2.dcgis.dc.gov/DCGIS/rest/services/DCGIS_DATA/ServiceRequests/MapServer/13" },
  "usaspending": { id: "usaspending", label: "Federal contract awards (USAspending.gov)", sourceUrl: "https://www.usaspending.gov/" },
  "sam-gov": { id: "sam-gov", label: "Federal bid opportunities (SAM.gov)", sourceUrl: "https://sam.gov/" },
  "bids-sf": { id: "bids-sf", label: "San Francisco open data: open bids", sourceUrl: "https://data.sf.gov/d/eshn-8t3a" },
  "bids-la": { id: "bids-la", label: "Los Angeles open data: open bids", sourceUrl: "https://data.lacity.org/d/hf3r-utnq" },
  "bids-batonrouge": { id: "bids-batonrouge", label: "Baton Rouge open data: open bids", sourceUrl: "https://data.brla.gov/d/u9zk-8nix" },
  "bids-gwinnett": { id: "bids-gwinnett", label: "Gwinnett County purchasing: open solicitations", sourceUrl: "https://www.gwinnettcounty.com/departments/FinancialServices/Purchasing/BidsandRFPs" },
  "bids-rockdale": { id: "bids-rockdale", label: "Rockdale County procurement: current bids, RFPs and RFQs", sourceUrl: "https://www.rockdalecountyga.gov/current-bids-rfp-rfq" },
  "bids-tucker": { id: "bids-tucker", label: "City of Tucker procurement: bids and RFPs", sourceUrl: "https://www.tuckerga.gov/business-and-development/bids/" },
  "bids-dunwoody": { id: "bids-dunwoody", label: "City of Dunwoody procurement: current opportunities", sourceUrl: "https://www.dunwoodyga.gov/business/doing-business-with-the-city/procurement-opportunities" },
  // Round 20 page watch (ON PROBATION: samples only, never shown to members until promoted).
  "bids-pw-dallas-isd": { id: "bids-pw-dallas-isd", label: "Dallas ISD procurement: open bids", sourceUrl: "https://www.dallasisd.org/fs/pages/160334" },
  "bids-pw-houston-metro": { id: "bids-pw-houston-metro", label: "Houston METRO procurement: open solicitations", sourceUrl: "https://www.ridemetro.org/about/business-to-business/procurement-opportunities" },
  "bids-pw-hha": { id: "bids-pw-hha", label: "Houston Housing Authority procurement: solicitations", sourceUrl: "https://housingforhouston.com/?p=24920" },
  "bids-pw-houston-isd": { id: "bids-pw-houston-isd", label: "Houston ISD procurement: solicitations and bids", sourceUrl: "https://www.houstonisd.org/Page/179249" },
  "bids-pw-atlanta-housing": { id: "bids-pw-atlanta-housing", label: "Atlanta Housing: open solicitations", sourceUrl: "https://www.atlantahousing.org/doing-business-with-ah/solicitations/" },
  "bids-pw-decatur-housing": { id: "bids-pw-decatur-housing", label: "Decatur Housing Authority: procurements", sourceUrl: "https://www.decaturhousing.org/procurement" },
  "bids-pw-aps": { id: "bids-pw-aps", label: "Atlanta Public Schools procurement: outstanding solicitations", sourceUrl: "https://www.atlantapublicschools.us/about/departments/finance/procurement-services/outstanding-solicitations" },
  "bids-pw-septa": { id: "bids-pw-septa", label: "SEPTA procurement: open bids and RFPs", sourceUrl: "https://www.septa.org/procurement/bids/" },
  "bids-pw-philasd-capital": { id: "bids-pw-philasd-capital", label: "School District of Philadelphia: capital bid opportunities", sourceUrl: "https://philasd.org/procurement/?p=4721" },
  "bids-pw-miamidade-construction": { id: "bids-pw-miamidade-construction", label: "Miami-Dade County strategic procurement: construction solicitations", sourceUrl: "https://www.miamidade.gov/apps/ISD/stratproc/Home/CurrentSolicitations" },
  "bids-pw-chicago": { id: "bids-pw-chicago", label: "City of Chicago and CTA: active solicitations", sourceUrl: "https://webapps1.chicago.gov/vcsearch/solicitations" },
  "bids-pw-lacounty-dpw": { id: "bids-pw-lacounty-dpw", label: "LA County Public Works: contract opportunities", sourceUrl: "https://dpw.lacounty.gov/contracts/Opportunities.aspx" },
  "ticketmaster": { id: "ticketmaster", label: "Big events this week (Ticketmaster)", sourceUrl: "https://www.ticketmaster.com/" },
  "bluesky": { id: "bluesky", label: "People asking on Bluesky", sourceUrl: "https://bsky.app/" },
  "websearch-brave": { id: "websearch-brave", label: "People asking for recommendations (web search)", sourceUrl: "https://search.brave.com/" },
  "websearch-serper": { id: "websearch-serper", label: "People asking for recommendations (web search)", sourceUrl: "https://serper.dev/" },
  "holler-request": { id: "holler-request", label: "Requests made on Holler", sourceUrl: "/request" },
  // Round 20 NEXT (on probation): new-business feeds, Houston permit report, certificates of occupancy.
  "socrata-txsales-dallas-business": { id: "socrata-txsales-dallas-business", label: "Texas open data: new sales tax permits", sourceUrl: "https://data.texas.gov/d/jrea-zgmq" },
  "socrata-txsales-houston-business": { id: "socrata-txsales-houston-business", label: "Texas open data: new sales tax permits", sourceUrl: "https://data.texas.gov/d/jrea-zgmq" },
  "socrata-tabc-dallas-business": { id: "socrata-tabc-dallas-business", label: "Texas open data: pending liquor license applications", sourceUrl: "https://data.texas.gov/d/mxm5-tdpj" },
  "socrata-tabc-houston-business": { id: "socrata-tabc-houston-business", label: "Texas open data: pending liquor license applications", sourceUrl: "https://data.texas.gov/d/mxm5-tdpj" },
  "socrata-la-occupancy-permits": { id: "socrata-la-occupancy-permits", label: "Los Angeles open data: certificates of occupancy", sourceUrl: "https://data.lacity.org/d/3f9m-afei" },
  "socrata-nyc-occupancy-permits": { id: "socrata-nyc-occupancy-permits", label: "New York City open data: certificates of occupancy", sourceUrl: "https://data.cityofnewyork.us/d/pkdm-hqz6" },
  "arcgis-miamidade-business": { id: "arcgis-miamidade-business", label: "Miami-Dade County open data: new business licenses", sourceUrl: "https://gisweb.miamidade.gov/arcgis/rest/services/BusinessTracker/MapServer/0" },
  "arcgis-phoenix-liquor-business": { id: "arcgis-phoenix-liquor-business", label: "Phoenix open data: restaurant liquor licenses", sourceUrl: "https://maps.phoenix.gov/pub/rest/services/public/LIQUOR_RACMap/MapServer/11" },
  "arcgis-dc-occupancy-permits": { id: "arcgis-dc-occupancy-permits", label: "Washington open data: certificates of occupancy", sourceUrl: "https://maps2.dcgis.dc.gov/DCGIS/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/FeatureServer/46" },
  "html-houston-permits": { id: "html-houston-permits", label: "City of Houston: weekly permit activity report", sourceUrl: "https://www.houstontx.gov/planning/Publications/listsrv/WebeReport.html" },
};

/** Source ids in SOURCE_META that are not adapters (Holler's own records). */
export const NON_ADAPTER_SOURCES = ['holler-request'] as const;

export function getSourceMeta(sourceId: string): SourceMeta | undefined {
  return SOURCE_META[(sourceId ?? '').toLowerCase()];
}
