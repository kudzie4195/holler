/**
 * Round 17, unit ES (redo 2): the summary sentences Holler composes itself, in Spanish; NWS event names; the 90-day recent block.
 * Built from the real adapter parsers over the committed fixtures, so a template that changes in an adapter fails here.
 *  - English ('en') is the same string, and the English dictionary rebuilds every whole-sentence summary byte for byte;
 *  - Holler's own parts (job value, due dates, agency, start time, FEMA/FAA/USGS sentences) are Spanish and built from the same fields;
 *  - what a source wrote (SPC remarks, NWS headline and description, a buyer, a permit type, a post) is never rewritten.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { localizeSummary, rebuildEnglishSummary, knownFemaIncidents } from '@/lib/signals/summary-i18n';
import { localizeTitle, knownNwsHazards, knownNaicsSectors } from '@/lib/signals/title-i18n';
import { parseFema } from '@/lib/signals/adapters/fema';
import { parseFaa } from '@/lib/signals/adapters/faa';
import { parseUsgs } from '@/lib/signals/adapters/usgs';
import { parseSam } from '@/lib/signals/adapters/sam';
import { parseUsaSpending } from '@/lib/signals/adapters/usaspending';
import { parseTicketmaster } from '@/lib/signals/adapters/ticketmaster';
import { parseBids, BID_DATASETS } from '@/lib/signals/adapters/city-bids';
import { parseNws, NWS_RULES } from '@/lib/signals/adapters/nws';
import { summaryPart } from '@/lib/signals/adapters/permit-privacy';
import { NAICS_SECTORS } from '@/lib/signals/adapters/socrata-datasets';
import { RecentActivityView } from '@/components/feed/recent-activity';
import { typeLabel } from '@/lib/preview/recent';
import { spanishProblems } from '@/lib/i18n/rules';
import { es } from '@/lib/i18n/es';
import { en } from '@/lib/i18n/en';
import { NOW } from '../signals/brief-fixtures';

const fx = (n: string): unknown => JSON.parse(readFileSync(join(__dirname, '../fixtures', n), 'utf8'));
const fxText = (n: string): string => readFileSync(join(__dirname, '../fixtures', n), 'utf8');
const bidFx = (id: string): unknown => JSON.parse(readFileSync(join(__dirname, '../signals/adapters/fixtures', `bids-${id}-live-2026-11-21.json`), 'utf8'));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

/** Real adapter output: the summaries each parser builds from the committed fixtures. */
function adapterSummaries(): { source: string; title: string; summary: string }[] {
  const all = [
    ...parseFema(fx('fema-declarations.json')),
    ...parseFaa(fxText('faa-status.xml')),
    ...parseUsgs(fx('usgs-2.5_day.json')),
    ...parseSam(fx('sam-opportunities.json')),
    ...parseUsaSpending(fx('usaspending-awards.json')),
    ...parseTicketmaster(fx('ticketmaster-events.json')),
    ...parseBids(bidFx('la'), BID_DATASETS.find((d) => d.id === 'bids-la')!, NOW).items,
    ...parseBids(bidFx('batonrouge'), BID_DATASETS.find((d) => d.id === 'bids-batonrouge')!, NOW).items,
  ];
  return all.filter((s) => s.summary).map((s) => ({ source: s.source, title: s.title, summary: s.summary as string }));
}

describe('summaries Holler composes: English unchanged, Spanish from the same fields', () => {
  const rows = adapterSummaries();
  it('the fixtures cover FEMA, FAA, USGS, SAM, USAspending, Ticketmaster and city bids', () => {
    const sources = new Set(rows.map((r) => r.source));
    for (const s of ['fema', 'faa', 'usgs', 'sam-gov', 'usaspending', 'ticketmaster', 'bids-la']) expect(sources.has(s), s).toBe(true);
    expect(rows.length).toBeGreaterThan(20);
  });
  it('English returns the very same string, and the English dictionary rebuilds every whole-sentence summary exactly', () => {
    let rebuilt = 0;
    for (const r of rows) {
      expect(localizeSummary(r.summary, 'en', r.source), r.summary).toBe(r.summary);
      const again = rebuildEnglishSummary(r.summary, r.source);
      if (again !== null) {
        rebuilt++;
        expect(again, r.summary).toBe(r.summary);
      }
    }
    expect(rebuilt).toBeGreaterThan(5);
  });
  it('FEMA, FAA and USGS sentences are Spanish and keep their data', () => {
    for (const r of rows.filter((x) => ['fema', 'faa', 'usgs'].includes(x.source))) {
      const out = localizeSummary(r.summary, 'es', r.source)!;
      expect(out, r.summary).not.toBe(r.summary);
      expect(out, r.summary).not.toMatch(/\b(?:FEMA declared|designated|statewide|earthquake|Magnitude|depth|Expected to end|Average delay|Delays up to| at [A-Z]{3},)\b/);
      expect(spanishProblems(out), out).toEqual([]);
    }
    const fema = rows.find((r) => r.source === 'fema')!;
    expect(localizeSummary(fema.summary, 'es', 'fema')).toMatch(/^FEMA (declaró|hizo una declaración) /);
  });
  it('exact Spanish for each template shape', () => {
    expect(localizeSummary('FEMA declared hurricane (DR-4000) for FL: 3 areas designated (Lee, Collier, Charlotte).', 'es', 'fema')).toBe('FEMA declaró un huracán (DR-4000) para FL: 3 zonas designadas (Lee, Collier, Charlotte).');
    expect(localizeSummary('FEMA declared severe storm(s) (DR-4123) for GA: 1 area designated (Cobb).', 'es', 'fema')).toBe('FEMA declaró tormentas severas (DR-4123) para GA: 1 zona designada (Cobb).');
    expect(localizeSummary('FEMA declared flood for TX (statewide).', 'es', 'fema')).toBe('FEMA declaró una inundación para TX (todo el estado).');
    expect(localizeSummary('FEMA declared flood for TX: 8 areas designated (A, B, C, D, E, F, and more).', 'es', 'fema')).toBe('FEMA declaró una inundación para TX: 8 zonas designadas (A, B, C, D, E, F y más).');
    expect(localizeSummary('FEMA declared toxic substances (EM-3001) for OH (statewide).', 'es', 'fema')).toBe('FEMA hizo una declaración (EM-3001) para OH, tipo de incidente: toxic substances (todo el estado).');
    expect(localizeSummary('Magnitude 5.2 earthquake 9 km SW of Ridgecrest, CA, depth 8 km.', 'es', 'usgs')).toBe('Sismo de magnitud 5.2: 9 km SW of Ridgecrest, CA, a 8 km de profundidad.');
    expect(localizeSummary('Magnitude 4.1 earthquake 3 km N of Town, OK.', 'es', 'usgs')).toBe('Sismo de magnitud 4.1: 3 km N of Town, OK.');
    expect(localizeSummary('Flight delays at ATL, Atlanta: WEATHER / THUNDERSTORMS. Delays up to 1 hour and 15 minutes.', 'es', 'faa')).toBe('Retrasos de vuelos en ATL, Atlanta: WEATHER / THUNDERSTORMS. Demoras de hasta 1 hora y 15 minutos.');
    expect(localizeSummary('Ground delay program at EWR, Newark: WEATHER. Average delay 52 minutes, up to 2 hours.', 'es', 'faa')).toBe('Programa de demoras en tierra en EWR, Newark: WEATHER. Demora promedio: 52 minutos, hasta 2 horas.');
    expect(localizeSummary('Airport closure at JFK, New York: airport closed per NOTAM.', 'es', 'faa')).toBe('Cierre de aeropuerto en JFK, New York: aeropuerto cerrado según NOTAM.');
    expect(localizeSummary('Ground stop at ORD, Chicago: unspecified. Expected to end 2026-11-21T22:00Z.', 'es', 'faa')).toBe('Suspensión de salidas en ORD, Chicago: sin especificar. Se espera que termine 2026-11-21T22:00Z.');
  });
  it('the fixed parts: job value, due dates, agency, start time, segment', () => {
    expect(localizeSummary(summaryPart('estimated_cost', '14500'), 'es', 'socrata-chicago-permits')).toBe('valor del trabajo: $14,500');
    expect(localizeSummary('PERMIT - RENOVATION | $14,500 job value | 2150 N DAMEN', 'es', 'socrata-chicago-permits')).toBe('PERMIT - RENOVATION | valor del trabajo: $14,500 | 2150 N DAMEN');
    expect(localizeSummary('Department of the Army | Roofing | RFQ | due 2026-11-30', 'es', 'bids-la')).toBe('Department of the Army | Roofing | RFQ | vence el 30 nov 2026');
    expect(localizeSummary('City of Baton Rouge | no due date published', 'es', 'bids-batonrouge')).toBe('City of Baton Rouge | sin fecha de vencimiento publicada');
    expect(localizeSummary('Combined Synopsis/Solicitation | Dept of the Army | NAICS 238160 | responses due 2026-12-05', 'es', 'sam-gov')).toBe('Combined Synopsis/Solicitation | Dept of the Army | NAICS 238160 | respuestas hasta el 5 dic 2026');
    expect(localizeSummary('by Department of Veterans Affairs, NAICS 238220', 'es', 'usaspending')).toBe('por Department of Veterans Affairs, NAICS 238220');
    expect(localizeSummary('Sports / Football, starts 2026-11-22 13:00 local time', 'es', 'ticketmaster')).toBe('Deportes / Football, comienza el 22 nov 2026 a las 13:00, hora local');
    expect(localizeSummary('Music, starts 2026-11-22', 'es', 'ticketmaster')).toBe('Música, comienza el 22 nov 2026');
    expect(localizeSummary('Music, starts 2026-11-22 20:30 UTC', 'es', 'ticketmaster')).toBe('Música, comienza el 22 nov 2026 a las 20:30 UTC');
    expect(localizeSummary('Electrical | 100 Main St', 'es', 'arcgis-johnscreek-permits')).toBe('Electricidad | 100 Main St');
  });
  it('every NAICS sector name Holler can print has a Spanish form', () => {
    const printed = [...new Set(Object.values(NAICS_SECTORS))];
    expect(knownNaicsSectors().sort()).toEqual(printed.sort());
    for (const sec of printed) {
      const out = localizeSummary(sec, 'es', 'socrata-sf-business')!;
      expect(out, sec).not.toBe(sec);
      expect(localizeTitle(`New business license in San Francisco: ${sec}`, 'es', 'socrata-sf-business'), sec).toBe(`Licencia de negocio nueva en San Francisco: ${out}`);
    }
  });
  it('what a source wrote is never rewritten', () => {
    const remarks = 'Roof damage reported on several homes. (FFC)';
    expect(localizeSummary(remarks, 'es', 'spc')).toBe(remarks);
    const nws = 'Severe Thunderstorm Warning issued for Cobb. due 2026-11-30 | $5 job value';
    expect(localizeSummary(nws, 'es', 'nws')).toBe(nws);
    const post = 'Need a roofer, due 2026-11-30 | by Friday';
    expect(localizeSummary(post, 'es', 'bluesky')).toBe(post);
    expect(localizeSummary('Residential Alteration | Interior Remodel', 'es', 'socrata-chicago-permits')).toBe('Residential Alteration | Interior Remodel');
    expect(localizeSummary(null, 'es', 'fema')).toBeNull();
    expect(localizeSummary('', 'es')).toBe('');
    expect(localizeSummary(undefined, 'es')).toBeUndefined();
  });
  it('FEMA incident types in Spanish all follow the wording rules', () => {
    for (const inc of knownFemaIncidents()) {
      const out = localizeSummary(`FEMA declared ${inc} (DR-1) for GA (statewide).`, 'es', 'fema')!;
      expect(out, inc).toMatch(/^FEMA declaró /);
      expect(spanishProblems(out), out).toEqual([]);
    }
  });
});

describe('NWS event names', () => {
  /** Every event name that appears in the NWS adapter's rules (as the examples its tests use), in its fixtures, and in the code's own comments. */
  const EVENTS = [
    ...(JSON.parse(fxText('nws-alerts.json')).features as { properties: { event: string } }[]).map((f) => f.properties.event),
    'Tornado Warning', 'Tornado Watch', 'Tornado Emergency', 'Hurricane Warning', 'Hurricane Watch', 'Tropical Storm Warning', 'Storm Surge Warning', 'Typhoon Warning',
    'Severe Thunderstorm Warning', 'Severe Thunderstorm Watch', 'Flood Advisory', 'Flood Statement', 'Flash Flood Warning', 'Flash Flood Watch', 'Flood Warning', 'Flood Watch',
    'Coastal Flood Advisory', 'Lakeshore Flood Warning', 'Ice Storm Warning', 'Blizzard Warning', 'Winter Storm Warning', 'Winter Storm Watch', 'Winter Weather Advisory',
    'Lake Effect Snow Warning', 'Heavy Snow Warning', 'Snow Squall Warning', 'Extreme Cold Warning', 'Extreme Cold Watch', 'Wind Chill Warning', 'Wind Chill Advisory',
    'Cold Weather Advisory', 'Freeze Warning', 'Freeze Watch', 'Hard Freeze Warning', 'Frost Advisory', 'Heat Advisory', 'Excessive Heat Warning', 'Excessive Heat Watch',
    'Extreme Heat Warning', 'High Wind Warning', 'High Wind Watch', 'Extreme Wind Warning', 'Wind Advisory', 'Brisk Wind Advisory', 'Lake Wind Advisory', 'Red Flag Warning',
    'Fire Weather Watch', 'Dense Fog Advisory', 'High Surf Advisory', 'Rip Current Statement', 'Small Craft Advisory', 'Gale Warning', 'Special Weather Statement',
  ];
  it('the fixture and the rules are covered: the adapter keeps only events NWS_RULES knows, and each of those has a Spanish name', () => {
    expect(EVENTS.length).toBeGreaterThan(50);
    expect(NWS_RULES.length).toBeGreaterThan(10);
    const unnamed: string[] = [];
    for (const ev of EVENTS) {
      const out = localizeTitle(`${ev}: Cobb, GA; Fulton, GA`, 'es', 'nws');
      expect(out, ev).toMatch(/^(Aviso|Vigilancia|Advertencia|Declaración|Emergencia)\b/);
      expect(out, ev).not.toMatch(new RegExp(`^${ev.split(' ')[0]}\\b`));
      expect(out.endsWith(': Cobb, GA; Fulton, GA') || out.endsWith('(Cobb, GA; Fulton, GA)'), ev).toBe(true);
      expect(spanishProblems(out), out).toEqual([]);
      if (/^Aviso del Servicio/.test(out)) unnamed.push(ev);
    }
    // the only events that take the generic frame are ones NWS words in a way the table does not have a Spanish name for
    expect(unnamed).toEqual([]);
  });
  it('hazard names in the table all read as Spanish', () => {
    expect(knownNwsHazards().length).toBeGreaterThan(30);
    for (const h of knownNwsHazards()) {
      const ev = `${h.replace(/\b\w/g, (c) => c.toUpperCase())} Warning`;
      const out = localizeTitle(ev, 'es', 'nws');
      expect(out, ev).toMatch(/^Aviso de /);
      expect(out, ev).not.toBe(ev);
    }
  });
  it('an event not in the table takes the generic Spanish frame; a Spanish sentence never starts with English', () => {
    expect(localizeTitle('Volcano Warning: Hawaii County', 'es', 'nws')).toBe('Aviso del Servicio Meteorológico: Volcano Warning (Hawaii County)');
    expect(localizeTitle('Tree Emergency', 'es', 'nws')).toBe('Aviso del Servicio Meteorológico: Tree Emergency');
    expect(localizeTitle('Hurricane Local Statement: Coastal Counties', 'es', 'nws')).toBe('Aviso del Servicio Meteorológico: Hurricane Local Statement (Coastal Counties)');
    // without a source it is not assumed to be an NWS title, so a post is not rewritten
    expect(localizeTitle('Volcano Warning: Hawaii County', 'es')).toBe('Volcano Warning: Hawaii County');
    expect(localizeTitle('Volcano Warning: Hawaii County', 'en', 'nws')).toBe('Volcano Warning: Hawaii County');
  });
  it('the parser output for the NWS fixture is Spanish', () => {
    const items = parseNws(fx('nws-alerts.json'));
    expect(items.length).toBeGreaterThan(2);
    for (const s of items) {
      const out = localizeTitle(s.title, 'es', 'nws');
      expect(out, s.title).not.toBe(s.title);
      expect(out).toMatch(/^(Aviso|Vigilancia|Advertencia)/);
    }
  });
});

describe('the 90-day recent block for a Spanish member', () => {
  const base = { byIntent: { demand: 0, spending: 0, asking: 0 }, examples: [], capped: false };
  it('heading, counts, example titles, dates and note are Spanish; the same preview in English is unchanged', () => {
    const preview = {
      ...base,
      total: 4,
      capped: true,
      byType: [{ key: 'permit', count: 3 }, { key: 'storm-report', count: 1 }],
      examples: [
        { title: '1.50 inch hail reported near 2 ESE Atlanta, GA', city: 'Atlanta', state: 'GA', date: '2026-11-05' },
        { title: 'Roof permit in Atlanta', city: 'Atlanta', state: 'GA', date: '2026-11-02' },
        { title: 'Wind damage reported near 4 E Marietta, GA', city: 'Marietta', state: 'GA', date: '2026-10-28' },
        { title: 'Anyone know a good roofer?', city: null, state: null, date: '2026-10-20' },
      ],
    };
    const t = text(renderToStaticMarkup(createElement(RecentActivityView, { preview, lang: 'es' })));
    expect(t).toContain(es['recent.h']);
    expect(t).toContain('Al menos 3 permisos de construcción');
    expect(t).toContain('1 reporte de tormenta');
    expect(t).toContain('Granizo de 1.50 pulgadas reportado cerca de 2 ESE Atlanta, GA , Atlanta, GA (5 nov)');
    expect(t).toContain('Permiso de techo en Atlanta');
    expect(t).toContain('Viento fuerte reportado cerca de 4 E Marietta, GA (daño no confirmado)');
    expect(t).toContain('Anyone know a good roofer?');
    expect(t).toContain(es['recent.note']);
    expect(t).not.toMatch(/Near you|At least|permit in|reported near|Open Settings/);
    const english = text(renderToStaticMarkup(createElement(RecentActivityView, { preview })));
    expect(english).toBe(text(renderToStaticMarkup(createElement(RecentActivityView, { preview, lang: 'en' }))));
    expect(english).toContain('At least 3 building permits');
    expect(english).toContain('Roof permit in Atlanta , Atlanta, GA (Nov 2)');
  });
  it('empty block and every record type have Spanish labels', () => {
    const t = text(renderToStaticMarkup(createElement(RecentActivityView, { preview: { ...base, total: 0, byType: [] }, lang: 'es' })));
    expect(t).toContain(es['recent.empty']);
    expect(t).toContain(es['recent.settings']);
    expect(spanishProblems(t)).toEqual([]);
    for (const k of ['storm-report', 'weather-alert', 'disaster', 'quake', 'airport', 'permit', '311', 'inspection', 'business', 'violation', 'event', 'event-permit', 'contract', 'federal-bid', 'other', 'nonsense']) {
      for (const n of [1, 5]) {
        const label = typeLabel(k, n, 'es');
        expect(label, `${k} ${n}`).not.toBe(typeLabel(k, n));
        expect(spanishProblems(label), label).toEqual([]);
      }
    }
    expect(typeLabel('permit', 2)).toBe('building permits');
    expect(en['recent.type.permit.many']).toBe('building permits');
  });
});
