// Generates lib/geo/cities.json from the all-the-cities package (dev-time only).
// Usage: node scripts/build-cities.mjs
// Source: all-the-cities (GeoNames-derived). Filter: country US, population >= 50,000, state in 50 states + DC.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const all = require('all-the-cities');

const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

function cleanName(raw) {
  let n = raw.trim();
  if (/^washington,?\s*d\.?c\.?$/i.test(n)) return 'Washington';
  n = n.replace(/\s*\(balance\)\s*$/i, '').replace(/^(City|Town|Village) of /i, '');
  return n.trim();
}

function slugify(s) {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const picked = all
  .filter((c) => c.country === 'US' && c.population >= 50000 && STATE_NAMES[c.adminCode])
  .map((c) => {
    const name = cleanName(c.name);
    const state = c.adminCode;
    return {
      slug: `${slugify(name)}-${state.toLowerCase()}`,
      name,
      state,
      stateName: STATE_NAMES[state],
      lat: Math.round(c.loc.coordinates[1] * 1e4) / 1e4,
      lon: Math.round(c.loc.coordinates[0] * 1e4) / 1e4,
      population: c.population,
    };
  })
  .sort((a, b) => b.population - a.population || a.slug.localeCompare(b.slug));

// Dedupe slugs: keep the most populous (list is already sorted by population desc).
const seen = new Set();
const out = [];
const dropped = [];
for (const c of picked) {
  if (seen.has(c.slug)) {
    dropped.push(c.slug);
    continue;
  }
  seen.add(c.slug);
  out.push(c);
}

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'lib', 'geo', 'cities.json');
writeFileSync(target, JSON.stringify(out) + '\n');
console.log(`wrote ${out.length} cities to ${target}; dropped duplicate slugs: ${dropped.join(', ') || 'none'}`);
