/**
 * Round 17, unit ES: the one dictionary (lib/i18n). A test fails if any Spanish key is missing, any Spanish value is empty, a
 * {placeholder} differs from the English one, or a Spanish value breaks a wording rule (lib/i18n/rules.ts).
 */
import { describe, expect, it } from 'vitest';
import { dictionary, fill, hasKey, isLang, langOfProfile, localizeDate, parseLang, t, tOpt } from '@/lib/i18n';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';
import { spanishProblems } from '@/lib/i18n/rules';
import { CATEGORIES, CATEGORY_GROUPS } from '@/lib/signals/categories';

const keys = (o: object) => Object.keys(o).sort();
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('dictionary: same keys, no empty Spanish value', () => {
  it('every English key has a Spanish key and the reverse', () => {
    const missing = keys(en).filter((k) => !(k in es));
    const extra = keys(es).filter((k) => !(k in en));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });
  it('no Spanish value is empty or only spaces', () => {
    const empty = Object.entries(es).filter(([, v]) => typeof v !== 'string' || v.trim() === '').map(([k]) => k);
    expect(empty).toEqual([]);
  });
  it('no English value is empty either', () => {
    expect(Object.entries(en).filter(([, v]) => typeof v !== 'string' || v.trim() === '').map(([k]) => k)).toEqual([]);
  });
  it('each Spanish value has exactly the {placeholders} of the English one', () => {
    const bad = keys(en).filter((k) => JSON.stringify(placeholders(en[k as keyof typeof en])) !== JSON.stringify(placeholders(es[k as keyof typeof es] ?? '')));
    expect(bad).toEqual([]);
  });
  it('dictionary(lang) returns the two tables', () => {
    expect(dictionary('en')).toBe(en);
    expect(dictionary('es')).toBe(es);
  });
});

describe('dictionary: Spanish is Spanish, and the brand stays', () => {
  // A value left in English would pass the checks above. Only brand words, acronyms and the like may be identical.
  const SAME_OK = /^(?:[A-Z0-9 ()/&.,:{}'-]|\{\w+\})+$|^(?:Holler|English|Español|311|ZIP|HVAC|Solo|Pro|No)$/;
  it('almost every Spanish value differs from its English one (the identical ones are brand words, acronyms or templates of placeholders)', () => {
    const same = keys(en).filter((k) => en[k as keyof typeof en] === es[k as keyof typeof es] && !SAME_OK.test(en[k as keyof typeof en]));
    expect(same).toEqual([]);
  });
  it('the word Holler stays in every Spanish value whose English value names it', () => {
    const lost = keys(en).filter((k) => /\bHoller\b/.test(en[k as keyof typeof en]) && !/\bHoller\b/.test(es[k as keyof typeof es]));
    expect(lost).toEqual([]);
  });
  it('the Spanish values use usted: no tuteo forms', () => {
    const bad = Object.entries(es).filter(([, v]) => spanishProblems(v, { allowDamageWords: true }).includes('tuteo')).map(([k]) => k);
    expect(bad).toEqual([]);
  });
});

describe('dictionary: Spanish wording rules (the banned-words approach, in Spanish)', () => {
  // brief.damage.* are word fragments ("árboles caídos", "daños") that the brief only ever puts inside a sentence which also says "no confirmado".
  const isFragment = (k: string) => k.startsWith('brief.damage.');
  it('no garantizado, cliente potencial, leads, registro oficial, they-need-you, you-will-win, em dash', () => {
    const hits = Object.entries(es).flatMap(([k, v]) => spanishProblems(v, { allowDamageWords: isFragment(k) }).map((p) => `${k}: ${p}`));
    expect(hits).toEqual([]);
  });
  it('a damage word appears only next to "no confirmado" (weather never claims damage)', () => {
    const hits = Object.entries(es).filter(([k, v]) => !isFragment(k) && /\bda(ñ|n)(o|os|ado|ada)\b/i.test(v) && !/no confirmad/i.test(v)).map(([k]) => k);
    expect(hits).toEqual([]);
  });
  it('the unknown-damage phrases say "daño no confirmado"', () => {
    for (const k of Object.keys(es).filter((x) => x.startsWith('brief.unknown.'))) {
      if (/\bda(ñ|n)o/i.test(es[k as keyof typeof es])) expect(es[k as keyof typeof es]).toMatch(/daño no confirmado/);
    }
    expect(es['brief.unknown.weather-alert']).toBe('daño no confirmado');
    expect(es['brief.unknown.storm-report']).toBe('daño no confirmado');
  });
  it('links and sources say "fuente pública"', () => {
    const joined = Object.values(es).join('\n');
    expect(joined).toMatch(/fuente pública/);
    expect(joined).not.toMatch(/registros? oficial|fuentes? oficial/i);
  });
  it('the rule checker catches each bad word', () => {
    expect(spanishProblems('Oportunidad garantizada')).toContain('garantizado');
    expect(spanishProblems('Un cliente potencial nuevo')).toContain('cliente-potencial');
    expect(spanishProblems('Clientes potenciales cerca')).toContain('cliente-potencial');
    expect(spanishProblems('Nuevos leads hoy')).toContain('lead');
    expect(spanishProblems('Es un registro oficial')).toContain('registro-oficial');
    expect(spanishProblems('Ellos le necesitan')).toContain('they-need-you');
    expect(spanishProblems('Usted ganará el trabajo')).toContain('you-will-win');
    expect(spanishProblems('Hola — adiós')).toContain('em-dash');
    expect(spanishProblems('Hubo daño en el techo')).toContain('damage-without-not-confirmed');
    expect(spanishProblems('Daño no confirmado en el techo')).toEqual([]);
    expect(spanishProblems('Usted puede ver la fuente pública.')).toEqual([]);
    expect(spanishProblems('Tú puedes llamar')).toContain('tuteo');
  });
});

describe('dictionary: trades and groups', () => {
  it('every trade id has an English and a Spanish label, and the English label is the one in CATEGORIES', () => {
    for (const c of CATEGORIES) {
      const key = `trade.${c.id}`;
      expect(hasKey(key), key).toBe(true);
      expect(en[key as keyof typeof en], key).toBe(c.label);
      expect(es[key as keyof typeof es], key).toBeTruthy();
    }
  });
  it('no trade key without a trade', () => {
    const ids = new Set(CATEGORIES.map((c) => c.id as string));
    const orphans = Object.keys(en).filter((k) => k.startsWith('trade.') && !ids.has(k.slice(6)));
    expect(orphans).toEqual([]);
  });
  it('every group id has a label in both languages, equal to the English group label', () => {
    for (const g of CATEGORY_GROUPS) {
      const key = `group.${g.id}`;
      expect(en[key as keyof typeof en], key).toBe(g.label);
      expect(es[key as keyof typeof es], key).toBeTruthy();
    }
  });
});

describe('i18n helpers', () => {
  it('parseLang: only exactly "es" is Spanish', () => {
    expect(parseLang('es')).toBe('es');
    for (const v of ['en', 'ES', 'es-US', '', null, undefined, 3, {}]) expect(parseLang(v)).toBe('en');
    expect(isLang('es')).toBe(true);
    expect(isLang('fr')).toBe(false);
  });
  it('langOfProfile: a profile without the language key (migration 0024 not applied) is English', () => {
    expect(langOfProfile({})).toBe('en');
    expect(langOfProfile(null)).toBe('en');
    expect(langOfProfile({ language: 'es' })).toBe('es');
    expect(langOfProfile({ language: 'xx' })).toBe('en');
  });
  it('fill leaves an unknown placeholder visible and never throws', () => {
    expect(fill('Hola {name}', { name: 'Ana' })).toBe('Hola Ana');
    expect(fill('Hola {name}', {})).toBe('Hola {name}');
    expect(t('es', 'zip.button')).toBe(es['zip.button']);
    expect(tOpt('es', 'no.such.key')).toBeNull();
  });
  it('localizeDate: "Dec 5, 2026" is "5 dic 2026"; anything else is untouched', () => {
    expect(localizeDate('Dec 5, 2026', 'es')).toBe('5 dic 2026');
    expect(localizeDate('Dec 5', 'es')).toBe('5 dic');
    expect(localizeDate('Dec 5, 2026', 'en')).toBe('Dec 5, 2026');
    expect(localizeDate('sometime in December', 'es')).toBe('sometime in December');
    expect(localizeDate(null, 'es')).toBeNull();
  });
});
