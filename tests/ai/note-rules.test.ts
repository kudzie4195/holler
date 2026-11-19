import { describe, expect, it } from 'vitest';
import { cleanNote, noteViolations, NOTE_MAX_CHARS } from '../../lib/ai/note-rules';

const INPUT = 'report hail spc Hail 1.75 inch reported near Smyrna, wind 60 mph Storm report Smyrna GA roofing';
const OK = 'Hail this size may leave roofs in need of a close look this week.';

describe('note rules', () => {
  it('a clean note passes and is trimmed', () => {
    expect(noteViolations(OK, INPUT)).toEqual([]);
    expect(cleanNote(`  ${OK}  `, INPUT)).toBe(OK);
  });

  it('length: over 140 characters, under the minimum, empty, non-string', () => {
    const long = 'Roofs nearby may see more calls this week. '.repeat(4);
    expect(long.trim().length).toBeGreaterThan(NOTE_MAX_CHARS);
    expect(noteViolations(long, INPUT)).toContain('too_long');
    expect(noteViolations('Roofs.', INPUT)).toContain('too_short');
    expect(noteViolations('   ', INPUT)).toEqual(['empty']);
    expect(cleanNote(42, INPUT)).toBeNull();
    expect(cleanNote(long, INPUT)).toBeNull();
  });

  it('exactly 140 characters is allowed', () => {
    const s = ('Roofs near Smyrna may need a look after this hail ' + 'x'.repeat(200)).slice(0, NOTE_MAX_CHARS);
    expect(s.length).toBe(140);
    expect(noteViolations(s, INPUT)).not.toContain('too_long');
  });

  it('em, en and other dashes', () => {
    for (const d of ['—', '–', '‒', '―', '−']) {
      expect(noteViolations(`Hail may hit roofs ${d} worth a look today.`, INPUT)).toContain('dash');
    }
    expect(noteViolations('Hail may leave roofs worth a follow-up look.', INPUT)).not.toContain('dash');
  });

  it('digits: only numbers that are in the input', () => {
    expect(noteViolations('Hail of 1.75 inch may leave roofs worth a look.', INPUT)).toEqual([]);
    expect(noteViolations('Winds near 60 mph may lift shingles on older roofs.', INPUT)).toEqual([]);
    expect(noteViolations('Hail of 2 inch may leave roofs worth a look.', INPUT)).toContain('digits_not_in_input');
    expect(noteViolations('About 300 homes may want roof checks soon.', INPUT)).toContain('digits_not_in_input');
    expect(noteViolations('Hail of 1 inch may leave roofs worth a look.', INPUT)).toContain('digits_not_in_input');
  });

  it('phone, email and URL shapes', () => {
    const input = INPUT + ' 404 555 0101';
    expect(noteViolations('Roofs may need a look, call 404 555 0101 today.', input)).toContain('phone');
    expect(noteViolations('Roofs may need a look, write to info@roofer.example now.', INPUT)).toContain('email');
    expect(noteViolations('Roofs may need a look, see https://evil.example for more.', INPUT)).toContain('url');
    expect(noteViolations('Roofs may need a look, see www.example.org for more.', INPUT)).toContain('url');
    expect(noteViolations('Roofs may need a look, see evil.example for more.', INPUT)).toContain('url');
    expect(noteViolations('Roofs in the U.S. south may need a look by 9 a.m.', INPUT + ' 9')).not.toContain('url');
  });

  it('banned words (house list and draft list), whole words only', () => {
    for (const w of ['delve', 'robust', 'seamless', 'elevate', 'unlock', 'empower', 'journey', 'landscape', 'leverage', 'not only', 'more than just', "it's worth noting", "whether you're", 'supercharge', 'game changer']) {
      expect(noteViolations(`Roofs may ${w} work for crews here soon.`, INPUT), w).toContain('banned_word');
    }
    expect(noteViolations('Landscaping crews may see fallen limbs to clear soon.', INPUT)).not.toContain('banned_word');
  });

  it('no claim of damage unless hedged right before', () => {
    expect(noteViolations('Hail damaged roofs across Smyrna this afternoon.', INPUT)).toContain('claims_damage');
    expect(noteViolations('Several roofs were destroyed near Smyrna.', INPUT)).toContain('claims_damage');
    expect(noteViolations('Roofs near Smyrna may have hail damage worth checking.', INPUT)).toEqual([]);
    expect(noteViolations('Crews could check for damage on older roofs nearby.', INPUT)).toEqual([]);
  });

  it('no claim of a customer or that anyone asked for work', () => {
    expect(noteViolations('New customers near Smyrna for any roofer.', INPUT)).toContain('claims_customer');
    expect(noteViolations('A hot lead for roofers in Smyrna.', INPUT)).toContain('claims_customer');
    expect(noteViolations('A homeowner asked for a roof quote here.', INPUT)).toContain('claims_request');
    expect(noteViolations('Someone is looking for a roofer in Smyrna.', INPUT)).toContain('claims_request');
    expect(noteViolations('The owner wants a new roof after the storm.', INPUT)).toContain('claims_request');
    expect(noteViolations('This house needs a roofer after the hail.', INPUT)).toContain('claims_request');
    expect(noteViolations('Residents requested help after the hail.', INPUT)).toContain('claims_request');
  });

  it('multi-line and markup', () => {
    expect(noteViolations('Roofs may need a look.\nCall now.', INPUT)).toContain('multiline');
    expect(noteViolations('Roofs may need a look <b>now</b> nearby.', INPUT)).toContain('markup');
    expect(noteViolations('Roofs may need a [look](x) nearby soon.', INPUT)).toContain('markup');
  });
});

describe('names not in the input', () => {
  it('a capitalized place or name the record does not contain is dropped; the first word and known terms are fine', () => {
    expect(noteViolations('Roofs near Smyrna may need a look soon.', INPUT)).toEqual([]);
    expect(noteViolations('Roofs near Marietta may need a look soon.', INPUT)).toContain('unknown_name');
    expect(noteViolations('Roofers like Acme Roofing may see work soon.', INPUT)).toContain('unknown_name');
    expect(noteViolations('Older AC units may need service after this storm.', INPUT)).toEqual([]);
  });
});
