import { describe, expect, it } from 'vitest';
import { NOTE_KINDS, OUTREACH_REMINDER, STORM_REMINDER, renderNote, type NoteKind } from '@/lib/outreach/templates';

const BANNED = [
  'delve', 'seamless', 'robust', 'comprehensive', 'holistic', 'elevate', 'unlock', 'unleash', 'empower', 'journey', 'landscape',
  'realm', 'game-changer', 'leverage', 'utilize', 'moreover', 'furthermore', 'effortless', 'supercharge', 'revolutionize',
];
const PRESSURE = ['act now', 'limited time', 'last chance', 'urgent', 'before it is too late', "don't miss", 'today only', 'hurry'];
const DAMAGE_CLAIMS = ['your damage', 'your roof is', 'damaged', 'we found', 'we noticed'];

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).filter(Boolean);

const FILLED = { org: 'Peachtree Roofing LLC', address: '12 Main St, Atlanta, GA 30301' };

describe('outreach templates', () => {
  it('has every situation the brief names', () => {
    expect(NOTE_KINDS).toHaveLength(8);
  });

  for (const kind of ['sub-to-contractor', 'trade-to-owner', 'seller-to-new-business', 'service-to-inspected', 'supplier-to-awardee', 'bidder-to-buyer', 'door-hanger-storm', 'door-hanger'] as NoteKind[]) {
    for (const [label, vars] of [['bare', {}], ['filled', FILLED]] as const) {
      it(`${kind} (${label}): 40 to 80 words, placeholders, copy rules`, () => {
        const t = renderNote(kind, vars);
        const n = words(t);
        expect(n).toBeGreaterThanOrEqual(40);
        expect(n).toBeLessThanOrEqual(80);
        for (const p of ['[your name]', '[your business]', '[your phone]']) {
          if (kind !== 'bidder-to-buyer' || p !== '[your name]') expect(t).toContain(p);
        }
        expect(t).not.toMatch(/[—–]/);
        const lower = t.toLowerCase();
        for (const b of BANNED) expect(lower).not.toContain(b);
        for (const b of PRESSURE) expect(lower).not.toContain(b);
        for (const b of DAMAGE_CLAIMS) expect(lower).not.toContain(b);
        expect(lower).not.toMatch(/\bai\b|bot|scrap|algorithm|holler/);
        // mixed sentence lengths: at least one short sentence and one of 12+ words
        const lens = sentences(t).map(words);
        expect(Math.min(...lens)).toBeLessThan(8);
        expect(Math.max(...lens)).toBeGreaterThanOrEqual(12);
      });
    }
  }

  it('only says how the sender found them as "public record"', () => {
    for (const k of NOTE_KINDS) {
      const t = renderNote(k, FILLED).toLowerCase();
      expect(t).not.toMatch(/online|database|software|alert|monitor|tracking|found you|saw you on/);
    }
  });

  it('the letter can be addressed to a property owner or the current resident', () => {
    expect(renderNote('trade-to-owner', { greeting: 'Property owner' })).toMatch(/^Dear Property owner\./);
    expect(renderNote('trade-to-owner', { greeting: 'Current resident' })).toMatch(/^Dear Current resident\./);
  });

  it('the inspection note does not shame', () => {
    const t = renderNote('service-to-inspected', FILLED).toLowerCase();
    for (const w of ['fail', 'violation', 'dirty', 'unsafe', 'shut', 'cited']) expect(t).not.toContain(w);
  });

  it('the storm note makes no claim about damage', () => {
    const t = renderNote('door-hanger-storm').toLowerCase();
    expect(t).toContain('if you have questions');
    expect(t).not.toMatch(/damage|leak|roof|insurance|free/);
  });

  it('P2-7: the storm note uses the agreed weather sentence', () => {
    const t = renderNote('door-hanger-storm', FILLED);
    expect(t).toContain('Severe weather has been forecast or reported for this area.');
    expect(t).not.toContain('in the forecast');
    expect(t).not.toMatch(/[\u2013\u2014]/);
    const n = t.split(/\s+/).filter(Boolean).length;
    expect(n).toBeGreaterThanOrEqual(40);
    expect(n).toBeLessThanOrEqual(80);
  });

  it('reminder line is the agreed sentence', () => {
    expect(OUTREACH_REMINDER).toBe('Check Do Not Call rules before you phone.');
    expect(STORM_REMINDER).toBe("Check Do Not Call rules before you phone, and your state's rules on storm-related sales.");
  });
});
