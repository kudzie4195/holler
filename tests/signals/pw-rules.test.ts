/**
 * Round 35: the pressure-washing rule set (lib/signals/lead-rules.ts pwRuleOf) behind HOLLER_PW_RULES_ENABLED. Off (the default), a member
 * with House cleaning AND Siding and gutters gets exactly what those two trades got before. On, roof-only permits are left out and the
 * member gets exterior work (painting, siding, deck, fence, concrete), titled tenant fit-outs, finished new homes, storefront licences and
 * private graffiti, with a pw reason line in English and Spanish.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keptMatchLabel, labelFor, labelForMember, pwRuleOf, PW_MAX_VALUE, type LabelInput } from '@/lib/signals/lead-rules';
import { alertHoldFor, licenceKeepsHold } from '@/lib/signals/alert-gate';
import { pwCapDecisions, pwCapTimeline, pwPlaceOf, samePlace, type PwPast } from '@/lib/signals/pw-caps';
import { matchOne, matchSignals, membersOfTrade, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { briefFor, cardBrief, MAX_WHY, PW_WHY, PW_WHY_MORE, tradeForRecord } from '@/lib/signals/brief';
import { briefForLang, cardBriefLang, MAX_WHY_BY_LANG } from '@/lib/signals/brief-i18n';
import { carriedTrades, expandCategoriesForRouting, PW_READ_TAGS } from '@/lib/signals/permit-routing';
import { isPwMember, pwRulesEnabled, PW_PARTS, PW_RULES_FLAG, PW_TRADE } from '@/lib/signals/pw-switch';
import { PRESSURE_WASHING_ID, PRESSURE_WASHING_PARTS } from '@/lib/plan/composite-trades';
import { INLINED_SWITCHES } from '@/lib/build-switches';
import { ENV_KEYS } from '@/lib/env';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';
import { BANNED } from './banned';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProfileForm } from '@/components/profile-form';
import { loadPwHistory } from '@/lib/signals/pw-history';

afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv(PW_RULES_FLAG, '1');

const PW = ['cleaning', 'siding-gutters'];
const permit = (title: string, summary: string, categories: string[], extra: Partial<LabelInput> = {}) => ({
  source: 'socrata-chicago-permits',
  kind: 'permit',
  subtype: 'permit',
  title,
  summary,
  categories,
  ...extra,
});
const ROOF = permit('Roof permit in Chicago', 'PERMIT – EXPRESS PERMIT PROGRAM | Reroofing | $10,225 job value | 3447 W 71ST PL', ['roofing']);
const ROOF_PORCH = permit('Roof permit in Chicago', 'PERMIT – EXPRESS PERMIT PROGRAM | Porch,Deck,Balcony,or Fire Escape | $12,000 job value | 2700 N SEMINARY AVE', ['roofing']);
const FENCE = permit('Fence permit in Chicago', 'PERMIT – EXPRESS PERMIT PROGRAM | Fence or Trash Enclosure | $11,568 job value | 5710 S MENARD AVE', ['fencing']);
const PAINT = permit('Painting permit in Baton Rouge', 'Paint Permit (R) | Residential | $6,000 job value | 7963 STARWOOD CT', ['painting'], { source: 'socrata-batonrouge-permits' });
const BIG_CONCRETE = permit('Concrete permit in Chicago', 'PERMIT - RENOVATION/ALTERATION | $280,000 job value | 3705 N FRANCISCO AVE', ['concrete-paving']);
const SHED = permit('Concrete permit in New York City', 'Sidewalk Shed | $5,000 job value | Manhattan | 150 EAST 79 STREET Manhattan', ['concrete-paving'], { source: 'socrata-nyc-permits' });
const SITE_FENCE = permit('Fence permit in New York City', 'Construction Fence | $5,000 job value | Brooklyn | 531 MONTGOMERY STREET Brooklyn', ['fencing'], { source: 'socrata-nyc-permits' });
const NEW_HOME = permit('New home permit in Raleigh', 'Building | New Residential Dwelling | $246,422 job value | 5611 Farley Dr', ['general-contractor', 'real-estate', 'moving'], { source: 'arcgis-raleigh-permits' });
const FIT_OUT = permit('Tenant fit-out permit in Mecklenburg County', 'Upfit | 1815 CENTRAL AV CHARLOTTE NC 28205', ['general-contractor'], { source: 'arcgis-mecklenburg-permits' });
const GRAFFITI = { source: 'socrata-sf-311', kind: 'civic', subtype: '311', title: '311 request in San Francisco: Graffiti Private / not_offensive', summary: 'Graffiti Private | not_offensive', categories: ['painting', 'cleaning'] };
const PUBLIC_GRAFFITI = { ...GRAFFITI, title: '311 request in San Francisco: Graffiti Public / not_offensive', summary: 'Graffiti Public | not_offensive' };
const STORE = { source: 'socrata-sf-business', kind: 'civic', subtype: 'business', title: 'New business license in San Francisco: Retail Trade', summary: 'Retail Trade | 94110', categories: ['signs-printing', 'janitorial-commercial', 'security'] };
const WIND = { source: 'spc', kind: 'report', title: 'Wind damage reported near 2 SE Downtown Los Angel, CA', summary: 'Numerous reports of downed trees.', categories: ['tree-service', 'roofing'], storm: { type: 'wind' as const, windDamage: true } };
const HAIL = { source: 'spc', kind: 'report', title: '1.25 inch hail reported near Plano, TX', summary: '', categories: ['roofing', 'siding-gutters'], storm: { type: 'hail' as const, hailInches: 1.25 } };

describe('the switch', () => {
  it('is off unless 1, true, on or yes, is an ENV_KEYS name and is inlined at build (the browser reads it)', () => {
    expect(pwRulesEnabled(undefined)).toBe(false);
    expect(pwRulesEnabled('')).toBe(false);
    expect(pwRulesEnabled('0')).toBe(false);
    for (const v of ['1', 'true', ' ON ', 'yes']) expect(pwRulesEnabled(v)).toBe(true);
    expect(ENV_KEYS as readonly string[]).toContain(PW_RULES_FLAG);
    expect(INLINED_SWITCHES as readonly string[]).toContain(PW_RULES_FLAG);
    // the reader is a plain member expression (the only form next.config.ts env inlines)
    expect(readFileSync('lib/signals/pw-switch.ts', 'utf8')).toContain('process.env.HOLLER_PW_RULES_ENABLED');
    for (const f of ['.env.example', 'LAUNCH.md']) expect(readFileSync(f, 'utf8'), f).toContain(PW_RULES_FLAG);
  });
  it('the pw member is the sign-up chip: both of its parts held', () => {
    expect([...PW_PARTS]).toEqual([...PRESSURE_WASHING_PARTS]);
    expect(PW_TRADE).toBe(PRESSURE_WASHING_ID);
    expect(isPwMember(PW, true)).toBe(true);
    expect(isPwMember([...PW, 'painting'], true)).toBe(true);
    expect(isPwMember(['cleaning'], true)).toBe(false);
    expect(isPwMember(['siding-gutters'], true)).toBe(false);
    expect(isPwMember(PW, false)).toBe(false);
    expect(isPwMember(PW)).toBe(false); // default: off
  });
});

describe('switch off: nothing changes', () => {
  it('a pw member gets the two trades labels, the roof permit included', () => {
    // switch off, labelForMember is exactly the best of the two trades' own labels over the trades the record carries
    const rank: Record<string, number> = { act_now: 0, coming_soon: 1, market_insight: 2, context: 3 };
    for (const r of [ROOF, ROOF_PORCH, FENCE, NEW_HOME, FIT_OUT, GRAFFITI, STORE, WIND, HAIL]) {
      const carried = carriedTrades(r, r.categories).filter((c) => PW.includes(c));
      const best = carried.length ? carried.map((t) => labelFor(r, t as never)).sort((a, b) => rank[a] - rank[b])[0] : labelFor(r, null);
      expect(labelForMember(r, PW), String(r.title)).toBe(best);
    }
    expect(labelForMember(ROOF, PW)).toBe('coming_soon');
    expect(labelForMember(ROOF, PW)).toBe(labelFor(ROOF, 'siding-gutters'));
    expect(expandCategoriesForRouting(PW)).not.toContain('fencing');
    expect(tradeForRecord(ROOF, ROOF.categories, PW)).toBe('siding-gutters');
    expect(briefFor({ ...ROOF, label: 'coming_soon', trade: 'siding-gutters' }).why).toBe('A roof permit was filed nearby; gutters and siding often come up with it.');
  });
  it('matchOne still matches the roof permit and never the painting permit', () => {
    const prof: MatchProfile = { user_id: 'u', categories: PW, lat: 41.77, lon: -87.71, state: 'IL', radius_mi: 25 };
    const sig = (r: typeof ROOF, id: number): MatchSignal => ({ id, categories: r.categories, lat: 41.77, lon: -87.71, state: 'IL', severity: 1, occurred_at: '2026-11-20T00:00:00Z', subtype: r.subtype, source: r.source, title: r.title, summary: r.summary, kind: r.kind });
    expect(matchOne(sig(ROOF, 1), prof, false)?.trade).toBe('siding-gutters');
    expect(matchOne(sig(FENCE, 2), prof, false)).toBeNull();
  });
});

describe('switch on: the pw rule set', () => {
  it('labels each record family as the table says', () => {
    on();
    expect(pwRuleOf(ROOF)).toEqual({ label: 'context', kind: null });
    expect(pwRuleOf(ROOF_PORCH)).toEqual({ label: 'coming_soon', kind: 'deck' });
    expect(pwRuleOf(FENCE)).toEqual({ label: 'coming_soon', kind: 'fence' });
    expect(pwRuleOf(PAINT)).toEqual({ label: 'coming_soon', kind: 'painting' });
    expect(pwRuleOf(BIG_CONCRETE).label).toBe('context'); // no drive, patio, walk or slab word: not a pw concrete job
    expect(PW_MAX_VALUE).toBe(250_000);
    expect(pwRuleOf(SHED).label).toBe('context');
    expect(pwRuleOf(SITE_FENCE).label).toBe('context');
    expect(pwRuleOf(NEW_HOME)).toEqual({ label: 'market_insight', kind: 'new-home' });
    expect(pwRuleOf({ ...NEW_HOME, permitStage: 'final_inspection' })).toEqual({ label: 'coming_soon', kind: 'new-home' });
    // a fit-out is a heads-up only with a storefront word
    expect(pwRuleOf(FIT_OUT)).toEqual({ label: 'market_insight', kind: 'fit-out' });
    expect(pwRuleOf({ ...FIT_OUT, summary: 'Upfit | Retail | 1815 CENTRAL AV CHARLOTTE NC 28205' })).toEqual({ label: 'coming_soon', kind: 'fit-out' });
    // graffiti is a heads-up, never act now (review P1-1)
    expect(pwRuleOf(GRAFFITI)).toEqual({ label: 'coming_soon', kind: 'graffiti' });
    expect(pwRuleOf(PUBLIC_GRAFFITI).label).toBe('context');
    expect(pwRuleOf(STORE)).toEqual({ label: 'coming_soon', kind: 'storefront' });
    expect(pwRuleOf(WIND)).toEqual({ label: 'market_insight', kind: 'storm-debris' });
    expect(pwRuleOf(HAIL).label).toBe('context');
    expect(pwRuleOf({ source: 'socrata-chicago-violations', kind: 'civic', subtype: 'violation', title: 'Code violation in Chicago: CLEAN MILDEW FROM EXTERIOR WALL' })).toEqual({ label: 'act_now', kind: 'exterior-order' });
    expect(pwRuleOf({ source: 'socrata-chicago-violations', kind: 'civic', subtype: 'violation', title: 'Code violation in Chicago: REPAIR EXTERIOR WALL' }).label).toBe('context');
    // a severe NWS warning stays in the feed; an advisory does not
    const nws = { source: 'nws', kind: 'alert', title: 'Severe Thunderstorm Warning: San Mateo, CA', summary: '', lat: 37.5, lon: -122.3, state: 'CA' };
    expect(pwRuleOf({ ...nws, severity: 3 })).toEqual({ label: 'market_insight', kind: 'severe-weather' });
    expect(pwRuleOf({ ...nws, severity: 2 }).label).toBe('context');
  });
  it('concrete is a home drive, patio, walk or slab; no pools, public sidewalks, additions or commercial buildings', () => {
    on();
    const c = (summary: string, title = 'Concrete permit in Baton Rouge') => pwRuleOf(permit(title, summary, ['concrete-paving'], { source: 'socrata-batonrouge-permits' }));
    expect(c('Driveway Permit (R) | Residential | 2169 DONRAY DR')).toEqual({ label: 'coming_soon', kind: 'concrete' });
    expect(c('Patio slab | Residential | $8,000 job value | 12 OAK ST')).toEqual({ label: 'coming_soon', kind: 'concrete' });
    expect(c('PoolSpa | 2327 LOCHVIEW ST PINEVILLE NC 28134', 'Pool and concrete permit in Mecklenburg County').label).toBe('context');
    expect(c('Driveway / Sidewalks | New | $4,000 job value | 100 MAIN ST', 'Concrete permit in Austin').label).toBe('context');
    expect(c('Sidewalk Obstruction | 12 MAIN ST', 'Concrete permit in Cambridge').label).toBe('context');
    expect(c('Addition | Slab | $20,000 job value | 9 ELM ST').label).toBe('context');
    expect(c('Bldg-Alter/Repair | Commercial | Driveway | $9,000 job value | 9 ELM ST').label).toBe('context');
    expect(c('Bldg-Alter/Repair | 1 or 2 Family Dwelling | $5,000 job value | 13501 W FERNMONT ST', 'Concrete permit in Los Angeles').label).toBe('context');
  });
  it('whole words only, street names skipped, the value floor only where a value is printed (review P2-4 probes)', () => {
    on();
    const r = (title: string, summary: string) => pwRuleOf(permit(title, summary, ['roofing']));
    expect(r('Roof permit in Chicago', 'PERMIT - RENOVATION/ALTERATION | Parking Deck | $90,000 job value | 100 N STATE ST').label).toBe('context');
    expect(r('Roof permit in Chicago', 'Roof Deck | $40,000 job value | 100 N STATE ST').label).toBe('context');
    expect(r('Roof permit in Austin', 'Residential | Balcones Dr | $12,000 job value').label).toBe('context');
    expect(r('Roof permit in Charleston', 'Re-roof | Porcher Ave | $9,000 job value').label).toBe('context');
    expect(r('Roof permit in Chicago', 'Reroofing | Fenchurch Building | $9,000 job value | 12 W MAIN ST').label).toBe('context');
    expect(r('Roof permit in New York City', 'Sidewalk Cafe | $5,000 job value | Manhattan | 150 EAST 79 STREET Manhattan').label).toBe('context');
    expect(r('Electrical permit in Chicago', 'Electric fence charger | $2,000 job value | 12 W MAIN ST').label).toBe('context');
    expect(r('Painting permit in Chicago', 'Interior painting | $3,000 job value | 12 W MAIN ST').label).toBe('context');
    expect(r('Window, flooring and painting permit in New York City', 'General Construction | $98,600 job value | Brooklyn | 1819 WEST 8 STREET Brooklyn').label).toBe('context');
    // with a value: $1,000 to $250,000
    expect(r('Fence permit in Chicago', 'Fence or Trash Enclosure | $800 job value | 12 W MAIN ST').label).toBe('market_insight');
    expect(r('Fence permit in Chicago', 'Fence or Trash Enclosure | $1,000 job value | 12 W MAIN ST').label).toBe('coming_soon');
    // no value: the record's own type must name the work; a title label alone is feed only
    expect(r('Fence permit in Washington', 'CONSTRUCTION | FENCE | 1860 BRYANT ST NE, WASHINGTON, DC 20018').label).toBe('coming_soon');
    expect(r('Fence and deck permit in Cincinnati', 'Building Combo Permit | Alter Residential | 3211 GOLDEN AV').label).toBe('market_insight');
  });
  it('labelForMember: roof-only is left out, the other trades of the member keep their own label', () => {
    on();
    expect(labelForMember(ROOF, PW)).toBe('context');
    expect(labelForMember(FENCE, PW)).toBe('coming_soon');
    expect(labelForMember(ROOF, [...PW, 'roofing'])).toBe('market_insight');
    expect(labelForMember(ROOF, ['siding-gutters'])).toBe('coming_soon');
    expect(labelForMember(NEW_HOME, ['cleaning'])).toBe(labelFor(NEW_HOME, 'cleaning'));
  });
  it('matchOne: a painting or fence permit reaches a pw member under "pressure-washing"; a roof permit does not', () => {
    on();
    const prof: MatchProfile = { user_id: 'u', categories: PW, lat: 41.77, lon: -87.71, state: 'IL', radius_mi: 25 };
    const sig = (r: typeof ROOF, id: number): MatchSignal => ({ id, categories: r.categories, lat: 41.77, lon: -87.71, state: 'IL', severity: 1, occurred_at: '2026-11-20T00:00:00Z', subtype: r.subtype, source: r.source, title: r.title, summary: r.summary, kind: r.kind });
    expect(matchOne(sig(ROOF, 1), prof, false)).toBeNull();
    const m = matchOne(sig(FENCE, 2), prof, false);
    expect(m?.label).toBe('coming_soon');
    expect(m?.trade).toBe(PW_TRADE);
    expect(matchOne(sig(PAINT, 3), prof, false)?.trade).toBe(PW_TRADE);
    expect(matchOne(sig(FENCE, 4), { ...prof, categories: ['cleaning'] }, false)).toBeNull();
  });
  it('the read widens only for a pw member', () => {
    on();
    for (const t of PW_READ_TAGS) expect(expandCategoriesForRouting(PW)).toContain(t);
    expect(expandCategoriesForRouting(['cleaning'])).not.toContain('fencing');
    expect(PW_READ_TAGS).not.toContain('painting');
    expect(PW_READ_TAGS).not.toContain('tree-service');
  });
});

describe('the licence hold (review P2-2): no pw licence without a named business is ever an alert', () => {
  const prof: MatchProfile = { user_id: 'u', categories: PW, lat: 37.76, lon: -122.41, state: 'CA', radius_mi: 25 };
  const lic = (contactPath?: 'business' | 'site' | null): MatchSignal => ({ id: 9, categories: STORE.categories, lat: 37.76, lon: -122.41, state: 'CA', severity: 1, occurred_at: '2026-11-20T00:00:00Z', subtype: 'business', source: STORE.source, title: STORE.title, summary: STORE.summary, kind: 'civic', ...(contactPath !== undefined ? { contactPath } : {}) });
  for (const fix of ['', '1']) {
    it(`HOLLER_BUSINESS_TAG_FIX_ENABLED=${fix || 'off'}: held unless a business is named`, () => {
      on();
      vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', fix);
      for (const c of [undefined, null, 'site'] as const) {
        const m = matchOne(lic(c), prof, false);
        expect(m?.trade, String(c)).toBe(PW_TRADE);
        expect(m?.hold, String(c)).toBe('background');
      }
      expect(matchOne(lic('business'), prof, false)?.hold).toBeUndefined();
      expect(licenceKeepsHold({ subtype: 'business' })).toBe(true);
    });
  }
  it('switch off: the round 33 licence rule alone, exactly as before', () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '');
    expect(licenceKeepsHold({ subtype: 'business' })).toBe(false);
    expect(alertHoldFor({ source: STORE.source, subtype: 'business', title: STORE.title, summary: STORE.summary, data: null, contactPath: undefined }, 'coming_soon', 'janitorial-commercial', null)).toBeNull();
  });
});

describe('the volume caps (review P1-1)', () => {
  const g = (lat: number, lon: number) => pwPlaceOf('graffiti', { lat, lon });
  const DAYMS = 86_400_000;
  const now = Date.parse('2026-11-20T18:00:00Z');
  it('at most 3 graffiti alerts a member a day; the rest are held, not dropped', () => {
    const cards = [0, 1, 2, 3, 4].map((i) => ({ place: g(37.76 + i * 0.01, -122.41), alert: true }));
    expect(pwCapDecisions(cards, [], now)).toEqual(['keep', 'keep', 'keep', 'hold', 'hold']);
    const past: PwPast[] = [0, 1, 2].map((i) => ({ place: g(37.70 + i * 0.01, -122.45)!, at: now - 3_600_000, alert: true }));
    expect(pwCapDecisions([{ place: g(37.8, -122.41), alert: true }], past, now)).toEqual(['hold']);
    // yesterday's do not count toward today
    expect(pwCapDecisions([{ place: g(37.8, -122.41), alert: true }], past.map((p) => ({ ...p, at: now - DAYMS })), now)).toEqual(['keep']);
    // a failed history read holds every graffiti alert
    expect(pwCapDecisions([{ place: g(37.8, -122.41), alert: true }], [], now, false)).toEqual(['hold']);
  });
  it('one card per block per week, one per building or complex per week', () => {
    expect(pwCapDecisions([{ place: g(37.7600, -122.4100), alert: true }, { place: g(37.7604, -122.4102), alert: true }], [], now)).toEqual(['keep', 'drop']);
    const old: PwPast = { place: g(37.76, -122.41)!, at: now - 8 * DAYMS, alert: true };
    expect(pwCapDecisions([{ place: g(37.76, -122.41), alert: true }], [old], now)).toEqual(['keep']);
    expect(pwCapDecisions([{ place: g(37.76, -122.41), alert: true }], [{ ...old, at: now - 5 * DAYMS }], now)).toEqual(['drop']);
    const b = (summary: string) => pwPlaceOf('siding', { summary, subtype: 'permit', lat: 34.25, lon: -118.6 });
    const canoga = ['10010 N CANOGA AVE BLDG. B', '10000 N CANOGA AVE BLDG C', '9950 N CANOGA AVE BLDG A', '9960 N CANOGA AVE BLDG D'].map((a) => ({ place: b(`Bldg-Alter/Repair | Commercial | $10,000 job value | ${a}`), alert: true }));
    expect(pwCapDecisions(canoga, [], now)).toEqual(['keep', 'drop', 'drop', 'drop']);
    expect(samePlace(b('X | 523 Dumaine St')!, b('X | 527 Dumaine St')!)).toBe(true);
    expect(samePlace(b('X | 523 Dumaine St')!, b('X | 1523 Dumaine St')!)).toBe(false);
    expect(samePlace(b('X | 523 Dumaine St')!, b('X | 523 Royal St')!)).toBe(false);
  });
  it('the timeline counts day by day', () => {
    const at = (d: number) => Date.parse('2026-11-16T12:00:00Z') + d * DAYMS;
    const cards = Array.from({ length: 12 }, (_, i) => ({ place: g(37.70 + i * 0.01, -122.41), alert: true, at: at(i % 2) }));
    const d = pwCapTimeline(cards);
    expect(d.filter((x) => x === 'keep').length).toBe(6);
    expect(d.filter((x) => x === 'hold').length).toBe(6);
  });
});

describe('two pw members and single-trade members in one scan (matchSignals)', () => {
  const NOWD = new Date('2026-11-20T18:00:00Z');
  const sig = (id: number, r: { source: string; kind: string; subtype: string; title: string; summary: string; categories: string[] }, lat: number, lon: number): MatchSignal => ({ id, categories: r.categories, lat, lon, state: 'CA', severity: 1, occurred_at: '2026-11-20T10:00:00Z', subtype: r.subtype, source: r.source, title: r.title, summary: r.summary, kind: r.kind });
  const sigs: MatchSignal[] = [
    ...[0, 1, 2, 3, 4, 5].map((i) => sig(100 + i, GRAFFITI, 37.70 + i * 0.01, -122.41)),
    sig(110, GRAFFITI, 37.7001, -122.4101), // same block as 100
    ...['10010 N CANOGA AVE BLDG. B', '10000 N CANOGA AVE BLDG C', '9950 N CANOGA AVE BLDG A'].map((a, i) =>
      sig(200 + i, permit('Roof and siding permit in Los Angeles', `Bldg-Alter/Repair | Commercial | $10,000 job value | ${a}`, ['roofing', 'siding-gutters'], { source: 'socrata-la-permits' }) as never, 37.72, -122.42),
    ),
    sig(300, ROOF as never, 37.73, -122.43),
  ];
  const profiles: MatchProfile[] = [
    { user_id: 'pw1', categories: PW, lat: 37.72, lon: -122.42, state: 'CA', radius_mi: 25 },
    { user_id: 'pw2', categories: PW, lat: 37.72, lon: -122.42, state: 'CA', radius_mi: 25 },
    { user_id: 'clean', categories: ['cleaning'], lat: 37.72, lon: -122.42, state: 'CA', radius_mi: 25 },
    { user_id: 'siding', categories: ['siding-gutters'], lat: 37.72, lon: -122.42, state: 'CA', radius_mi: 25 },
  ];
  it('each pw member: 3 graffiti alerts, the rest held, one card per block and per complex, no roof card', () => {
    on();
    const rows = matchSignals(sigs, profiles, undefined, NOWD, false);
    for (const u of ['pw1', 'pw2']) {
      const mine = rows.filter((r) => r.user_id === u);
      const graf = mine.filter((r) => r.signal_id >= 100 && r.signal_id < 200);
      expect(graf.length, u).toBe(6); // 110 is the same block as 100
      expect(graf.filter((r) => !r.alert_hold).length, u).toBe(3);
      expect(graf.filter((r) => r.alert_hold === 'held').length, u).toBe(3);
      expect(mine.filter((r) => r.signal_id >= 200 && r.signal_id < 300).length, u).toBe(1);
      expect(mine.some((r) => r.signal_id === 300), u).toBe(false);
    }
  });
  it('a member with one of the two trades gets the same cards with the switch on and off', () => {
    const pick = () => matchSignals(sigs, profiles, undefined, NOWD, false).filter((r) => r.user_id === 'clean' || r.user_id === 'siding').map((r) => `${r.user_id}:${r.signal_id}:${r.alert_hold ?? ''}`).sort();
    const off = pick();
    on();
    expect(pick()).toEqual(off);
  });
  it('the pw competition count is the pw members (membersOfTrade)', () => {
    on();
    expect(membersOfTrade(sigs[7], PW_TRADE, profiles, false)).toBe(2);
  });
});

/** Eight real export rows (ids from the review, data/rev-e-prod.json) whose feed card printed "Roof" in its reason line before the fix. */
const ROOF_CARDS = [
  { id: 951, source: 'socrata-nyc-permits', title: 'Roof, concrete and damage repair permit in New York City', summary: 'General Construction | $910,750 job value | Manhattan | 7 HARRISON STREET Manhattan', categories: ['roofing', 'concrete-paving', 'restoration'] },
  { id: 2772, source: 'socrata-nola-permits', title: 'Roof, HVAC, siding and flooring permit in New Orleans', summary: 'Renovation (Structural or Non-structural) | Permit Issued | $1,484,196 job value | 521 Saint Mary St', categories: ['roofing', 'hvac', 'siding-gutters', 'flooring'] },
  { id: 2784, source: 'socrata-nola-permits', title: 'Roof, HVAC, siding and flooring permit in New Orleans', summary: 'Renovation (Structural or Non-structural) | Permit Issued | $445,211 job value | 520 Saint Andrew St', categories: ['roofing', 'hvac', 'siding-gutters', 'flooring'] },
  { id: 34263, source: 'socrata-sf-permits', title: 'Roof, demolition and concrete permit in San Francisco', summary: 'otc alterations permit | $2,750,000 job value | issued | 600 California St', categories: ['roofing', 'junk-removal', 'concrete-paving'] },
  { id: 41734, source: 'socrata-nyc-permits', title: 'New home and roof permit in New York City', summary: 'General Construction | $3,134,250 job value | Manhattan | 101 7 AVENUE Manhattan', categories: ['general-contractor', 'roofing'] },
  { id: 74843, source: 'socrata-nyc-permits', title: 'Roof and deck permit in New York City', summary: 'General Construction | $1,379,750 job value | Queens | 67-30 DARTMOUTH STREET', categories: ['roofing', 'general-contractor'] },
  { id: 107348, source: 'socrata-nyc-permits', title: 'Roof and fence permit in New York City', summary: 'Structural | $450,000 job value | Manhattan | 111 HUDSON STREET', categories: ['roofing', 'fencing'] },
  { id: 107492, source: 'socrata-nyc-permits', title: 'Roof and deck permit in New York City', summary: 'General Construction | $859,800 job value | Manhattan | 29 WEST 65 STREET', categories: ['roofing', 'general-contractor'] },
];

describe('built pw cards never print roof (review P1-2): feed only, saved, stage update; EN and ES', () => {
  const build = (r: (typeof ROOF_CARDS)[number] | typeof ROOF, status: string | null, extra: Record<string, unknown> = {}) => {
    const sig = { source: r.source, kind: 'permit', subtype: 'permit', title: r.title, summary: r.summary, ...extra };
    const label = keptMatchLabel(labelForMember({ ...sig, categories: r.categories }, PW), status);
    const trade = tradeForRecord(sig, r.categories, PW);
    const input = { ...sig, label, trade, url: 'https://example.test/r', occurredAt: '2026-11-20T00:00:00Z' };
    return { label, trade, en: cardBrief(input).why, es: cardBriefLang(input, 'es').why };
  };
  it('the eight real feed-only rows, 2772 included', () => {
    on();
    expect(ROOF_CARDS.map((r) => r.id)).toContain(2772);
    const shown: number[] = [];
    for (const r of ROOF_CARDS) {
      // not saved: a feed card with a pw line, or not in the feed at all (context); saved: still a pw line
      for (const status of [null, 'saved']) {
        const c = build(r, status);
        expect(c.trade, String(r.id)).toBe(PW_TRADE);
        expect(['market_insight', 'context'], String(r.id)).toContain(c.label);
        if (c.label === 'context') continue;
        if (status === null) shown.push(r.id);
        expect(c.en, String(r.id)).not.toMatch(/roof/i);
        expect(c.es, String(r.id)).not.toMatch(/techo/i);
        expect(Object.values(PW_WHY_MORE), String(r.id)).toContain(c.en);
      }
    }
    // 2772 and 2784 (roof, HVAC, siding, flooring; $1.5M and $445k) stay feed only under the pw siding kind
    expect(shown).toEqual(expect.arrayContaining([2772, 2784]));
  });
  it('a saved roof card and a stage-update card', () => {
    on();
    const saved = build(ROOF, 'saved');
    expect(saved.label).toBe('market_insight');
    expect(saved.trade).toBe(PW_TRADE);
    expect(saved.en).toBe(PW_WHY_MORE['brief.pw.other']);
    expect(saved.es).toBe((es as Record<string, string>)['brief.pw.other']);
    const stage = build({ ...ROOF_CARDS[4], title: 'New home permit in Raleigh', summary: 'Building | New Residential Dwelling | $246,422 job value | 5611 Farley Dr', source: 'arcgis-raleigh-permits' }, null, { permitStage: 'final_inspection' });
    expect(stage.label).toBe('coming_soon');
    expect(stage.en).toBe(PW_WHY['new-home']);
    expect(stage.es).toBe((es as Record<string, string>)['brief.pw.new-home']);
  });
});

describe('the pw card reason line (EN and ES)', () => {
  it('names the pw work, never a roof, within the length limits and the wording rules', () => {
    on();
    expect(tradeForRecord(FENCE, FENCE.categories, PW)).toBe(PW_TRADE);
    const all: [string, string][] = [...Object.entries(PW_WHY).map(([k, v]) => [`brief.pw.${k}`, v] as [string, string]), ...Object.entries(PW_WHY_MORE)];
    for (const [key, text] of all) {
      expect(text.length, key).toBeLessThanOrEqual(MAX_WHY);
      expect(text, key).not.toMatch(/\broof/i);
      expect(text, key).not.toMatch(/\bpays?\b/i);
      for (const b of BANNED) expect(text, key).not.toMatch(b);
      expect((en as Record<string, string>)[key], key).toBe(text);
      const sp = (es as Record<string, string>)[key];
      expect(sp, key).toBeTruthy();
      expect(sp.length, key).toBeLessThanOrEqual(MAX_WHY_BY_LANG.es);
      expect(sp, key).not.toMatch(/techo|—|–|paga/i);
    }
    const cases: [typeof FENCE | typeof GRAFFITI, 'coming_soon' | 'act_now', string][] = [
      [FENCE, 'coming_soon', 'fence'],
      [ROOF_PORCH, 'coming_soon', 'deck'],
      [GRAFFITI, 'coming_soon', 'graffiti'],
      [STORE, 'coming_soon', 'storefront'],
    ];
    for (const [r, label, kind] of cases) {
      const input = { ...r, label, trade: PW_TRADE };
      expect(briefFor(input).why, kind).toBe(PW_WHY[kind as keyof typeof PW_WHY]);
      expect(briefForLang(input, 'es').why, kind).toBe((es as Record<string, string>)[`brief.pw.${kind}`]);
      expect(briefForLang(input, 'en').why, kind).toBe(PW_WHY[kind as keyof typeof PW_WHY]);
    }
    expect(briefFor({ ...WIND, label: 'market_insight', trade: PW_TRADE }).why).toBe(PW_WHY['storm-debris']);
    expect(briefFor({ ...NEW_HOME, label: 'market_insight', trade: PW_TRADE }).why).toBe(PW_WHY_MORE['brief.pw.feed.new-home']);
    expect(en['brief.work.pressure-washing']).toBe('pressure washing work');
    expect(es['brief.work.pressure-washing']).toBe('trabajo de lavado a presión');
  });
  it('the sign-up hint has an EN and ES twin that no longer says roof permits', () => {
    for (const d of [en, es] as Record<string, string>[]) {
      const hint = d['pf.trade.pressure_washing_hint_pw'];
      expect(hint).toBeTruthy();
      for (const b of BANNED) expect(hint).not.toMatch(b);
    }
    expect(en['pf.trade.pressure_washing_hint_pw']).toMatch(/Roof-only permits are out/);
    expect(readFileSync('components/profile-form.tsx', 'utf8')).toContain("'pf.trade.pressure_washing_hint_pw'");
  });
});

describe('the sign-up form (UI states, EN and ES)', () => {
  const cats = [
    { id: 'siding-gutters', label: 'Siding and gutters', group: 'marketed' },
    { id: 'cleaning', label: 'House cleaning', group: 'marketed' },
    { id: PRESSURE_WASHING_ID, label: 'Pressure washing', group: 'marketed' },
  ];
  const render = (lang: 'en' | 'es') =>
    renderToStaticMarkup(
      createElement(ProfileForm, {
        action: async () => ({}),
        categories: cats,
        defaults: { business_name: 'A', categories: PW, zip: '30303', radius: 25, alert_email: true },
        submitLabel: 'Save',
        tier: 'starter',
        lang,
      } as never),
    );
  it('switch off: the old hint; switch on: the hint that names the pw work and drops roof permits', () => {
    expect(render('en')).toContain('in new-home and roof permits.');
    expect(render('es')).toContain(es['pf.trade.pressure_washing_hint']);
    on();
    const html = render('en');
    expect(html).toContain(en['pf.trade.pressure_washing_hint_pw']);
    expect(html).not.toContain('roof permits.');
    expect(render('es')).toContain(es['pf.trade.pressure_washing_hint_pw']);
  });
});


describe('the pw history read (lib/signals/pw-history.ts)', () => {
  const prof: MatchProfile = { user_id: 'pw1', categories: PW, lat: 37.7, lon: -122.4, state: 'CA', radius_mi: 25 };
  it('switch off or no pw member: no query at all', async () => {
    const db = { from: () => { throw new Error('must not read'); } } as never;
    expect((await loadPwHistory(db, [prof], new Date())).unknown.size).toBe(0);
    on();
    expect((await loadPwHistory(db, [{ ...prof, categories: ['cleaning'] }], new Date())).unknown.size).toBe(0);
  });
  it('a failed read marks the member unknown, so every graffiti alert is held', async () => {
    on();
    const db = { from: () => { throw new Error('down'); } } as never;
    const h = await loadPwHistory(db, [prof], new Date());
    expect([...h.unknown]).toEqual(['pw1']);
    const g = { id: 1, categories: GRAFFITI.categories, lat: 37.7, lon: -122.4, state: 'CA', severity: 1, occurred_at: '2026-11-20T10:00:00Z', subtype: '311', source: GRAFFITI.source, title: GRAFFITI.title, summary: GRAFFITI.summary, kind: 'civic' };
    const rows = matchSignals([g], [prof], undefined, new Date('2026-11-20T18:00:00Z'), false, h);
    expect(rows).toEqual([expect.objectContaining({ signal_id: 1, alert_hold: 'held' })]);
  });
});
