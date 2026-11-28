/**
 * Round 35: the pressure-washing rule set (lib/signals/lead-rules.ts pwRuleOf) behind HOLLER_PW_RULES_ENABLED. Off (the default), a member
 * with House cleaning AND Siding and gutters gets exactly what those two trades got before. On, roof-only permits are left out and the
 * member gets exterior work (painting, siding, deck, fence, concrete), titled tenant fit-outs, finished new homes, storefront licences and
 * private graffiti, with a pw reason line in English and Spanish.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { labelFor, labelForMember, pwRuleOf, PW_MAX_VALUE, type LabelInput } from '@/lib/signals/lead-rules';
import { matchOne, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { briefFor, MAX_WHY, PW_WHY, tradeForRecord } from '@/lib/signals/brief';
import { briefForLang, MAX_WHY_BY_LANG } from '@/lib/signals/brief-i18n';
import { expandCategoriesForRouting, PW_READ_TAGS } from '@/lib/signals/permit-routing';
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
    for (const r of [ROOF, ROOF_PORCH, FENCE, PAINT, NEW_HOME, FIT_OUT, GRAFFITI, STORE, WIND, HAIL]) {
      // with the switch off, labelForMember is the best of the two trades' own labels on the trades the record carries
      const carried = labelForMember(r, PW);
      expect(labelForMember(r, [...PW, 'painting']) === carried || r === PAINT || r === GRAFFITI, String(r.title)).toBe(true);
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
    expect(pwRuleOf(BIG_CONCRETE).label).toBe('market_insight');
    expect(PW_MAX_VALUE).toBe(250_000);
    expect(pwRuleOf(SHED).label).toBe('context');
    expect(pwRuleOf(SITE_FENCE).label).toBe('context');
    expect(pwRuleOf(NEW_HOME)).toEqual({ label: 'market_insight', kind: 'new-home' });
    expect(pwRuleOf({ ...NEW_HOME, permitStage: 'final_inspection' })).toEqual({ label: 'coming_soon', kind: 'new-home' });
    expect(pwRuleOf(FIT_OUT)).toEqual({ label: 'coming_soon', kind: 'fit-out' });
    expect(pwRuleOf(GRAFFITI)).toEqual({ label: 'act_now', kind: 'graffiti' });
    expect(pwRuleOf(PUBLIC_GRAFFITI).label).toBe('context');
    expect(pwRuleOf(STORE)).toEqual({ label: 'coming_soon', kind: 'storefront' });
    expect(pwRuleOf(WIND)).toEqual({ label: 'market_insight', kind: 'storm-debris' });
    expect(pwRuleOf(HAIL).label).toBe('context');
    expect(pwRuleOf({ source: 'socrata-chicago-violations', kind: 'civic', subtype: 'violation', title: 'Code violation in Chicago: CLEAN MILDEW FROM EXTERIOR WALL' })).toEqual({ label: 'act_now', kind: 'exterior-order' });
    expect(pwRuleOf({ source: 'socrata-chicago-violations', kind: 'civic', subtype: 'violation', title: 'Code violation in Chicago: REPAIR EXTERIOR WALL' }).label).toBe('context');
  });
  it('labelForMember: roof-only is left out, the other trades of the member keep their own label', () => {
    on();
    expect(labelForMember(ROOF, PW)).toBe('context');
    expect(labelForMember(FENCE, PW)).toBe('coming_soon');
    // a pw member who also holds roofing keeps the roofer's own market insight on a roof permit
    expect(labelForMember(ROOF, [...PW, 'roofing'])).toBe('market_insight');
    // a member with one of the two trades is not a pw member
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
    // a cleaning-only member is unchanged
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

describe('the pw card reason line (EN and ES)', () => {
  it('names the pw work, never a roof, within the length limits and the wording rules', () => {
    on();
    expect(tradeForRecord(FENCE, FENCE.categories, PW)).toBe(PW_TRADE);
    for (const [kind, text] of Object.entries(PW_WHY)) {
      expect(text.length, kind).toBeLessThanOrEqual(MAX_WHY);
      expect(text, kind).not.toMatch(/\broof/i);
      for (const b of BANNED) expect(text, kind).not.toMatch(b);
      expect((en as Record<string, string>)[`brief.pw.${kind}`]).toBe(text);
      const sp = (es as Record<string, string>)[`brief.pw.${kind}`];
      expect(sp, kind).toBeTruthy();
      expect(sp.length, kind).toBeLessThanOrEqual(MAX_WHY_BY_LANG.es);
      expect(sp, kind).not.toMatch(/techo|—|–/i);
    }
    const cases: [typeof FENCE | typeof GRAFFITI, 'coming_soon' | 'act_now', string][] = [
      [FENCE, 'coming_soon', 'fence'],
      [ROOF_PORCH, 'coming_soon', 'deck'],
      [FIT_OUT, 'coming_soon', 'fit-out'],
      [GRAFFITI, 'act_now', 'graffiti'],
      [STORE, 'coming_soon', 'storefront'],
    ];
    for (const [r, label, kind] of cases) {
      const input = { ...r, label, trade: PW_TRADE };
      expect(briefFor(input).why, kind).toBe(PW_WHY[kind as keyof typeof PW_WHY]);
      expect(briefForLang(input, 'es').why, kind).toBe((es as Record<string, string>)[`brief.pw.${kind}`]);
      expect(briefForLang(input, 'en').why, kind).toBe(PW_WHY[kind as keyof typeof PW_WHY]);
    }
    // the storm debris feed card says only that a report was filed
    expect(briefFor({ ...WIND, label: 'market_insight', trade: PW_TRADE }).why).toBe(PW_WHY['storm-debris']);
    // a feed-only new home keeps the generic sentence: it never says the home reached its final stage
    expect(briefFor({ ...NEW_HOME, label: 'market_insight', trade: PW_TRADE }).why).not.toBe(PW_WHY['new-home']);
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

