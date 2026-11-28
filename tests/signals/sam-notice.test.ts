/**
 * Round 33 (SAM): set-aside labels, early-notice labels and routing. The 18 codes come from the API page
 * https://open.gsa.gov/api/get-opportunities-public-api/ (typeOfSetAside table, checked 2026-11-25); their descriptions are the page's own words.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildAlerts, MATCH_SELECT, type MatchRow } from '@/lib/mobile/feed';
import { SAM_SELECT } from '@/lib/signals/sam-notice';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';
import { t } from '@/lib/i18n';
import { spanishProblems } from '@/lib/i18n/rules';
import { labelFor, NOT_YET_BID_RE } from '@/lib/signals/lead-rules';
import { intentLine, intentLineKey } from '@/lib/signals/intent';
import {
  SAM_SET_ASIDE_CODES,
  earlyNoticeLine,
  isEarlyNoticeType,
  samCardLine,
  samNoticeKind,
  samTypeOf,
  setAsideCodeFromDescription,
  setAsideCodeOf,
  setAsideKey,
  setAsideLabel,
  storedSetAside,
} from '@/lib/signals/sam-notice';
import { parseSam } from '@/lib/signals/adapters/sam';

vi.mock('server-only', () => ({}));

// The labels are behind HOLLER_SAM_LABELS_ENABLED; this file tests them ON. tests/signals/sam-labels-switch.test.ts tests them OFF.
beforeAll(() => {
  vi.stubEnv('HOLLER_SAM_LABELS_ENABLED', '1');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

/** code, the API page's description, English words. */
const DOCUMENTED: [string, string, string][] = [
  ['SBA', 'Total Small Business Set-Aside (FAR 19.5)', 'Set aside for small businesses'],
  ['SBP', 'Partial Small Business Set-Aside (FAR 19.5)', 'Partly set aside for small businesses'],
  ['8A', '8(a) Set-Aside (FAR 19.8)', 'Set aside for 8(a) small businesses'],
  ['8AN', '8(a) Sole Source (FAR 19.8)', 'Planned sole source to one 8(a) business. Not open for offers'],
  ['HZC', 'HUBZone Set-Aside (FAR 19.13)', 'Set aside for HUBZone small businesses'],
  ['HZS', 'HUBZone Sole Source (FAR 19.13)', 'Planned sole source to one HUBZone business. Not open for offers'],
  ['SDVOSBC', 'Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside (FAR 19.14)', 'Set aside for service-disabled veteran-owned small businesses'],
  ['SDVOSBS', 'Service-Disabled Veteran-Owned Small Business (SDVOSB) Sole Source (FAR 19.14)', 'Planned sole source to one service-disabled veteran-owned small business. Not open for offers'],
  ['WOSB', 'Women-Owned Small Business (WOSB) Program Set-Aside (FAR 19.15)', 'Set aside for women-owned small businesses'],
  ['WOSBSS', 'Women-Owned Small Business (WOSB) Program Sole Source (FAR 19.15)', 'Planned sole source to one women-owned small business. Not open for offers'],
  ['EDWOSB', 'Economically Disadvantaged WOSB (EDWOSB) Program Set-Aside (FAR 19.15)', 'Set aside for economically disadvantaged women-owned small businesses'],
  ['EDWOSBSS', 'Economically Disadvantaged WOSB (EDWOSB) Program Sole Source (FAR 19.15)', 'Planned sole source to one economically disadvantaged women-owned small business. Not open for offers'],
  ['LAS', 'Local Area Set-Aside (FAR 26.2)', 'Set aside for businesses in a declared disaster or emergency area'],
  ['IEE', 'Indian Economic Enterprise (IEE) Set-Aside (specific to Department of Interior)', 'Set aside for Indian economic enterprises (Department of the Interior)'],
  ['ISBEE', 'Indian Small Business Economic Enterprise (ISBEE) Set-Aside (specific to Department of Interior)', 'Set aside for Indian small business economic enterprises (Department of the Interior)'],
  ['BICiv', 'Buy Indian Set-Aside (Specific to Indian Health Services)', 'Buy Indian set-aside (Indian Health Service)'],
  ['VSA', 'Veteran-Owned Small Business Set-Aside (specific to Department of Veterans Affairs)', 'Set aside for veteran-owned small businesses (Department of Veterans Affairs)'],
  ['VSS', 'Veteran-Owned Small Business Sole source (specific to Department of Veterans Affairs)', 'Planned sole source to one veteran-owned small business (Department of Veterans Affairs). Not open for offers'],
];

describe('set-aside codes', () => {
  it('the table has exactly the 18 documented codes, in the module and in the test', () => {
    expect([...SAM_SET_ASIDE_CODES].sort()).toEqual(DOCUMENTED.map((d) => d[0]).sort());
    expect(SAM_SET_ASIDE_CODES).toHaveLength(18);
  });
  for (const [code, desc, words] of DOCUMENTED) {
    it(`${code}: the code, its lower-case spelling and its description all give "${words}"`, () => {
      expect(setAsideCodeOf(code)).toBe(code);
      expect(setAsideCodeOf(code.toLowerCase())).toBe(code);
      expect(setAsideCodeFromDescription(desc)).toBe(code);
      expect(setAsideLabel(code, null, 'en')).toBe(words);
      expect(setAsideLabel(code.toLowerCase(), null, 'en')).toBe(words);
      expect(setAsideLabel(null, desc, 'en')).toBe(words);
      expect(storedSetAside(code, desc)).toBe(code);
      // the stored row keeps the code only, and the code alone labels it
      expect(setAsideLabel(storedSetAside(code, desc), null, 'en')).toBe(words);
    });
    it(`${code}: has an English and a Spanish dictionary entry, the Spanish one is real Spanish and passes the wording rules`, () => {
      const key = setAsideKey(code, null)!;
      expect(key).toBe(`sam.setaside.${code.toLowerCase()}`);
      const e = en[key];
      const s = es[key];
      expect(e).toBeTruthy();
      expect(s).toBeTruthy();
      expect(s).not.toBe(e);
      expect(spanishProblems(s)).toEqual([]);
      expect(setAsideLabel(code, null, 'es')).toBe(s);
    });
  }
  it('every sam.setaside key in the dictionary belongs to a documented code, or is the generic "other" one', () => {
    const keys = Object.keys(en).filter((k) => k.startsWith('sam.setaside.'));
    expect(keys.sort()).toEqual([...SAM_SET_ASIDE_CODES.map((c) => `sam.setaside.${c.toLowerCase()}`), 'sam.setaside.other'].sort());
  });
  it('no set-aside gives no label (none, empty, null, "N/A")', () => {
    for (const v of [null, undefined, '', ' ', 'none', 'None', 'N/A', 'null']) {
      expect(setAsideKey(v, v)).toBeNull();
      expect(setAsideLabel(v, v, 'en')).toBeNull();
      expect(storedSetAside(v, v)).toBeNull();
    }
  });
  it('an undocumented code still gets a plain, honest line instead of vanishing', () => {
    expect(storedSetAside('xyz', '')).toBe('XYZ');
    expect(setAsideLabel('XYZ', '', 'en')).toBe(en['sam.setaside.other']);
    expect(setAsideLabel('XYZ', '', 'es')).toBe(es['sam.setaside.other']);
    expect(storedSetAside('', 'Some Brand New Program Set-Aside')).toBe('OTHER');
  });
  it('a stored code that is gone but whose description is kept still labels', () => {
    expect(setAsideLabel('', 'Total Small Business Set-Aside (FAR 19.5)', 'en')).toBe('Set aside for small businesses');
  });
});

describe('early notices', () => {
  const EARLY: [string, string][] = [
    ['Sources Sought', 'sources-sought'],
    ['sources sought', 'sources-sought'],
    ['Presolicitation', 'presolicitation'],
    ['Pre-solicitation', 'presolicitation'],
    ['Intent to Bundle Requirements (DoD-Funded)', 'bundle'],
  ];
  for (const [type, kind] of EARLY) {
    it(`"${type}" is an early notice (${kind}) in both languages, and routing agrees`, () => {
      expect(samNoticeKind(type)).toBe(kind);
      expect(isEarlyNoticeType(type)).toBe(true);
      // routing: the original regex covers every spelling but the hyphenated one, which the labels switch adds (tested below)
      if (!/-/.test(type)) expect(NOT_YET_BID_RE.test(type)).toBe(true);
      expect(earlyNoticeLine(type, 'en')).toMatch(/^Early notice: /);
      expect(earlyNoticeLine(type, 'es')).toMatch(/^Aviso anticipado: /);
    });
  }
  for (const type of ['Solicitation', 'Combined Synopsis/Solicitation', 'combined synopsis/solicitation']) {
    it(`"${type}" is an actual bid: no early-notice line, and routing does not treat it as one`, () => {
      expect(samNoticeKind(type)).toBe('bid');
      expect(isEarlyNoticeType(type)).toBe(false);
      expect(NOT_YET_BID_RE.test(type)).toBe(false);
      expect(earlyNoticeLine(type, 'en')).toBeNull();
    });
  }
  it('the sources-sought wording is the asked-for one', () => {
    expect(earlyNoticeLine('Sources Sought', 'en')).toBe('Early notice: the agency is asking who could do this work. Not open for offers yet.');
  });
  it('the type is the summary first part unless the caller has data.type', () => {
    expect(samTypeOf('Sources Sought | GSA | NAICS 561720')).toBe('Sources Sought');
    expect(samTypeOf('Solicitation | GSA', 'Presolicitation')).toBe('Presolicitation');
    expect(samTypeOf(null)).toBe('');
  });
});

describe('the card line', () => {
  it('is only for sam-gov rows', () => {
    expect(samCardLine({ source: 'usaspending', summary: 'Sources Sought | x', setAside: 'SBA' }, 'en')).toBeNull();
    expect(samCardLine({ source: 'bids-la', summary: 'x', setAside: 'SBA' }, 'en')).toBeNull();
    expect(samCardLine({ source: null }, 'en')).toBeNull();
  });
  it('a plain bid with no set-aside has no line at all', () => {
    expect(samCardLine({ source: 'sam-gov', summary: 'Solicitation | GSA | NAICS 561720' }, 'en')).toBeNull();
  });
  it('a small-business bid says so, EN and ES', () => {
    expect(samCardLine({ source: 'sam-gov', summary: 'Combined Synopsis/Solicitation | ARMY', setAside: 'SBA' }, 'en')).toBe('Set aside for small businesses.');
    expect(samCardLine({ source: 'sam-gov', summary: 'Combined Synopsis/Solicitation | ARMY', setAside: 'SBA' }, 'es')).toBe('Reservado para pequeñas empresas.');
  });
  it('an early notice with a set-aside carries both sentences, early notice first', () => {
    expect(samCardLine({ source: 'sam-gov', summary: 'Sources Sought | VA | NAICS 561730', setAside: 'SDVOSBC' }, 'en')).toBe(
      'Early notice: the agency is asking who could do this work. Not open for offers yet. Set aside for service-disabled veteran-owned small businesses.',
    );
  });
  it('an old stored row (no set-aside fields) still gets its early-notice line from the summary', () => {
    expect(samCardLine({ source: 'sam-gov', summary: 'Presolicitation | GSA | NAICS 238220' }, 'en')).toMatch(/^Early notice: the agency plans to ask for offers later/);
  });
  it('copy rules: no em dash, no banned words, no promise, in both languages, for every string the card can print', () => {
    const all = Object.entries(en).filter(([k]) => k.startsWith('sam.'));
    expect(all.length).toBe(3 + 19 + 3 + 9); // + the sole-source intent line, + round 35: two email openers, two subject words, the known phrase, the Spanish bid line, the sole chip, the sole unknown phrase, the notice closing line
    for (const [k, v] of all) {
      expect(v, k).not.toMatch(/—/);
      expect(v, k).not.toMatch(/\blead(s)?\b|guarantee|you will win|they need you|canvass|knock/i);
      const s = es[k as keyof typeof es];
      expect(spanishProblems(s), k).toEqual([]);
      expect(s, k).not.toMatch(/—/);
      expect(s, k).not.toMatch(/\bganar|oficial/i);
    }
  });
  it('Spanish early notices say "Aviso anticipado" and that offers are not yet asked for', () => {
    expect(t('es', 'sam.early.sources_sought')).toBe('Aviso anticipado: la agencia está preguntando quién podría hacer este trabajo. Todavía no se piden ofertas.');
  });
});

describe('routing: an early notice is a heads-up, never urgent', () => {
  const base = { source: 'sam-gov', kind: 'contract', title: 'Federal bid in Denver, CO: Janitorial services' } as const;
  const trades = ['janitorial-commercial', 'landscaping', 'general-contractor', 'plumbing', null] as const;
  for (const type of ['Sources Sought', 'Presolicitation', 'Pre-solicitation', 'Intent to Bundle Requirements (DoD-Funded)']) {
    it(`${type}: coming_soon for every trade, even with a deadline in two days`, () => {
      for (const trade of trades) {
        const sig = { ...base, summary: `${type} | GSA | NAICS 561720 | responses due 2026-11-27`, state: 'CO', lat: 39.7, lon: -104.9 };
        expect(labelFor(sig, trade)).toBe('coming_soon');
      }
    });
  }
  for (const type of ['Solicitation', 'Combined Synopsis/Solicitation']) {
    it(`${type}: the actual bid stays act_now`, () => {
      expect(labelFor({ ...base, summary: `${type} | GSA | NAICS 561720` }, 'janitorial-commercial')).toBe('act_now');
    });
  }
  it('the mobile intent line does not call an early notice "out for bid"', () => {
    const early = { kind: 'contract', source: 'sam-gov', subtype: null, summary: 'Sources Sought | GSA' };
    expect(intentLineKey(early)).toBe('open-bid'); // the key is unchanged: older app builds read it
    expect(intentLine(early)).toBe('This is an early notice. Nothing is open for offers yet.');
    expect(intentLine(early, 'es')).toBe('Este es un aviso anticipado. Todavía no se piden ofertas.');
    expect(intentLine({ ...early, summary: 'Solicitation | GSA' })).toBe('This work is out for bid. No contract has been awarded yet.');
    expect(intentLine({ kind: 'contract', source: 'sam-gov' })).toBe('This work is out for bid. No contract has been awarded yet.');
  });
});

describe('the adapter stores the set-aside in data (no column needed)', () => {
  const item = (extra: Record<string, unknown>) => ({
    opportunitiesData: [
      {
        noticeId: 'n1',
        title: 'Grounds maintenance',
        type: 'Combined Synopsis/Solicitation',
        naicsCode: '561730',
        postedDate: '2026-11-20',
        responseDeadLine: '2026-12-15',
        placeOfPerformance: { city: { name: 'Atlanta' }, state: { code: 'GA' } },
        ...extra,
      },
    ],
  });
  it('typeOfSetAside + typeOfSetAsideDescription (the docs examples)', () => {
    const [r] = parseSam(item({ typeOfSetAside: 'SBA', typeOfSetAsideDescription: 'Total Small Business Set-Aside (FAR 19.5)' }));
    expect(r.data).toMatchObject({ setAside: 'SBA', type: 'Combined Synopsis/Solicitation' });
    expect(r.data).not.toHaveProperty('setAsideDescription'); // only the code is kept
  });
  it('setAsideCode + setAside (the docs field table)', () => {
    const [r] = parseSam(item({ setAsideCode: '8A', setAside: '8(a) Set-Aside (FAR 19.8)' }));
    expect(r.data).toMatchObject({ setAside: '8A' });
  });
  it('a description with no code still stores the code it names', () => {
    const [r] = parseSam(item({ typeOfSetAside: null, typeOfSetAsideDescription: 'HUBZone Set-Aside (FAR 19.13)' }));
    expect(r.data).toMatchObject({ setAside: 'HZC' });
  });
  it('no set-aside: no key is written', () => {
    const [a] = parseSam(item({ typeOfSetAside: null, typeOfSetAsideDescription: null }));
    expect(a.data).not.toHaveProperty('setAside');
    const [b] = parseSam(item({}));
    expect(b.data).not.toHaveProperty('setAside');
  });
  it('the stored row labels end to end', () => {
    const [r] = parseSam(item({ typeOfSetAside: 'WOSB' }));
    const d = r.data as { setAside?: string };
    expect(samCardLine({ source: r.source, summary: r.summary, setAside: d.setAside }, 'es')).toBe('Reservado para pequeñas empresas de mujeres.');
  });
});

describe('the app feed card line (lib/mobile/feed.ts buildAlerts) and the selects', () => {
  const NOW = new Date('2026-11-25T15:00:00Z');
  const deps = { userId: 'u1', locked: false, db: {} as never, admin: null, siteUrl: 'https://localholler.com', now: NOW.getTime(), trades: ['landscaping'] };
  const sam = (id: number, summary: string, extra: Record<string, unknown> = {}) => ({
    id, source: 'sam-gov', kind: 'contract', subtype: null, title: 'Federal bid in Atlanta, GA: Grounds maintenance', summary,
    url: 'https://sam.gov/opp/x/view', city: 'Atlanta', state: 'GA', county: null, zip: null, lat: 33.749, lon: -84.388, severity: 2, categories: ['landscaping'],
    occurred_at: '2026-11-24T00:00:00.000Z', expires_at: '2026-12-15T12:00:00.000Z', ...extra,
  });
  const row = (id: number, signal: Record<string, unknown>): MatchRow => ({ id, status: 'new', distance_mi: 3, draft: null, created_at: '2026-11-25T14:00:00Z', signal }) as unknown as MatchRow;

  it('the feed selects ask for the two stored fields', () => {
    expect(MATCH_SELECT).toContain(SAM_SELECT);
    expect(SAM_SELECT).toBe('samSetAside:data->>setAside');
  });
  it('a small-business bid: the set-aside line, label act_now, no early-notice words', async () => {
    const [a] = await buildAlerts([row(1, sam(1, 'Combined Synopsis/Solicitation | ARMY | NAICS 561730', { samSetAside: 'SBA' }))], deps);
    expect(a.bidLine).toBe('Set aside for small businesses.');
    expect(a.label).toBe('act_now');
  });
  it('a sources-sought notice: the early-notice line, never act_now, and the intent line is not "out for bid"', async () => {
    const [a] = await buildAlerts([row(2, sam(2, 'Sources Sought | VA | NAICS 561730', { samSetAside: 'SDVOSBC' }))], { ...deps, lang: 'es' });
    expect(a.bidLine).toBe(
      'Aviso anticipado: la agencia está preguntando quién podría hacer este trabajo. Todavía no se piden ofertas. Reservado para pequeñas empresas de veteranos con discapacidad relacionada con el servicio.',
    );
    expect(a.label).toBe('coming_soon');
    expect(a.intent.line).toBe('Este es un aviso anticipado. Todavía no se piden ofertas.');
  });
  it('a row stored before this change (no set-aside keys) still builds, with no set-aside line', async () => {
    const [a] = await buildAlerts([row(3, sam(3, 'Solicitation | GSA | NAICS 561730'))], deps);
    expect(a.bidLine).toBeNull();
  });
  it('a locked member gets no line', async () => {
    const [a] = await buildAlerts([row(4, sam(4, 'Sources Sought | VA', { samSetAside: 'SBA' }))], { ...deps, locked: true });
    expect(a.bidLine).toBeNull();
  });
});

describe('review fixes: no set-aside, local area, sole source', () => {
  const NONE_PHRASES = ['NONE', 'None', 'No Set aside used', 'No Set-Aside Used', 'Full and Open Competition', 'Full & Open Competition', 'Unrestricted', 'Not Applicable', 'N/A', 'null'];
  for (const phrase of NONE_PHRASES) {
    it(`"${phrase}" as a code, as a description, or both renders no set-aside line`, () => {
      expect(storedSetAside(phrase, null)).toBeNull();
      expect(storedSetAside(null, phrase)).toBeNull();
      expect(storedSetAside('NONE', phrase)).toBeNull();
      expect(setAsideLabel(phrase, phrase, 'en')).toBeNull();
      expect(samCardLine({ source: 'sam-gov', summary: 'Solicitation | GSA', setAside: phrase, setAsideDescription: phrase }, 'en')).toBeNull();
    });
  }
  it('a description that does not say set-aside or sole source never becomes a restriction', () => {
    expect(storedSetAside(null, 'Open to all responsible sources')).toBeNull();
    expect(storedSetAside(null, 'Brand New Program Set-Aside')).toBe('OTHER');
  });
  it('the local area set-aside says what it is: a declared disaster or emergency area (FAR 26.2)', () => {
    expect(setAsideLabel('LAS', null, 'en')).toBe('Set aside for businesses in a declared disaster or emergency area');
    expect(setAsideLabel('LAS', null, 'es')).toBe('Reservado para empresas en un área de desastre o emergencia declarada');
  });
  const base = { source: 'sam-gov', kind: 'contract', title: 'Federal bid in Denver, CO: Janitorial services', summary: 'Solicitation | GSA | NAICS 561720', state: 'CO', lat: 39.7, lon: -104.9 };
  for (const code of ['8AN', 'HZS', 'SDVOSBS', 'WOSBSS', 'EDWOSBSS', 'VSS']) {
    it(`${code} (sole source) is a heads-up with "Not open for offers" wording, never act_now`, () => {
      expect(labelFor({ ...base, setAside: code }, 'janitorial-commercial')).toBe('coming_soon');
      expect(setAsideLabel(code, null, 'en')).toMatch(/Not open for offers$/);
      expect(setAsideLabel(code, null, 'es')).toMatch(/No está abierto a ofertas$/);
    });
  }
  for (const code of ['SBA', 'SBP', '8A', 'HZC', 'SDVOSBC', 'WOSB', 'EDWOSB', 'LAS', 'VSA', null]) {
    it(`${code} (a set-aside bid that is open) stays act_now`, () => {
      expect(labelFor({ ...base, ...(code ? { setAside: code } : {}) }, 'janitorial-commercial')).toBe('act_now');
    });
  }
  it('Pre-solicitation (hyphenated) is a heads-up, like Presolicitation', () => {
    expect(labelFor({ ...base, summary: 'Pre-solicitation | GSA' }, 'janitorial-commercial')).toBe('coming_soon');
  });
  // review 2: any spacing or hyphen between "pre" and "solicitation"
  for (const spelling of ['Pre solicitation', 'Pre-solicitation', 'Pre - solicitation', 'Pre  solicitation', 'pre-  solicitation', 'PRE SOLICITATION', 'Pre\tsolicitation', 'Presolicitation']) {
    it(`"${spelling}" is a heads-up, an early notice, and gets the early-notice line and intent line`, () => {
      const summary = `${spelling} | GSA | NAICS 561720 | responses due 2026-11-27`;
      expect(labelFor({ ...base, summary }, 'janitorial-commercial')).toBe('coming_soon');
      expect(samNoticeKind(summary)).toBe('presolicitation');
      expect(isEarlyNoticeType(samTypeOf(summary))).toBe(true);
      expect(samCardLine({ source: 'sam-gov', summary }, 'en')).toBe(earlyNoticeLine('presolicitation', 'en'));
      expect(intentLine({ source: 'sam-gov', summary, kind: 'contract', title: base.title, severity: 2, state: 'CO' } as never, 'en')).not.toMatch(/out for bid/i);
    });
  }
  it('"Pre solicitation" with the labels OFF is routed exactly as on main (the switch gates it)', () => {
    vi.stubEnv('HOLLER_SAM_LABELS_ENABLED', '');
    try {
      expect(labelFor({ ...base, summary: 'Pre solicitation | GSA' }, 'janitorial-commercial')).toBe('act_now');
      expect(labelFor({ ...base, summary: 'Pre-solicitation | GSA' }, 'janitorial-commercial')).toBe('act_now');
    } finally {
      vi.stubEnv('HOLLER_SAM_LABELS_ENABLED', '1');
    }
  });
});

describe('the app intent line on a sole-source card never says "out for bid" (review 2)', () => {
  const sig = (setAside: string | null, summary = 'Solicitation | GSA | NAICS 561720') =>
    ({ source: 'sam-gov', kind: 'contract', title: 'Federal bid in Denver, CO: Janitorial services', summary, severity: 2, state: 'CO', ...(setAside ? { setAside } : {}) }) as never;
  for (const code of ['8AN', 'HZS', 'SDVOSBS', 'WOSBSS', 'EDWOSBSS', 'VSS']) {
    it(`${code}: EN and ES say nothing is open for offers`, () => {
      expect(intentLine(sig(code), 'en')).toBe(t('en', 'sam.sole.intent_line'));
      expect(intentLine(sig(code), 'en')).not.toMatch(/out for bid/i);
      expect(intentLine(sig(code), 'es')).toBe(t('es', 'sam.sole.intent_line'));
      expect(intentLine(sig(code), 'es')).not.toMatch(/licitaci[oó]n abierta|a licitaci/i);
      expect(spanishProblems(t('es', 'sam.sole.intent_line'))).toEqual([]);
    });
  }
  it('an open set-aside bid and a plain bid keep the out-for-bid line', () => {
    for (const code of ['SBA', '8A', 'WOSB', 'LAS', null]) expect(intentLine(sig(code), 'en')).toMatch(/out for bid/i);
  });
  it('an early notice keeps its own line even when it also names a sole-source code', () => {
    expect(intentLine(sig('8AN', 'Sources Sought | VA'), 'en')).toBe(t('en', 'sam.early.intent_line'));
  });
  it('with the labels OFF the sole-source card has the old line', () => {
    vi.stubEnv('HOLLER_SAM_LABELS_ENABLED', '');
    try {
      expect(intentLine(sig('8AN'), 'en')).toMatch(/out for bid/i);
    } finally {
      vi.stubEnv('HOLLER_SAM_LABELS_ENABLED', '1');
    }
  });
  it('the app feed passes the stored set-aside to the intent line', async () => {
    const row = {
      id: 1, status: 'new', distance_mi: 3, draft: null, created_at: '2026-11-25T14:00:00Z',
      signal: { id: 1, source: 'sam-gov', kind: 'contract', subtype: null, title: 'Federal bid in Atlanta, GA: Grounds maintenance', summary: 'Solicitation | GSA | NAICS 561730',
        url: 'https://sam.gov/opp/x/view', city: 'Atlanta', state: 'GA', county: null, zip: null, lat: 33.749, lon: -84.388, severity: 2, categories: ['landscaping'],
        occurred_at: '2026-11-24T00:00:00.000Z', expires_at: '2026-12-15T12:00:00.000Z', samSetAside: '8AN' },
    } as unknown as MatchRow;
    const [a] = await buildAlerts([row], { userId: 'u1', locked: false, db: {} as never, admin: null, siteUrl: 'https://localholler.com', now: Date.parse('2026-11-25T15:00:00Z'), trades: ['landscaping'], lang: 'en' });
    expect(a.intent.line).toBe(t('en', 'sam.sole.intent_line'));
    expect(a.intent.line).not.toMatch(/out for bid/i);
  });
});
