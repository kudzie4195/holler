/**
 * Static source metadata (id, label, sourceUrl) for every adapter in lib/signals/registry.ts ALL_ADAPTERS.
 * Client-safe: the registry imports every adapter (and lib/env), so client components import this instead.
 * Derived from the adapter configs on 2026-11-16; tests/signals/core/source-meta.test.ts fails if it drifts from ALL_ADAPTERS.
 */
export interface SourceMeta {
  id: string;
  label: string;
  sourceUrl: string;
}

export const SOURCE_META: Record<string, SourceMeta> = {
  "nws": { id: "nws", label: "National Weather Service alerts", sourceUrl: "https://www.weather.gov/alerts" },
  "spc": { id: "spc", label: "NOAA Storm Prediction Center storm reports", sourceUrl: "https://www.spc.noaa.gov/climo/reports/" },
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
  "socrata-batonrouge-311": { id: "socrata-batonrouge-311", label: "Baton Rouge open data: 311 requests", sourceUrl: "https://data.brla.gov/d/7ixm-mnvx" },
  "socrata-cincinnati-permits": { id: "socrata-cincinnati-permits", label: "Cincinnati open data: building permits", sourceUrl: "https://data.cincinnati-oh.gov/d/thvx-5mem" },
  "socrata-cincinnati-311": { id: "socrata-cincinnati-311", label: "Cincinnati open data: 311 requests", sourceUrl: "https://data.cincinnati-oh.gov/d/gcej-gmiw" },
  "usaspending": { id: "usaspending", label: "Federal contract awards (USAspending.gov)", sourceUrl: "https://www.usaspending.gov/" },
  "sam-gov": { id: "sam-gov", label: "Federal bid opportunities (SAM.gov)", sourceUrl: "https://sam.gov/" },
  "ticketmaster": { id: "ticketmaster", label: "Big events this week (Ticketmaster)", sourceUrl: "https://www.ticketmaster.com/" },
  "bluesky": { id: "bluesky", label: "People asking on Bluesky", sourceUrl: "https://bsky.app/" },
  "websearch-brave": { id: "websearch-brave", label: "People asking for recommendations (web search)", sourceUrl: "https://search.brave.com/" },
  "websearch-serper": { id: "websearch-serper", label: "People asking for recommendations (web search)", sourceUrl: "https://serper.dev/" },
};

export function getSourceMeta(sourceId: string): SourceMeta | undefined {
  return SOURCE_META[(sourceId ?? '').toLowerCase()];
}
