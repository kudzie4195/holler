import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderWelcomeMatches, renderWelcomeQuiet, renderTrialEnding, renderTrialEnded, planLines, shortDate, plain, type AlertItem } from '@/lib/lifecycle/templates';
import { PRICES_CENTS, priceLabel } from '@/lib/stripe/plans';
import { PLAN_LIMITS } from '@/lib/plan/limits';
import { BASE, ITEMS, bannedHits, copyStats, hasEmDash, pyMetrics, samples } from './helpers';

vi.mock('server-only', () => ({}));

const ALL = Object.entries(samples());
const proseOf = (text: string) => text.replace(/https?:\S+/g, '');

describe('deslop metrics on every rendered email (text part and HTML part)', () => {
  for (const [name, m] of ALL) {
    it(`${name}: stdev/mean >= 0.55, >= 12% under 8 words, mean 12 to 22`, () => {
      const t = copyStats(proseOf(m.text));
      expect(t.cv, `text cv ${t.cv}`).toBeGreaterThanOrEqual(0.55);
      expect(t.shortShare, `text short ${t.shortShare}`).toBeGreaterThanOrEqual(0.12);
      expect(t.mean, `text mean ${t.mean}`).toBeGreaterThanOrEqual(12);
      expect(t.mean).toBeLessThanOrEqual(22);
      const h = pyMetrics(m.html);
      expect(h.burstiness, `html cv ${h.burstiness}`).toBeGreaterThanOrEqual(0.55);
      expect(h.pctUnder8, `html short ${h.pctUnder8}`).toBeGreaterThanOrEqual(12);
      expect(h.mean, `html mean ${h.mean}`).toBeGreaterThanOrEqual(12);
      expect(h.mean).toBeLessThanOrEqual(22);
    });
  }

  it('also holds with other real-shaped titles (short, long, odd punctuation)', () => {
    const mk = (title: string, kind = 'permit'): AlertItem => ({ title, kind, city: 'Roswell', state: 'GA', occurredAt: '2026-11-18T10:00:00Z', severity: 2, source: 'x', subtype: kind === 'permit' ? 'permit' : null });
    const sets: AlertItem[][] = [
      [mk('Re-roof permit issued'), mk('Tornado warning for Cobb County', 'alert'), mk('Hail report near Roswell', 'report'), mk('Roof tear-off permit, 2100 sq ft'), mk('Gutter and fascia permit')],
      [
        mk('Residential alteration: tear off and replace asphalt shingles, install new underlayment and ridge vent, 3200 sq ft'),
        mk('Severe thunderstorm warning in effect for Fulton, Cobb and DeKalb counties until 9:15 PM EST', 'alert'),
        mk('Commercial roof replacement and rooftop HVAC unit change-out at the Northpoint office park'),
      ],
    ];
    for (const items of sets) {
      for (const m of [
        renderWelcomeMatches({ businessName: 'Acme', feedUrl: `${BASE}/app`, plansUrl: `${BASE}/p`, unsubscribeUrl: `${BASE}/u`, total: items.length + 4, items }),
        renderTrialEnding({ businessName: 'Acme', feedUrl: `${BASE}/app`, plansUrl: `${BASE}/p`, unsubscribeUrl: `${BASE}/u`, items: items.slice(0, 3) }),
      ]) {
        const t = copyStats(proseOf(m.text));
        expect(t.cv).toBeGreaterThanOrEqual(0.55);
        expect(t.shortShare).toBeGreaterThanOrEqual(0.12);
        expect(t.mean).toBeGreaterThanOrEqual(12);
        expect(t.mean).toBeLessThanOrEqual(22);
      }
    }
  });
});

describe('copy rules', () => {
  const BAN = [/\bdelve\b/i, /\brobust\b/i, /\bseamless/i, /\belevate/i, /\bunlock/i, /\bempower/i, /\bjourney\b/i, /\blandscape\b/i, /\bleverage/i, /not only/i, /more than just/i, /it['’]s worth noting/i, /whether you['’]re/i];
  const PRESSURE = [/\blast chance\b/i, /\bhurry\b/i, /\bdon['’]t miss\b/i, /\bact now\b/i, /\blimited time\b/i, /\bexpires? (today|soon|tonight)\b/i, /\bonly \d+ (spots|left)\b/i, /\bdon['’]t wait\b/i, /\bfinal (notice|reminder)\b/i, /\burgent/i, /!/];
  for (const [name, m] of ALL) {
    it(`${name}: no dashes, no banned words, no pressure words, US spelling`, () => {
      for (const part of [m.subject, m.text, m.html]) {
        expect(hasEmDash(part)).toBe(false);
        expect(/–/.test(part)).toBe(false);
        expect(bannedHits(part)).toEqual([]);
        for (const re of BAN) expect(re.test(part), String(re)).toBe(false);
        for (const re of PRESSURE) expect(re.test(m.text), String(re)).toBe(false);
        expect(/cancelled|colour|neighbour|organis/i.test(part)).toBe(false);
      }
    });
  }

  it('titles from public records have em and en dashes replaced', () => {
    expect(plain('Roof — permit – new')).toBe('Roof - permit - new');
    const m = renderWelcomeMatches({ businessName: 'A — B', feedUrl: BASE, plansUrl: BASE, unsubscribeUrl: BASE, total: 1, items: [{ ...ITEMS[0], title: 'Hail — big – hail' }] });
    expect(hasEmDash(m.text + m.html)).toBe(false);
    expect(m.text).toContain('Hail - big - hail');
  });

  it('place names from public records have em and en dashes replaced too (review r4 repro)', () => {
    const e = renderTrialEnding({ businessName: 'A', feedUrl: BASE, plansUrl: BASE, unsubscribeUrl: BASE, items: [{ ...ITEMS[0], city: 'Winston—Salem', state: 'N–C' }] });
    expect(hasEmDash(e.text + e.html)).toBe(false);
    expect(e.text).toContain('Winston-Salem, N-C');
    const w = renderWelcomeMatches({ businessName: 'A', feedUrl: BASE, plansUrl: BASE, unsubscribeUrl: BASE, total: 1, items: [{ ...ITEMS[0], city: 'A–B' }] });
    expect(hasEmDash(w.text + w.html)).toBe(false);
    expect(w.text).toContain('A-B, GA');
  });
});

describe('every email', () => {
  for (const [name, m] of ALL) {
    it(`${name}: has both parts, the mailing address, a one-click stop link, and a button`, () => {
      expect(m.text.length).toBeGreaterThan(50);
      expect(m.html.startsWith('<div')).toBe(true);
      for (const part of [m.text, m.html.replace(/&#39;/g, "'")]) {
        expect(part).toContain('ColorLabPro, Inc.');
        expect(part).toContain('2535 Dallas Highway SW STE B #1036, Marietta, GA 30064, USA');
      }
      expect(m.text).toContain('Stop these emails: https://localholler.com/api/cron/lifecycle/unsubscribe?t=');
      expect(m.html).toContain('href="https://localholler.com/api/cron/lifecycle/unsubscribe?t=');
      expect(m.html).toMatch(/<a href="[^"]+" style="[^"]*background:#1E3A2C;color:#F5F4EF[^"]*border-radius:10px/);
    });
  }

  it('subjects are the ones in the brief', () => {
    const s = samples();
    expect(s['welcome matches (5 shown of 12)'].subject).toBe('What we found near you');
    expect(s['welcome quiet'].subject).toBe('What we found near you');
    expect(s['trial_ending with alerts'].subject).toBe('Your trial ends in 3 days');
    expect(s['trial_ended missed'].subject).toBe('Your alerts are paused');
  });

  it('escapes business names and titles in HTML and puts no raw markup through', () => {
    const m = renderWelcomeMatches({ businessName: '<b>Evil & Sons</b>', feedUrl: `${BASE}/app?a=1&b="2"`, plansUrl: BASE, unsubscribeUrl: BASE, total: 1, items: [{ ...ITEMS[0], title: '<script>alert(1)</script>' }] });
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<b>Evil');
    expect(m.html).toContain('&lt;b&gt;Evil &amp; Sons&lt;/b&gt;');
    expect(m.html).toContain('a=1&amp;b=&quot;2&quot;');
  });

  it('never prints an email address, phone number or contact line (records are shown by title, place, date and label only)', () => {
    for (const [, m] of ALL) {
      expect(m.text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(m.text).not.toMatch(/\(\d{3}\)\s?\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b/);
      expect(m.text).not.toMatch(/Contact:/);
    }
  });
});

describe('day 1', () => {
  it('matches variant: the count, up to 5 items with place, date and intent label, a feed link', () => {
    const m = samples()['welcome matches (5 shown of 12)'];
    expect(m.text).toContain('12 records already match');
    const lines = m.text.split('\n').filter((l) => /\((.*), (Might need work|Money being spent|Someone asked)\)$/.test(l));
    expect(lines).toHaveLength(5);
    expect(m.text).toContain('Hail report: 1.25 inch hail near Marietta (Marietta, GA, Nov 17, Might need work)');
    expect(m.text).toContain('Residential re-roof permit, 2300 sq ft, Roswell Rd (Atlanta, GA, Nov 18, Money being spent)');
    expect(m.text).toContain('Open your feed: https://localholler.com/app');
    expect(m.text).toContain('The rest are in your feed.');
  });

  it('never shows more than 5 items even when given more, and says "the rest" only when there are more', () => {
    const m = renderWelcomeMatches({ businessName: 'A', feedUrl: BASE, plansUrl: BASE, unsubscribeUrl: BASE, total: 6, items: ITEMS });
    expect(m.text.match(/\(.*Nov \d+, [A-Za-z ]+\)/g)).toHaveLength(5);
    const all = samples()['welcome matches (3 of 3)'];
    expect(all.text).not.toContain('The rest');
    expect(all.text).toContain('3 records already match');
    expect(all.text).toContain('Here are the newest 3.');
  });

  it('singular and capped wording', () => {
    expect(samples()['welcome matches (1 of 1)'].text).toContain('1 record already matches');
    const capped = renderWelcomeMatches({ businessName: 'A', feedUrl: BASE, plansUrl: BASE, unsubscribeUrl: BASE, total: 500, capped: true, items: ITEMS.slice(0, 5) });
    expect(capped.text).toContain('at least 500 records already match');
  });

  it('zero-match variant: real 90-day counts by type, one line on trades and radius, no invented number', () => {
    const m = samples()['welcome quiet'];
    expect(m.text).toContain('nothing has matched your trades and area yet');
    expect(m.text).toContain('in the last 90 days, 34 public records');
    expect(m.text).toContain('building permits (19), 311 requests (8), storm reports (5) and code violations (2)');
    expect(m.text).toContain('add a trade or widen your radius in settings');
    const nums = (m.text.replace(/https?:\S+/g, '').replace(/2535 Dallas Highway SW STE B #1036, Marietta, GA 30064/, '').match(/\d+/g) ?? []).map(Number).sort((a, b) => a - b);
    expect(nums).toEqual([2, 5, 8, 19, 34, 90, 311]);
  });

  it('a single type reads naturally, with the right article', () => {
    const one = samples()['welcome quiet (one line)'];
    expect(one.text).toContain('1 public record fits your trades and area, and it is a weather alert.');
    const q = renderWelcomeQuiet({ businessName: 'A', feedUrl: BASE, plansUrl: BASE, unsubscribeUrl: BASE, total: 1, days: 90, lines: [{ label: 'earthquake', count: 1 }] });
    expect(q.text).toContain('and it is an earthquake.');
    const many = renderWelcomeQuiet({ businessName: 'A', feedUrl: BASE, plansUrl: BASE, unsubscribeUrl: BASE, total: 7, days: 90, lines: [{ label: 'storm reports', count: 7 }] });
    expect(many.text).toContain('7 public records fit your trades and area, and all of them are storm reports.');
  });

  it('capped preview says "at least"', () => {
    const m = renderWelcomeQuiet({ businessName: 'A', feedUrl: BASE, plansUrl: BASE, unsubscribeUrl: BASE, total: 2000, capped: true, days: 90, lines: [{ label: 'building permits', count: 2000 }] });
    expect(m.text).toContain('at least 2,000 public records');
  });

  it('shortDate is UTC and stable', () => {
    expect(shortDate('2026-11-17T23:59:00Z')).toBe('Nov 17');
    expect(shortDate('2026-01-01T00:00:00Z')).toBe('Jan 1');
    expect(shortDate('garbage')).toBe('');
  });
});

describe('day 5', () => {
  const m = samples()['trial_ending with alerts'];
  it('lists at most 3 alerts, never more', () => {
    const many = renderTrialEnding({ businessName: 'A', feedUrl: BASE, plansUrl: BASE, unsubscribeUrl: BASE, items: ITEMS });
    expect(many.text.match(/\(.*Nov \d+, [A-Za-z ]+\)/g)).toHaveLength(3);
    expect(m.text).toContain('Here are the 3 alerts that look strongest for your trades so far');
  });

  it('states no ordering the code does not follow (the AI ranking can reorder by its own score)', () => {
    // Changed in round 7 (review r4): the copy said "most serious first and the newest next", which is false when AI scores exist.
    for (const n of [1, 2, 3]) {
      const out = renderTrialEnding({ businessName: 'A', feedUrl: BASE, plansUrl: BASE, unsubscribeUrl: BASE, items: ITEMS.slice(0, n) });
      expect(out.text).not.toMatch(/most serious|newest next|newest first/i);
    }
  });

  it('prices are the price table, for both plans and both intervals', () => {
    for (const tier of ['starter', 'pro'] as const) {
      expect(m.text).toContain(`${priceLabel(tier, 'monthly')} a month`);
      expect(m.text).toContain(`${priceLabel(tier, 'annual')} a year`);
      expect(m.html).toContain(priceLabel(tier, 'monthly'));
    }
    // Limits come from the plan table too.
    expect(m.text).toContain(`covers ${PLAN_LIMITS.starter.areas} area and up to ${PLAN_LIMITS.starter.trades} trades`);
    expect(m.text).toContain(`${PLAN_LIMITS.pro.areas} areas and up to ${PLAN_LIMITS.pro.trades} trades, plus ${PLAN_LIMITS.pro.keywords} keyword watches`);
  });

  it('follows a price change in the table: nothing is cached or copied', async () => {
    vi.resetModules();
    vi.doMock('@/lib/stripe/plans', async () => {
      const real = await vi.importActual<typeof import('@/lib/stripe/plans')>('@/lib/stripe/plans');
      return { ...real, priceLabel: () => '$1.23' };
    });
    const mod = await import('@/lib/lifecycle/templates');
    const out = mod.renderTrialEnding({ businessName: 'A', feedUrl: BASE, plansUrl: BASE, unsubscribeUrl: BASE, items: [] });
    expect(out.text).toContain('$1.23 a month or $1.23 a year');
    vi.doUnmock('@/lib/stripe/plans');
    vi.resetModules();
  });

  it('the plan names come from the plan table', () => {
    const lines = planLines();
    expect(lines.map((l) => l.tier)).toEqual(['starter', 'pro']);
    for (const l of lines) expect(m.text).toContain(`${l.name} covers`);
  });

  it('without alerts it says so plainly and still shows the plans', () => {
    const e = samples()['trial_ending without alerts'];
    expect(e.text).toContain('has not matched anything to your trades and area yet');
    expect(e.text).not.toMatch(/\(.*Nov \d+/);
    expect(e.text).toContain('There are two plans.');
    expect(e.text).toContain('Pick a plan: https://localholler.com/app/settings#billing-h');
  });

  it('says the trial ends and alerts stop, which is what the matcher does', () => {
    expect(m.text).toContain('your alerts stop unless you pick a plan');
    expect(m.text).toContain('Both renew until you cancel in Settings.');
  });
});

describe('day 8', () => {
  it('with real misses: the count and one button', () => {
    const m = samples()['trial_ended missed'];
    expect(m.text).toContain('Since then, 7 new public records have matched your trades and area');
    expect(m.text.match(/Pick a plan:/g)).toHaveLength(1);
  });
  it('with none: paused, nothing else', () => {
    const m = samples()['trial_ended paused only'];
    expect(m.text).not.toMatch(/Since then/);
    expect(m.text).not.toMatch(/\d+ (new )?(public )?records?/);
    const body = m.text.split('\n').filter((l) => l.trim() && !/^(Holler for|You get this|Stop these|Holler is run)/.test(l));
    expect(body).toEqual(['Your free trial has ended, so Holler has paused your alerts, and a plan is all it takes to turn them back on.', 'Pick a plan: https://localholler.com/app/settings#billing-h']);
  });
  it('one record is singular, capped is a floor', () => {
    const one = renderTrialEnded({ businessName: 'A', feedUrl: BASE, plansUrl: BASE, unsubscribeUrl: BASE, missed: 1 });
    expect(one.text).toContain('1 new public record has matched');
    const cap = renderTrialEnded({ businessName: 'A', feedUrl: BASE, plansUrl: BASE, unsubscribeUrl: BASE, missed: 1000, capped: true });
    expect(cap.text).toContain('at least 1,000 new public records have matched');
  });
});

describe('no price literal in the lifecycle source', () => {
  const dir = path.join(__dirname, '../../lib/lifecycle');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
  const routeDir = path.join(__dirname, '../../app/api/cron/lifecycle');
  const routeFiles = [path.join(routeDir, 'route.ts'), path.join(routeDir, 'unsubscribe/route.ts')];
  const sources = [...files.map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]), ...routeFiles.map((f) => [path.basename(path.dirname(f)) + '/' + path.basename(f), fs.readFileSync(f, 'utf8')])];

  it('scans every lifecycle source file', () => {
    expect(files).toEqual(expect.arrayContaining(['templates.ts', 'run.ts', 'select.ts', 'store.ts', 'missed.ts', 'best.ts', 'unsub.ts', 'index.ts']));
  });
  it('has no dollar amount, and none of the current price figures, in any form', () => {
    const figures = new Set<string>();
    for (const t of Object.values(PRICES_CENTS)) for (const c of Object.values(t)) { figures.add((c / 100).toFixed(2)); figures.add(String(c / 100)); figures.add(String(c)); }
    for (const [f, src] of sources) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(/\$\s?\d/.test(code), `${f}: dollar literal`).toBe(false);
      if (f === 'templates.ts') expect(/\d+\.\d{2}\b/.test(code), `${f}: money-shaped literal`).toBe(false);
      for (const fig of figures) {
        if (fig.length < 3) continue;
        expect(new RegExp(`(?<![\\d.])${fig.replace('.', '\\.')}(?![\\d])`).test(code), `${f}: ${fig}`).toBe(false);
      }
      expect(/\b(per|a) (month|year)\b.*\d/.test(code)).toBe(false);
    }
  });
  it('imports prices from lib/stripe/plans (or lib/plan/public-prices once it exists)', () => {
    const t = fs.readFileSync(path.join(dir, 'templates.ts'), 'utf8');
    expect(/from '\.\.\/stripe\/plans'|from '\.\.\/plan\/public-prices'/.test(t)).toBe(true);
  });
});
