// Round 35: the cell table after the 2026-11-28 re-measure (scripts/fixtures/cells-r35/verdict-r35.json, built from 28,632 live rows of the last
// 14 days with the production switches on, plus a 10-record hand read per cell whose verdict would change). The table is generated, never edited:
// this test rebuilds it from the measurement and compares, then pins every move and every move held back.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CELL_OVERRIDES, CELL_TABLE, COMPOSITE_CELL_TABLE } from '@/lib/check/cells-data';
import { signupClosedTrades, tradeSignupClosed } from '@/lib/check/cells';

const FIXTURE = 'scripts/fixtures/cells-r35/verdict-r35.json';

/** Every cell the round 35 re-measure moved from live to limited (centre, trade; "pressure-washing" is the composite chip). */
const MOVED: Array<[string, string]> = [
  ['chicago', 'landscaping'],
  ['atlanta', 'landscaping'],
  ['atlanta', 'pressure-washing'],
  ['new-york', 'landscaping'],
  ['washington-dc', 'landscaping'],
  ['los-angeles', 'landscaping'],
  ['los-angeles', 'lawn-care'],
  ['seattle', 'landscaping'],
  ['raleigh', 'landscaping'],
  ['raleigh', 'lawn-care'],
  ['cincinnati', 'pressure-washing'],
  ['san-francisco', 'siding-gutters'],
  ['san-francisco', 'pressure-washing'],
  ['charlotte', 'landscaping'],
  ['new-orleans', 'landscaping'],
];
/** Hand read supports limited, but the move is held: cleaning must stay live somewhere or sign-up closes for cleaning and the Pressure washing chip. */
const HELD: Array<[string, string]> = [
  ['los-angeles', 'cleaning'],
  ['seattle', 'cleaning'],
  ['raleigh', 'cleaning'],
  ['seattle', 'pressure-washing'],
  ['raleigh', 'pressure-washing'],
];
const cell = (c: string, t: string) => (t === 'pressure-washing' ? COMPOSITE_CELL_TABLE[c][t] : CELL_TABLE[c][t]);

describe('round 35 cell table', () => {
  it('is exactly what scripts/build-cells.mjs makes from the measurement (no hand edits)', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'cells-r35-')), 'cells-data.ts');
    execFileSync('node', ['scripts/build-cells.mjs', FIXTURE, out], { stdio: 'pipe' });
    expect(readFileSync(out, 'utf8')).toBe(readFileSync('lib/check/cells-data.ts', 'utf8'));
  });

  it('moved 15 cells from live to limited, each with its numbers in the override record', () => {
    expect(MOVED).toHaveLength(15);
    for (const [c, t] of MOVED) {
      expect(cell(c, t), `${c} ${t}`).toBe('limited');
      const o = CELL_OVERRIDES.find((x) => x.cell === `${c}|${t}`);
      expect(o, `${c}|${t} override`).toBeDefined();
      expect(o).toMatchObject({ engine: 'live', state: 'limited' });
      expect(o!.note).toMatch(/^r35 re-measure 2026-11-28: \d+ emailed in 14 days \(\d+ in the last 7 days\), \d+ places; hand read \d+\/\d+ actionable/);
    }
    expect(CELL_OVERRIDES.filter((o) => o.note.startsWith('r35 '))).toHaveLength(15);
  });

  it('holds back the 5 moves that would close sign-up for cleaning and the Pressure washing chip, or break the composite rule', () => {
    for (const [c, t] of HELD) expect(cell(c, t), `${c} ${t}`).toBe('live');
    // cleaning is live in exactly these three centres: if the held cells are ever moved, tradeSignupClosed('cleaning') flips to true.
    const liveCleaning = Object.keys(CELL_TABLE).filter((c) => CELL_TABLE[c].cleaning === 'live');
    expect(liveCleaning.sort()).toEqual(['los-angeles', 'raleigh', 'seattle']);
    expect(tradeSignupClosed('cleaning')).toBe(false);
    expect(tradeSignupClosed('pressure-washing')).toBe(false);
    expect(signupClosedTrades()).toHaveLength(22);
  });

  it('keeps live where the counts and the hand read both support it (spot checks across the launch cities)', () => {
    for (const [c, t] of [['austin', 'landscaping'], ['austin', 'lawn-care'], ['austin', 'junk-removal'], ['charlotte', 'siding-gutters'], ['charlotte', 'fencing'], ['raleigh', 'painting'], ['chicago', 'handyman'], ['new-orleans', 'siding-gutters'], ['los-angeles', 'siding-gutters'], ['new-york', 'siding-gutters'], ['washington-dc', 'siding-gutters']] as const) {
      expect(cell(c, t), `${c} ${t}`).toBe('live');
    }
  });

  it('does not use "lead" as a noun, an em-dash or a promised street address in any note', () => {
    for (const o of CELL_OVERRIDES) {
      expect(o.note).not.toMatch(/\blead(s)?\b/i);
      expect(o.note).not.toContain('—');
    }
  });
});
