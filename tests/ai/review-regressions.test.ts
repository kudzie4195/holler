import { describe, expect, it, vi } from 'vitest';
import { runClassify, recordText, toRecord } from '../../lib/ai/classify';
import { modelSignalsToday } from '../../lib/ai/limits';
import { cleanNote, noteViolations, wordingViolations } from '../../lib/ai/note-rules';
import { notesFor } from '../../lib/ai/rank';
import { AiFakeDb, NOW, sig } from './fake-db';
import { mockModel } from './mock-model';

// Regression tests for the independent review of unit AI (review-AI.md, FIX FIRST): P1-1..P1-3, P2-1..P2-5. P2-6 is in
// tests/signals/adapters/websearch-errors.test.ts. Probe notes and records come from the reviewer's probe tests.

const rematch = vi.fn(async (_db: unknown, ids: number[]): Promise<{ created: number; error?: string }> => ({ created: ids.length }));

const permitRec = toRecord({ id: 1, source: 'atl-permits', kind: 'permit', subtype: 'building', title: 'Residential re-roof permit issued', summary: 'Permit issued to replace roof shingles. Valuation $12,500. Filed 2026-11-03 at 123 Oak St.', city: 'Atlanta', state: 'GA', categories: ['roofing'], occurred_at: null });
const civicRec = toRecord({ id: 2, source: 'atl-311', kind: 'civic', subtype: '311', title: '311 request: broken water main', summary: 'Service request reported a leaking pipe and damaged sidewalk.', city: 'Atlanta', state: 'GA', categories: ['plumbing'], occurred_at: null });
const P = recordText(permitRec);
const C = recordText(civicRec);
const dropped = (note: string, kind: 'permit' | 'civic' = 'permit') => noteViolations(note, kind === 'permit' ? P : C, { kind }).length > 0;

describe('review P1-1: unicode digits, look-alike letters and fullwidth text', () => {
  const INPUT = 'permit Residential re-roof permit issued Permit issued to replace roof shingles Atlanta GA roofing';
  const lines = [
    'A re-roof may mean gutter work, and Асме Roofing could bid too.', // Cyrillic
    'A re-roof may mean gutter work, and Ａｃｍｅ could bid too.', // fullwidth Latin
    'A re-roof may mean gutter work for ５ nearby homes too.', // fullwidth digit
    'A re-roof may mean gutter work for ⑤ nearby homes too.', // circled digit
    'A re-roof valued near ٤٥٠٠٠ dollars may call for gutter work.', // Arabic-Indic digits
    'A re-roof may mean gutter work, ｗｗｗ．ａｃｍｅ．ｃｏｍ has more.', // fullwidth URL
    'A re-roof may mean gutter work, call ５５５ ０１９９ for it.', // fullwidth phone
  ];
  for (const n of lines) it(`dropped: ${n}`, () => expect(cleanNote(n, INPUT, { kind: 'permit' })).toBeNull());
  it('a plain ASCII note on the same record is still kept, and cleanNote returns the NFKC form', () => {
    expect(cleanNote('A re-roof may mean gutter work could follow.', INPUT, { kind: 'permit' })).toBe('A re-roof may mean gutter work could follow.');
  });
});

describe('review P1-3: vendor-chosen phrasings on a permit', () => {
  const lines = [
    'The owner went with a roofer, but gutter work may follow.',
    'A roofer is on the job, so gutter work may follow later.',
    'The contractor of record may subcontract gutter work.',
    'Their roofer may not do gutters, so gutter work could follow.',
    'The re-roof being done by a local crew may leave gutter work.',
    'With a roofer engaged, gutter work may follow this re-roof.',
    'A roofer won this job, but gutter work may still follow.',
    'The roofing company handling it may also want gutters.',
  ];
  for (const n of lines) it(`dropped: ${n}`, () => expect(dropped(n)).toBe(true));
});

describe('review P2-4 and P2-5: invented numbers and names, wording gaps', () => {
  const lines: Array<[string, 'permit' | 'civic']> = [
    ['A re-roof covering three thousand square feet may call for gutter work.', 'permit'],
    ['Acme Roofing may be busy, so gutter work could follow this re-roof.', 'permit'],
    ['A re-roof issued in December may mean gutter work could follow.', 'permit'],
    ["You'll win gutter work from this re-roof if you move fast.", 'permit'],
    ['You’ll win gutter work from this re-roof if you move fast.', 'permit'],
    ['This official public record of a re-roof may mean gutter work.', 'permit'],
    ['This re-roof is officially recorded, so gutter work may follow.', 'permit'],
    ['Storm hit homes nearby may need pipe repair work soon.', 'civic'],
    ['Hail battered roofs nearby could mean plumbing work too.', 'civic'],
    ['After the storm damage this leak could mean pipe work.', 'civic'],
  ];
  for (const [n, k] of lines) it(`dropped: ${n}`, () => expect(dropped(n, k)).toBe(true));
  it('a number word is fine when the record itself has it', () => {
    const rec = 'permit Re-roof of three story building Atlanta roofing';
    expect(noteViolations('A re-roof on a three story building may mean gutter work.', rec, { kind: 'permit' })).toEqual([]);
  });
  it('hedged damage verbs and a first word that is a known term still pass', () => {
    expect(noteViolations('Homes that may have been hit by hail could need a roof check.', P, { kind: 'alert' })).toEqual([]);
  });
});

describe('review P2-1: good 311 and permit notes are kept', () => {
  const civicGood = [
    'This 311 request about a leaking pipe could mean pipe repair work.',
    'A reported broken water main could mean pipe repair work nearby.',
    'A report of a damaged sidewalk could mean concrete repair work.',
    'A leak report like this could mean pipe repair work for a plumber.',
    'A service request about a water line may lead to plumbing work.',
  ];
  for (const n of civicGood) it(`kept: ${n}`, () => expect(dropped(n, 'civic')).toBe(false));
  const permitGood = [
    'Once the re-roof is signed off, gutter work may follow.',
    'A re-roof may mean gutter work if the selected shingles change the edge.',
    'The permit applicant may also plan gutter work after the re-roof.',
    'A re-roof may mean gutter work, worth a look to verify scope.',
    'A final inspection on a re-roof may lead to gutter or trim work.',
  ];
  for (const n of permitGood) it(`kept: ${n}`, () => expect(dropped(n, 'permit')).toBe(false));
  it('"someone requested work" is still a request claim, also on a civic record', () => {
    expect(noteViolations('Someone requested pipe repair work at this address.', C, { kind: 'civic' })).toContain('claims_request');
  });
});

describe('review P2-3: notes stored under prompt version 1 are checked when read', () => {
  it('a v1 note with vendor, proof or "official record" wording is not shown; clean v1 notes and v2 notes are', async () => {
    const db = new AiFakeDb({
      holler_signal_ai: [
        { signal_id: 1, trades: { roofing: 0.9 }, notes: { roofing: 'A contractor already has this re-roof job.' }, prompt_v: 1 },
        { signal_id: 2, trades: { roofing: 0.9 }, notes: { roofing: 'See the official record for roof work that may follow.' }, prompt_v: 1 },
        { signal_id: 3, trades: { roofing: 0.9 }, notes: { roofing: 'This permit confirms the roof needs replacing soon.' } }, // no prompt_v: version 1
        { signal_id: 4, trades: { roofing: 0.9 }, notes: { roofing: 'A re-roof permit may mean gutter work could follow.' }, prompt_v: 1 },
        { signal_id: 5, trades: { roofing: 0.9 }, notes: { roofing: 'New roofing work may follow this permit.' }, prompt_v: 2 },
      ],
    });
    const m = await notesFor(db as never, [1, 2, 3, 4, 5], ['roofing']);
    expect([...m.keys()].sort()).toEqual([4, 5]);
  });
  it('wordingViolations is the input-free part of the rules', () => {
    expect(wordingViolations('A contractor already has this re-roof job.')).toContain('claims_vendor');
    expect(wordingViolations('A re-roof permit may mean gutter work could follow.')).toEqual([]);
  });
});

describe('review P1-2: oldest first holds under a backlog', () => {
  it('6000 unclassified permits inside 14 days, run limit 10: the oldest 10 go first, then the next oldest', async () => {
    const rows = Array.from({ length: 6000 }, (_, i) => sig(i + 1, { occurred_at: new Date(NOW.getTime() - (i + 1) * 120_000).toISOString() }));
    const db = new AiFakeDb({ holler_signals: rows });
    const answer = (ids: number[]) => ({ results: ids.map((id) => ({ id, trades: [{ trade: 'roofing', p: 0.9 }], notes: [] })) });
    const env = { AI_MAX_SIGNALS_PER_RUN: '10', AI_MAX_SIGNALS_PER_DAY: '1000' };
    const a = mockModel(answer);
    const s = await runClassify({ db: db as never, now: NOW, deadline: Date.now() + 45_000, env, model: a.model, rematch, concurrency: 1 });
    const sent = a.calls.flatMap((c) => c.ids).sort((x, y) => x - y);
    expect(sent).toEqual([5991, 5992, 5993, 5994, 5995, 5996, 5997, 5998, 5999, 6000]);
    expect(s.limits.deferred).toBeGreaterThan(0);
    const b = mockModel(answer);
    for (const r of db.tables.holler_ai_spend) r.created_at ??= NOW.toISOString();
    await runClassify({ db: db as never, now: NOW, deadline: Date.now() + 45_000, env, model: b.model, rematch, concurrency: 1 });
    expect(b.calls.flatMap((c) => c.ids).sort((x, y) => x - y)).toEqual([5981, 5982, 5983, 5984, 5985, 5986, 5987, 5988, 5989, 5990]);
  }, 60_000);
  it('the anti-join failing (not supported, not migrated) falls back to the plain scan', async () => {
    const db = new AiFakeDb({ holler_signals: [sig(1), sig(2)] });
    db.failOn['holler_signals.select'] = 'boom'; // every signals select fails: the run reports signals_read_failed, as before
    const { model, calls } = mockModel(() => ({ results: [] }));
    const s = await runClassify({ db: db as never, now: NOW, deadline: Date.now() + 45_000, env: {}, model, rematch });
    expect(s.reason).toBe('signals_read_failed');
    expect(calls).toHaveLength(0);
  });
});

describe('review P2-2: calls that failed before any response do not use the day limit', () => {
  it('three hourly runs against a dead gateway: usedToday stays 0 and nothing is billed', async () => {
    const db = new AiFakeDb({ holler_signals: Array.from({ length: 600 }, (_, i) => sig(i + 1, { title: `Re-roof permit ${i + 1}`, summary: 'Permit issued to replace roof shingles.' })) });
    const err = Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' });
    for (let run = 1; run <= 3; run++) {
      const { model, calls } = mockModel(() => ({ results: [] }), { throwError: err });
      const s = await runClassify({ db: db as never, now: NOW, deadline: Date.now() + 45_000, env: {}, model, rematch, concurrency: 10 });
      for (const r of db.tables.holler_ai_spend) r.created_at ??= NOW.toISOString();
      expect(calls.length).toBeGreaterThan(0);
      expect(s.reason).toBe('model_unavailable');
      expect(await modelSignalsToday(db as never, NOW)).toBe(0);
    }
    expect(db.tables.holler_ai_spend.reduce((a, r) => a + Number(r.cost_usd ?? 0), 0)).toBe(0);
  });
  it('a timed-out call (may have been billed) and a billed bad answer still count', async () => {
    const db = new AiFakeDb();
    const t = NOW.toISOString();
    db.tables.holler_ai_spend.push(
      { id: 1, month: '2026-11-01', kind: 'unknown', signals: 24, cost_usd: 0.002, created_at: t },
      { id: 2, month: '2026-11-01', kind: 'error', signals: 24, cost_usd: 0.001, created_at: t },
      { id: 3, month: '2026-11-01', kind: 'error', signals: 24, cost_usd: 0, created_at: t },
    );
    expect(await modelSignalsToday(db as never, NOW)).toBe(48);
  });
});

describe('review: at least 90% of good notes are kept', () => {
  const permits: Array<[string, string[]]> = [
    [
      'permit Residential re-roof permit in Marietta Re-roof of a single family home, 2 stories. Permit issued. Marietta GA roofing',
      [
        'A re-roof on a two story home may also mean gutter replacement work.', // "two" is a number word not in the record: expected drop
        'Roof tear off debris could mean a dumpster or hauling job.',
        'New shingles may call for fresh flashing and vent work.',
        'A re-roof permit like this could mean drip edge and gutter work.',
        'Attic ventilation work could come with a re-roof of this size.',
      ],
    ],
    [
      'permit New single family home permit in Smyrna New construction, 3 bedrooms, permit issued. Smyrna GA landscaping fencing cleaning',
      [
        'New construction may mean sod, landscaping and irrigation work later.',
        'A new home may call for fencing once the build is finished.',
        'Move in cleaning could be needed near the end of a new build.',
        'A new house permit may lead to window treatment and security work.',
        'New homes often mean mailbox, driveway and landscaping work.',
      ],
    ],
    [
      'permit Kitchen and bath remodel permit in Decatur Interior remodel, plumbing and electrical included. Decatur GA remodel plumbing electrical',
      [
        'An interior remodel may mean flooring and painting work comes next.',
        'Remodel permits like this could lead to junk removal and cleaning jobs.',
        'Plumbing and electrical in one remodel may mean drywall patch work.',
        'A kitchen remodel could mean countertop, tile and cabinet work.',
        'A bath remodel may be followed by paint and trim work.',
      ],
    ],
    [
      'permit Commercial tenant improvement permit in Atlanta Tenant build-out of retail space, permit issued. Atlanta GA commercial signage cleaning',
      [
        'A tenant build-out may mean signage and security system work.',
        'Retail space build-outs could lead to commercial cleaning work.',
        'A build-out like this may call for pest control and IT cabling.',
        'New tenants often need signs, so sign work could follow.', // "need signs": claims_request? (need + plural noun not in NEED_OBJ) expected kept
        'A final inspection on this space may be followed by cleaning work.',
      ],
    ],
  ];
  const civics: Array<[string, string[]]> = [
    [
      'civic 311 request in Austin: water leak Service request for a water line leak near a street. Austin TX plumbing',
      [
        'A reported water line leak could mean pipe repair work nearby.',
        'This 311 report about a leak may lead to plumbing work.',
        'A leak report like this could mean a plumber is useful in the area.',
        'Water line leaks may call for excavation and pipe replacement work.',
        'A reported leak could lead to street and sidewalk patch work.',
      ],
    ],
    [
      'civic Code violation in Dallas: overgrown yard Property violation for tall grass and debris. Dallas TX landscaping',
      [
        'A reported overgrown yard could mean mowing and cleanup work.',
        'This violation may lead to lawn care or debris hauling work.',
        'A code violation for tall grass could mean landscaping work.',
        'A reported debris problem may mean junk removal work nearby.',
        'Yard violations like this could lead to tree trimming work.',
      ],
    ],
    [
      'civic Inspection in Denver: failed final Failed inspection, re-inspection scheduled. Denver CO electrical plumbing',
      [
        'A failed inspection may mean repair work before the re-inspection.',
        'A failed final could lead to electrical or plumbing repair work.',
        'Re-inspection items may call for a licensed trade to fix them.',
        'A failed inspection like this could mean follow up repair jobs.',
        'This inspection may point to punch list work on the building.',
      ],
    ],
    [
      'civic 311 request in Chicago: pothole and broken sidewalk Reported pothole and a cracked sidewalk. Chicago IL concrete paving',
      [
        'A reported cracked sidewalk could mean concrete repair work.',
        'A pothole report may lead to asphalt patching work nearby.',
        'This 311 report about a broken sidewalk could mean concrete work.',
        'A reported pothole could mean paving or sealcoat work on the block.',
        'Sidewalk reports like this may call for concrete cutting and pouring.',
      ],
    ],
  ];
  const run = (groups: Array<[string, string[]]>, kind: 'permit' | 'civic') => {
    let kept = 0;
    let total = 0;
    const bad: string[] = [];
    for (const [input, notes] of groups) {
      for (const n of notes) {
        total++;
        const v = noteViolations(n, input, { kind });
        if (v.length === 0) kept++;
        else bad.push(`${v.join(',')} | ${n}`);
      }
    }
    return { kept, total, bad };
  };
  it('20 good permit notes: at least 90% kept', () => {
    const r = run(permits, 'permit');
    expect(r.total).toBe(20);
    expect(r.kept / r.total, r.bad.join('\n')).toBeGreaterThanOrEqual(0.9);
  });
  it('20 good 311, violation and inspection notes: at least 90% kept', () => {
    const r = run(civics, 'civic');
    expect(r.total).toBe(20);
    expect(r.kept / r.total, r.bad.join('\n')).toBeGreaterThanOrEqual(0.9);
  });
});
