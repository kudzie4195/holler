/**
 * Round 17, unit ES (redo 1): Holler's own record titles in Spanish. The adapters compose titles from fixed English templates; a Spanish
 * member's card and email rebuild them (lib/signals/title-i18n.ts). Proven here:
 *  - English is untouched: localizeTitle(.., 'en') is the same string, and the English dictionary rebuilds every adapter title byte for byte;
 *  - every template has a Spanish form built from the same data fields, and text a source wrote stays as it is;
 *  - weather titles never claim damage;
 *  - a title that is somebody's own text (a post, a search hit) is never rewritten.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { localizeTitle, rebuildEnglishTitle, knownPermitLabels, permitLabelLang, titleDataFields } from '@/lib/signals/title-i18n';
import { permitTitleFor, joinLabels } from '@/lib/signals/mapping/permit';
import { permitTitle, civicLabel } from '@/lib/signals/adapters/permit-privacy';
import { inspectionTitle } from '@/lib/signals/adapters/socrata';
import { awardLabel, formatUsd } from '@/lib/signals/adapters/usaspending';
import { requestTitle } from '@/lib/requests/signal';
import { CATEGORIES } from '@/lib/signals/categories';
import { spanishProblems } from '@/lib/i18n/rules';
import { es } from '@/lib/i18n/es';
import { en } from '@/lib/i18n/en';
import { shipCases } from '../signals/ship-fixtures';

/** Every English title shape the adapters build, written from the same helpers and templates the adapters use. */
const TITLES: { source: string; title: string; es: string }[] = [
  { source: 'spc', title: `${(175 / 100).toFixed(2)} inch hail reported near 3 N Smyrna, GA`, es: 'Granizo de 1.75 pulgadas reportado cerca de 3 N Smyrna, GA' },
  { source: 'spc', title: '68 mph wind gust reported near 2 SW Celina, TX', es: 'Ráfaga de viento de 68 mph reportada cerca de 2 SW Celina, TX' },
  { source: 'spc', title: 'Wind damage reported near 4 E Marietta, GA', es: 'Viento fuerte reportado cerca de 4 E Marietta, GA (daño no confirmado)' },
  { source: 'spc', title: 'Tornado reported near 1 NW Dallas, GA', es: 'Tornado reportado cerca de 1 NW Dallas, GA' },
  { source: 'socrata-chicago-permits', title: permitTitleFor('Chicago', 'Roof'), es: 'Permiso de techo en Chicago' },
  { source: 'arcgis-atlanta-permits', title: permitTitleFor('Atlanta', null), es: 'Permiso en Atlanta' },
  { source: 'arcgis-atlanta-permits', title: permitTitleFor('Atlanta', 'New home'), es: 'Permiso de vivienda nueva en Atlanta' },
  { source: 'socrata-chicago-permits', title: permitTitleFor('Raleigh', joinLabels(['Roof', 'HVAC', 'Plumbing'])), es: 'Permiso de techo, HVAC y plomería en Raleigh' },
  { source: 'socrata-chicago-permits', title: permitTitle('Chicago', [], ['siding-gutters'], ''), es: 'Permiso de revestimiento y canaletas en Chicago' },
  { source: 'socrata-chicago-permits', title: permitTitle('Chicago', [], ['windows-doors'], ''), es: 'Permiso de ventanas y puertas en Chicago' },
  { source: 'socrata-chicago-permits', title: permitTitle('Chicago', ['Residential Alteration'], [], ''), es: 'Permiso en Chicago: Residential Alteration' },
  { source: 'sam-gov', title: 'Federal bid in Fort Worth, TX: Roof Replacement, Building 12', es: 'Licitación federal en Fort Worth, TX: Roof Replacement, Building 12' },
  { source: 'usaspending', title: `Federal contract (${formatUsd(310_000)}) in Cincinnati, OH: ${awardLabel(['plumbing'], '238220')}`, es: 'Contrato federal ($310K) en Cincinnati, OH: Plomería (NAICS 238220)' },
  { source: 'usaspending', title: `Federal contract in Cincinnati, OH: ${awardLabel([], '238220')}`, es: 'Contrato federal en Cincinnati, OH: NAICS 238220' },
  { source: 'usaspending', title: `Federal contract in Cincinnati, OH: ${awardLabel([], '')}`, es: 'Contrato federal en Cincinnati, OH: adjudicación federal' },
  { source: 'bids-la', title: 'Open bid in Los Angeles area: REPLACE COOLING TOWERS & CHILLER (PSA)', es: 'Licitación abierta en área de Los Angeles: REPLACE COOLING TOWERS & CHILLER (PSA)' },
  { source: 'bids-batonrouge', title: 'Open bid in Baton Rouge: A26-91082 Window Washing Library Sites', es: 'Licitación abierta en Baton Rouge: A26-91082 Window Washing Library Sites' },
  { source: 'socrata-chicago-inspections', title: inspectionTitle('Chicago'), es: 'Inspección reprobada en Chicago: local de comida' },
  { source: 'socrata-nyc-311', title: '311 request in New York City: Rodent / Rat Sighting', es: 'Solicitud al 311 en New York City: Rodent / Rat Sighting' },
  { source: 'socrata-nyc-311', title: `311 request in Dallas: ${civicLabel(['roofing', 'plumbing'], 'service request')}`, es: 'Solicitud al 311 en Dallas: techo y plomería o fuga' },
  { source: 'socrata-nyc-311', title: `311 request in Dallas: ${civicLabel([], 'service request')}`, es: 'Solicitud al 311 en Dallas: solicitud de servicio' },
  { source: 'socrata-chicago-violations', title: 'Code violation in Chicago: REPAIR EXTERIOR WALL', es: 'Infracción de código en Chicago: REPAIR EXTERIOR WALL' },
  { source: 'socrata-chicago-violations', title: `Code violation in Chicago: ${civicLabel(['hvac'], 'property violation')}`, es: 'Infracción de código en Chicago: calefacción o aire acondicionado' },
  { source: 'socrata-chicago-violations', title: `Code violation in Chicago: ${civicLabel([], 'property violation')}`, es: 'Infracción de código en Chicago: infracción de propiedad' },
  { source: 'socrata-sf-business', title: 'New business in Atlanta: Peachtree Cafe LLC', es: 'Negocio nuevo en Atlanta: Peachtree Cafe LLC' },
  { source: 'socrata-sf-business', title: 'New business license in San Francisco: Food Service', es: 'Licencia de negocio nueva en San Francisco: Food Service' },
  { source: 'socrata-sf-business', title: 'New business license in San Francisco', es: 'Licencia de negocio nueva en San Francisco' },
  { source: 'socrata-nyc-events', title: 'Permitted event in New York City: Street Event at 5 AVENUE between 9 STREET and 10 STREET', es: 'Evento con permiso en New York City: Street Event, en 5 AVENUE between 9 STREET and 10 STREET' },
  { source: 'socrata-nyc-events', title: 'Permitted event in New York City: special event', es: 'Evento con permiso en New York City: evento especial' },
  { source: 'fema', title: 'Major disaster declaration: SEVERE STORMS AND TORNADOES (GA)', es: 'Declaración de desastre mayor: SEVERE STORMS AND TORNADOES (GA)' },
  { source: 'fema', title: 'Emergency declaration: HURRICANE HELENE (FL)', es: 'Declaración de emergencia: HURRICANE HELENE (FL)' },
  { source: 'faa', title: 'Flight delays at Hartsfield-Jackson Atlanta (ATL)', es: 'Retrasos de vuelos: Hartsfield-Jackson Atlanta (ATL)' },
  { source: 'faa', title: 'Ground stop at Newark Liberty (EWR)', es: 'Suspensión de salidas: Newark Liberty (EWR)' },
  { source: 'usgs', title: 'M5.2 earthquake 9 km SW of Ridgecrest, CA', es: 'Sismo M5.2: 9 km SW of Ridgecrest, CA' },
  { source: 'nws', title: 'Severe Thunderstorm Warning: Cobb, GA; Fulton, GA', es: 'Aviso de tormenta eléctrica severa: Cobb, GA; Fulton, GA' },
  { source: 'nws', title: 'Flash Flood Watch', es: 'Vigilancia de inundación repentina' },
  { source: 'ticketmaster', title: 'Atlanta Falcons vs. Tampa Bay Buccaneers at Mercedes-Benz Stadium, Atlanta GA', es: 'Atlanta Falcons vs. Tampa Bay Buccaneers en Mercedes-Benz Stadium, Atlanta GA' },
  { source: 'holler-request', title: requestTitle('Atlanta', 'roofing'), es: 'Solicitud de servicio en Atlanta: Techos' },
  { source: 'holler-request', title: requestTitle(null, 'hvac'), es: 'Solicitud de servicio en su zona: Calefacción y aire acondicionado (HVAC)' },
];

describe('title templates: Spanish from the same fields', () => {
  for (const c of TITLES) {
    it(`${c.source}: ${c.title.slice(0, 60)}`, () => {
      expect(localizeTitle(c.title, 'es', c.source)).toBe(c.es);
      // English is the same string, and the English dictionary rebuilds the adapter's title exactly
      expect(localizeTitle(c.title, 'en', c.source)).toBe(c.title);
      expect(rebuildEnglishTitle(c.title, c.source)).toBe(c.title);
      // the Spanish title follows the Spanish wording rules
      expect(spanishProblems(c.es)).toEqual([]);
    });
  }
});

describe('title rules', () => {
  it('weather never claims damage: the wind report is hedged, the other weather titles name no damage at all', () => {
    expect(localizeTitle('Wind damage reported near X, GA', 'es', 'spc')).toBe('Viento fuerte reportado cerca de X, GA (daño no confirmado)');
    for (const c of TITLES.filter((x) => ['spc', 'nws', 'usgs', 'fema'].includes(x.source))) {
      const out = localizeTitle(c.title, 'es', c.source);
      if (/da(ñ|n)o/i.test(out)) expect(out).toMatch(/daño no confirmado/);
    }
  });
  it('a title somebody wrote is never rewritten, even when it looks like a template', () => {
    const post = 'Roof permit in Atlanta? Need a roofer, anyone know one';
    expect(localizeTitle(post, 'es', 'bluesky')).toBe(post);
    expect(localizeTitle('Anyone know a good plumber in Marietta GA?', 'es', 'bluesky')).toBe('Anyone know a good plumber in Marietta GA?');
    expect(localizeTitle('Roof permit in Atlanta? Need a roofer', 'es', 'websearch-brave')).toBe('Roof permit in Atlanta? Need a roofer');
    // an unknown shape, an empty title and a title with no source come back as given
    expect(localizeTitle('Something else entirely', 'es')).toBe('Something else entirely');
    expect(localizeTitle('', 'es', 'spc')).toBe('');
    // a venue name with "at" in it is only split for ticketmaster
    expect(localizeTitle('Jazz at Lincoln Center', 'es', 'socrata-nyc-events')).toBe('Jazz at Lincoln Center');
  });
  it('every permit label an adapter can print has a Spanish word, with no English left in it', () => {
    const labels = new Set<string>();
    // lib/signals/mapping/permit.ts and permit-privacy.ts print these (read from their source so a new label fails here)
    for (const l of knownPermitLabels()) labels.add(l);
    expect(labels.size).toBeGreaterThan(30);
    for (const l of labels) {
      const word = permitLabelLang(l, 'es');
      expect(word, l).toBeTruthy();
      if (!['hvac'].includes(l)) expect(word, l).not.toBe(l);
      expect(spanishProblems(word!), l).toEqual([]);
    }
    expect(permitLabelLang('Residential Alteration', 'es')).toBeNull();
    expect(permitLabelLang('Roof and Residential Alteration', 'es')).toBeNull();
  });
  it('the labels in the adapter source files are all known (a label added there without a Spanish word fails here)', async () => {
    const { readFileSync } = await import('node:fs');
    const permit = readFileSync('lib/signals/mapping/permit.ts', 'utf8');
    const privacy = readFileSync('lib/signals/adapters/permit-privacy.ts', 'utf8');
    const known = new Set(knownPermitLabels());
    const printed = [
      ...[...permit.matchAll(/^\s*\{?\s*id: '[\w-]+', label: '([^']+)'/gm)].map((m) => m[1]),
      ...[...permit.matchAll(/^\s*label: '([^']+)',$/gm)].map((m) => m[1]),
      ...[...privacy.matchAll(/^\s*\['[\w-]+', '([^']+)'\],$/gm)].map((m) => m[1]).slice(0, 14),
      'New home', 'Demolition', 'New construction',
    ];
    expect(printed.length).toBeGreaterThan(30);
    for (const label of printed) {
      for (const part of label.split(/\s+and\s+/i)) expect(known.has(part.toLowerCase()), `${label} / ${part}`).toBe(true);
    }
  });
  it('trade names inside a federal contract and a resident request are the Spanish trade labels', () => {
    for (const c of CATEGORIES) {
      const out = localizeTitle(`Federal contract in X, GA: ${awardLabel([c.id], '123456')}`, 'es', 'usaspending');
      expect(out, c.id).toBe(`Contrato federal en X, GA: ${es[`trade.${c.id}` as keyof typeof es]} (NAICS 123456)`);
      expect(localizeTitle(requestTitle('X', c.id), 'es', 'holler-request'), c.id).toBe(`Solicitud de servicio en X: ${es[`trade.${c.id}` as keyof typeof es]}`);
    }
  });
  it('every Holler title in the shipped fixtures is rebuilt from its fields, and what stays English is only source text', async () => {
    const cases = await shipCases();
    for (const c of cases) {
      const out = localizeTitle(c.signal.title, 'es', c.signal.source);
      const data = titleDataFields(c.signal.title, c.signal.source);
      let rest = out;
      for (const d of data) rest = rest.split(d).join(' ');
      // after taking the record's own data out, no English template word is left
      expect(rest, c.signal.title).not.toMatch(/\b(?:permit|permits|near|reported|request|federal bid|open bid|violation|inspection|failed|business license|permitted|earthquake|warning|watch|advisory|disaster declaration|flight delays)\b/i);
      expect(spanishProblems(rest), c.signal.title).toEqual([]);
    }
  });
});

describe('the dictionary side of titles', () => {
  it('every title.*, plabel.*, tfix.*, civic.*, fema.*, faa.* and nws.* key has the same placeholders in both languages', () => {
    const keys = Object.keys(en).filter((k) => /^(title|plabel|tfix|civic|fema|faa|nws)\./.test(k));
    expect(keys.length).toBeGreaterThan(100);
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of keys) expect(holes(es[k as keyof typeof es]), k).toEqual(holes(en[k as keyof typeof en]));
  });
});
