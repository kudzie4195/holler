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

describe('final review r17 P1-2: the noun "lead" is dropped whatever comes before it; the verb and the trade terms are kept', () => {
  const PERMIT = 'New construction permit in Norfolk New Construction | 100 EXAMPLE AVE permit socrata-norfolk-permits general-contractor Norfolk VA';
  const VIOL = 'Code violation in Detroit: Lead hazard, peeling paint on a pre 1978 house. Status: Open. det-violations painting Detroit MI';

  it('the reviewer probe (FINAL-probe-tests/x3b): all four noun notes are dropped, the verb hedge is kept', () => {
    for (const n of [
      'This new build could be a strong lead for landscapers.',
      'This could be a promising lead for a final clean.',
      'One lead worth a look for cleaning crews after the build.',
      'This may be a quality lead for landscaping once the house is done.',
    ]) {
      expect(noteViolations(n, PERMIT, { kind: 'permit' }), n).toContain('claims_customer');
      expect(cleanNote(n, PERMIT, { kind: 'permit' }), n).toBeNull();
    }
    expect(cleanNote('Could lead to cleaning work once the building is finished.', PERMIT, { kind: 'permit' })).not.toBeNull();
  });

  it('noun forms are dropped: "a lead", "strong lead", "leads", "new leads"', () => {
    for (const n of [
      'This permit may be a lead for landscaping work.',
      'A new build like this could be a strong lead for cleaners.',
      'Permits like this may bring leads for fencing crews.',
      'Leads like this may follow from new construction.',
      'New leads may come from permits like this one.',
      'Lead for cleaners: a new house may need a final clean.',
      'A good sales lead may sit in permits like this one.',
    ]) expect(noteViolations(n, PERMIT, { kind: 'permit' }), n).toContain('claims_customer');
  });

  it('the verb, "leading" and the adjective are kept: "lead to", "leading", "lead time"', () => {
    for (const n of [
      'A new build like this could lead to landscaping work later.',
      'New construction often leads to fencing and cleaning work.',
      'A new house may lead into fencing work once it is finished.',
      'Permits like this are often leading signs of landscaping work.',
      'Long lead time on materials may push finish work back.',
      'Material lead times may delay the final clean on this build.',
    ]) expect(noteViolations(n, PERMIT, { kind: 'permit' }), n).toEqual([]);
  });

  it('metal and abatement terms from permits and violations are kept: "lead paint", "lead pipe", "lead abatement"', () => {
    for (const n of [
      'Lead paint on an older house may call for careful painting work.',
      'A lead-based paint violation may mean scraping and repainting work.',
      'Older homes with a lead pipe may need water line work.',
      'Lead pipes in older houses may mean plumbing work nearby.',
      'A lead abatement order may mean painting work for this property.',
      'A lead hazard violation may mean careful paint removal work.',
      'Lead-safe painting work may be needed on this older house.',
    ]) expect(noteViolations(n, VIOL, { kind: 'civic' }), n).toEqual([]);
  });
});

describe('re-review r17 P2-D: the noun "lead" in the shapes that passed the first fix (probe: REFIX17-probe-tests/p12.test.ts)', () => {
  const PERMIT = 'New construction permit in Norfolk. New Construction | 200 OTHER RD. permit. socrata-norfolk-permits. landscaping, cleaning. Norfolk, VA';
  const CTX = { kind: 'permit' };
  const dropped = (n: string) => {
    expect(noteViolations(n, PERMIT, CTX), n).toContain('claims_customer');
    expect(cleanNote(n, PERMIT, CTX), n).toBeNull();
  };
  const kept = (n: string) => expect(noteViolations(n, PERMIT, CTX), n).toEqual([]);

  it('the 10 shapes from the re-review are dropped: noun before "to", "into", "based on", "free of", and "leadgen"', () => {
    for (const n of [
      'This could be a lead to follow up on soon.',
      'This may be a strong lead to pursue for cleaners.',
      'A new build may bring new leads to cleaning crews.',
      'Leads to cleaning crews may follow this build.',
      'Could give landscapers more leads to chase.',
      'May be a lead into the property for cleaners.',
      'A possible lead based on the new build.',
      'A lead based on this permit may suit cleaners.',
      'Good leadgen for landscapers once it wraps up.',
      'A lead free of rivals may suit a small crew.',
    ]) dropped(n);
  });

  it('the rest of the probe noun list is still dropped', () => {
    for (const n of [
      'This could be a lead for a cleaning crew.',
      'This new build could be a strong lead for landscapers.',
      'New builds like this often bring leads for cleaners.',
      'This area may bring new leads once the build wraps up.',
      'Possible lead for roofers after the permit closes.',
      'This may be a hot lead for landscapers.',
      'Lead for landscapers once the build is finished.',
      'Leads may follow once the build wraps up.',
      'One lead here may suit a landscaping crew.',
      'A promising lead for cleaning crews nearby.',
      'May be a quality lead once the build wraps up.',
      'Could be a good sales lead for landscapers.',
      'A new build like this is a possible lead.',
      'Worth a look as a LEAD for cleaning crews.',
      'A lead-gen chance for cleaning crews nearby.',
      'Could turn into warm leads for cleaning crews.',
    ]) dropped(n);
  });

  it('required keeps: lead paint, lead-based paint, lead pipe, lead time, lead abatement, lead service line, lead hazard, "lead to", "leads to", "leading"', () => {
    for (const n of [
      'Older homes may have lead paint to check before work.',
      'Lead paint may be present in an older home.',
      'Older homes may have lead-based paint under new work.',
      'An older lead pipe may be replaced during this work.',
      'Lead pipes may be swapped out during this work.',
      'Lead time for a new build is often long.',
      'The lead time on a new build is often long.',
      'Long lead times are common on a new build.',
      'Lead abatement may be part of this remodel.',
      'A lead service line may be replaced during this work.',
      'A lead hazard may be listed on a record like this.',
      'This could lead to cleanup work once the build wraps up.',
      'A new build often leads to landscaping work.',
      'Finished builds may be leading to yard work soon.',
      'A build like this may lead into a long yard project.',
      'Builds like this usually lead to yard work.',
      'Permits like these lead to cleanup work quite often.',
      'A finished one may lead to cleaning work.',
    ]) kept(n);
  });

  it('more metal and trade terms are kept now: water line, piping, dust, painted, contaminated, removal, flashing, testing, safe, levels, mitigation', () => {
    for (const n of [
      'A lead water line may be replaced during this work.',
      'Lead piping may be replaced during this work.',
      'Lead dust may be a risk during this remodel.',
      'Lead-painted trim may be stripped during this remodel.',
      'Lead-contaminated soil may be hauled off before the build.',
      'Lead removal may be part of this remodel.',
      'Lead flashing may be replaced with the new roof.',
      'Lead testing may be part of this remodel.',
      'Lead-safe work rules may apply to this remodel.',
      'Lead levels may be checked before the remodel.',
      'Lead mitigation may be part of this remodel.',
    ]) kept(n);
  });
});
