/**
 * Round 33 (SAM): set-aside labels, early-notice labels and routing. The 18 codes come from the API page
 * https://open.gsa.gov/api/get-opportunities-public-api/ (typeOfSetAside table, checked 2026-11-25); their descriptions are the page's own words.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildAlerts, MATCH_SELECT, type MatchRow } from '@/lib/mobile/feed';
import { SAM_SELECT } from '@/lib/signals/sam-notice';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';
import { t } from '@/lib/i18n';
import { spanishProblems } from '@/lib/i18n/rules';
import { labelFor, NOT_YET_BID_RE } from '@/lib/signals/lead-rules';
import { intentLine, intentLineKey, EARLY_NOTICE_LINE } from '@/lib/signals/intent';
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

/** code, the API page's description, English words. */
const DOCUMENTED: [string, string, string][] = [
  ['SBA', 'Total Small Business Set-Aside (FAR 19.5)', 'Set aside for small businesses'],
  ['SBP', 'Partial Small Business Set-Aside (FAR 19.5)', 'Partly set aside for small businesses'],
  ['8A', '8(a) Set-Aside (FAR 19.8)', 'Set aside for 8(a) small businesses'],
  ['8AN', '8(a) Sole Source (FAR 19.8)', 'Sole source to one 8(a) business'],
  ['HZC', 'HUBZone Set-Aside (FAR 19.13)', 'Set aside for HUBZone small businesses'],
  ['HZS', 'HUBZone Sole Source (FAR 19.13)', 'Sole source to one HUBZone business'],
  ['SDVOSBC', 'Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside (FAR 19.14)', 'Set aside for service-disabled veteran-owned small businesses'],
  ['SDVOSBS', 'Service-Disabled Veteran-Owned Small Business (SDVOSB) Sole Source (FAR 19.14)', 'Sole source to one service-disabled veteran-owned small business'],
  ['WOSB', 'Women-Owned Small Business (WOSB) Program Set-Aside (FAR 19.15)', 'Set aside for women-owned small businesses'],
  ['WOSBSS', 'Women-Owned Small Business (WOSB) Program Sole Source (FAR 19.15)', 'Sole source to one women-owned small business'],
  ['EDWOSB', 'Economically Disadvantaged WOSB (EDWOSB) Program Set-Aside (FAR 19.15)', 'Set aside for economically disadvantaged women-owned small businesses'],
  ['EDWOSBSS', 'Economically Disadvantaged WOSB (EDWOSB) Program Sole Source (FAR 19.15)', 'Sole source to one economically disadvantaged women-owned small business'],
  ['LAS', 'Local Area Set-Aside (FAR 26.2)', 'Set aside for local area businesses'],
  ['IEE', 'Indian Economic Enterprise (IEE) Set-Aside (specific to Department of Interior)', 'Set aside for Indian economic enterprises (Department of the Interior)'],
  ['ISBEE', 'Indian Small Business Economic Enterprise (ISBEE) Set-Aside (specific to Department of Interior)', 'Set aside for Indian small business economic enterprises (Department of the Interior)'],
  ['BICiv', 'Buy Indian Set-Aside (Specific to Indian Health Services)', 'Buy Indian set-aside (Indian Health Service)'],
  ['VSA', 'Veteran-Owned Small Business Set-Aside (specific to Department of Veterans Affairs)', 'Set aside for veteran-owned small businesses (Department of Veterans Affairs)'],
  ['VSS', 'Veteran-Owned Small Business Sole source (specific to Department of Veterans Affairs)', 'Sole source to one veteran-owned small business (Department of Veterans Affairs)'],
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
      expect(NOT_YET_BID_RE.test(type)).toBe(true);
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
    expect(all.length).toBe(3 + 19);
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
    expect(intentLine(early)).toBe(EARLY_NOTICE_LINE);
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
    expect(r.data).toMatchObject({ setAside: 'SBA', setAsideDescription: 'Total Small Business Set-Aside (FAR 19.5)', type: 'Combined Synopsis/Solicitation' });
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
    const d = r.data as { setAside?: string; setAsideDescription?: string | null };
    expect(samCardLine({ source: r.source, summary: r.summary, setAside: d.setAside, setAsideDescription: d.setAsideDescription }, 'es')).toBe('Reservado para pequeñas empresas de mujeres.');
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
    expect(SAM_SELECT).toBe('samSetAside:data->>setAside,samSetAsideDesc:data->>setAsideDescription');
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
    expect(a.intent.line).toBe(EARLY_NOTICE_LINE);
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
