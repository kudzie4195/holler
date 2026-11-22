import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSocrata } from '../../lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '../../lib/signals/adapters/socrata-datasets';
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

// The earlier 40 notes (redo 1), kept as written.
const EARLIER_PERMITS: Array<[string, string[]]> = [
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
const EARLIER_CIVICS: Array<[string, string[]]> = [
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

describe('review: at least 90% of good notes are kept', () => {
  const permits = EARLIER_PERMITS;
  const civics = EARLIER_CIVICS;
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

// ---------------------------------------------------------------------------------------------------------------------------------
// Review 2
// ---------------------------------------------------------------------------------------------------------------------------------

const rec = (o: Record<string, unknown>) => recordText(toRecord(o as never));
/** Records exactly as the Socrata adapters build them from the test fixtures (real field names, capitalized city and department names). */
function adapterRecords(dsId: string): string[] {
  const d = SOCRATA_DATASETS.find((x) => x.id === dsId)!;
  const rows = parseSocrata(JSON.parse(readFileSync(join(__dirname, '../fixtures', `${dsId}.json`), 'utf8')), d);
  return rows.map((r, i) =>
    rec({ id: i + 1, source: r.source, kind: r.kind, subtype: (r.data as { subtype?: string })?.subtype, title: r.title, summary: r.summary, city: r.city, state: r.state, categories: r.categories }),
  );
}

describe('review 2 P2-B: "A" or "The" before a capitalized word that the record has', () => {
  const FIRE = rec({ id: 3, source: 'atl-fire', kind: 'civic', subtype: 'inspection', title: 'Fire inspection in Atlanta: failed', summary: 'Fire Department inspection failed, sprinkler and alarm items.', city: 'Atlanta', state: 'GA', categories: ['fire-safety'] });
  const CO = rec({ id: 4, source: 'atl-permits', kind: 'permit', subtype: 'building', title: 'Certificate of Occupancy issued', summary: 'Certificate of Occupancy issued for new single family home.', city: 'Smyrna', state: 'GA', categories: ['cleaning'] });
  const ROOF = rec({ id: 1, source: 'atl-permits', kind: 'permit', subtype: 'building', title: 'Residential re-roof permit issued', summary: 'Permit issued to replace roof shingles. Valuation $12,500. Filed 2026-11-03 at 123 Oak St.', city: 'Atlanta', state: 'GA', categories: ['roofing'] });
  const kept: Array<[string, string, 'permit' | 'civic']> = [
    ['A Fire Department inspection like this may lead to sprinkler repair work.', FIRE, 'civic'],
    ['The Fire Department inspection may lead to sprinkler or alarm repair work.', FIRE, 'civic'],
    ['A Certificate of Occupancy may mean move in cleaning work could follow.', CO, 'permit'],
    ['The Certificate of Occupancy may mean move in cleaning work is near.', CO, 'permit'],
    ['The Atlanta re-roof permit may mean gutter work could follow.', ROOF, 'permit'],
  ];
  for (const [n, input, kind] of kept) it(`kept: ${n}`, () => expect(noteViolations(n, input, { kind })).toEqual([]));
  it('a company name after the article, or as the first word, is still dropped', () => {
    expect(noteViolations('The Acme Roofing crew may be busy, so gutter work could follow.', ROOF, { kind: 'permit' })).toContain('unknown_name');
    expect(noteViolations('A Peachtree Street re-roof may mean gutter work could follow.', ROOF, { kind: 'permit' })).toContain('unknown_name');
    expect(noteViolations('Acme Roofing may be busy, so gutter work could follow this re-roof.', ROOF, { kind: 'permit' })).toContain('unknown_name');
  });
});

describe('review 2 P3: read-time check gets the kind; backlog fallback is reported', () => {
  it('v1 civic and contract notes are not hidden on read; v1 vendor claims on a permit still are', async () => {
    const db = new AiFakeDb({
      holler_signals: [
        { id: 1, kind: 'civic' },
        { id: 2, kind: 'contract' },
        { id: 3, kind: 'permit' },
      ],
      holler_signal_ai: [
        { signal_id: 1, trades: { plumbing: 0.9 }, notes: { plumbing: 'This 311 request about a leaking pipe could mean pipe repair work.' }, prompt_v: 1 },
        { signal_id: 2, trades: { roofing: 0.9 }, notes: { roofing: 'The winning contractor may need roofing subcontractors for this award.' }, prompt_v: 1 },
        { signal_id: 3, trades: { roofing: 0.9 }, notes: { roofing: 'The winning contractor may need roofing subcontractors for this award.' }, prompt_v: 1 },
      ],
    });
    const m = await notesFor(db as never, [1, 2, 3], ['plumbing', 'roofing']);
    expect([...m.keys()].sort()).toEqual([1, 2]);
  });
  it('the kind lookup failing falls back to the stricter kind-less check, and nothing throws', async () => {
    const db = new AiFakeDb({
      holler_signals: [{ id: 1, kind: 'civic' }],
      holler_signal_ai: [{ signal_id: 1, trades: { plumbing: 0.9 }, notes: { plumbing: 'A leak report like this could mean pipe repair work for a plumber.' }, prompt_v: 1 }],
    });
    db.failOn['holler_signals.select'] = 'boom';
    expect((await notesFor(db as never, [1], ['plumbing'])).get(1)).toBe('A leak report like this could mean pipe repair work for a plumber.');
  });
  it('contract awards: the vendor rule is off for kind contract at write time too', () => {
    const input = 'contract award Federal contract roofing Atlanta GA';
    expect(noteViolations('The winning contractor may need roofing subcontractors for this award.', input, { kind: 'contract' })).toEqual([]);
    expect(noteViolations('The winning contractor may need roofing subcontractors for this award.', input, { kind: 'permit' })).toContain('claims_vendor');
  });
  it('the oldest-first backlog read failing is reported in the run JSON, with the error code only; the plain scan still runs', async () => {
    const db = new AiFakeDb({ holler_signals: [sig(1), sig(2)] });
    db.failOn['holler_signals.antijoin'] = 'PGRST200';
    const { model, calls } = mockModel((ids) => ({ results: ids.map((id) => ({ id, trades: [{ trade: 'roofing', p: 0.9 }], notes: [] })) }));
    const s = await runClassify({ db: db as never, now: NOW, deadline: Date.now() + 45_000, env: {}, model, rematch });
    expect(s.backlogFallback).toBe('PGRST200');
    expect(calls.flatMap((c) => c.ids).sort()).toEqual([1, 2]);
    const ok = await runClassify({ db: new AiFakeDb({ holler_signals: [sig(1)] }) as never, now: NOW, deadline: Date.now() + 45_000, env: {}, model: mockModel(() => ({ results: [] })).model, rematch });
    expect(ok.backlogFallback).toBeNull();
  });
});

describe('review 2: keep rate on the combined realistic set', () => {
  // The reviewer's 10 notes, on records built the way the adapters shape them.
  const PERMIT_RR = rec({ id: 10, source: 'atl-permits', kind: 'permit', subtype: 'building', title: 'Building permit in Atlanta: Residential Re-Roof', summary: 'Tear off and re-roof single family dwelling. Status: Issued.', city: 'Atlanta', state: 'GA', categories: ['roofing', 'gutters'] });
  const PERMIT_HVAC = rec({ id: 11, source: 'austin-permits', kind: 'permit', subtype: 'mechanical', title: 'Mechanical permit in Austin: HVAC change out', summary: 'Replace HVAC system, same location. Status: Issued.', city: 'Austin', state: 'TX', categories: ['hvac', 'electrical'] });
  const PERMIT_POOL = rec({ id: 12, source: 'phx-permits', kind: 'permit', subtype: 'building', title: 'Building permit in Phoenix: Swimming pool', summary: 'New in ground swimming pool and spa. Status: Issued.', city: 'Phoenix', state: 'AZ', categories: ['pools', 'fencing'] });
  const PERMIT_ELEC = rec({ id: 13, source: 'den-permits', kind: 'permit', subtype: 'electrical', title: 'Electrical permit in Denver: Service upgrade', summary: 'Upgrade service to 200 amp panel. Status: Finaled.', city: 'Denver', state: 'CO', categories: ['electrical'] });
  const PERMIT_ADD = rec({ id: 14, source: 'dal-permits', kind: 'permit', subtype: 'building', title: 'Building permit in Dallas: Residential addition', summary: 'Add master bedroom and bath to rear of house. Status: Issued.', city: 'Dallas', state: 'TX', categories: ['remodel', 'plumbing'] });
  const C311_DRAIN = rec({ id: 20, source: 'chi-311', kind: 'civic', subtype: '311', title: '311 request in Chicago: Sewer Cave In Inspection / Clogged storm drain', summary: 'Open. Created 2026-11-18.', city: 'Chicago', state: 'IL', categories: ['plumbing', 'drainage'] });
  const C311_TREE = rec({ id: 21, source: 'nyc-311', kind: 'civic', subtype: '311', title: '311 request in New York: Damaged Tree / Branch Cracked and Will Fall', summary: 'Assigned to Department of Parks and Recreation.', city: 'New York', state: 'NY', categories: ['tree'] });
  const VIOL_PAINT = rec({ id: 22, source: 'det-violations', kind: 'civic', subtype: 'violation', title: 'Code violation in Detroit: Exterior paint', summary: 'Failure to maintain exterior surfaces, peeling paint. Status: Open.', city: 'Detroit', state: 'MI', categories: ['painting'] });
  const INSP_REST = rec({ id: 23, source: 'sf-inspections', kind: 'civic', subtype: 'inspection', title: 'Inspection in San Francisco: Restaurant routine inspection', summary: 'Score 71. Moderate risk vermin infestation; unclean floors.', city: 'San Francisco', state: 'CA', categories: ['pest', 'cleaning'] });
  const C311_GRAF = rec({ id: 24, source: 'la-311', kind: 'civic', subtype: '311', title: '311 request in Los Angeles: Graffiti Removal', summary: 'Graffiti on private property wall. Status: Open.', city: 'Los Angeles', state: 'CA', categories: ['painting', 'pressure-washing'] });
  const reviewer: Array<['permit' | 'civic', string, string]> = [
    ['permit', PERMIT_RR, 'A tear off re-roof often means old gutters come down too, so gutter work could follow.'],
    ['permit', PERMIT_HVAC, 'An HVAC change out may call for a new disconnect or circuit, which could mean electrical work.'],
    ['permit', PERMIT_POOL, 'A new pool usually needs a safety barrier, so fencing work could follow.'],
    ['permit', PERMIT_ELEC, 'A finaled 200 amp upgrade may open the door to EV charger or generator work.'],
    ['permit', PERMIT_ADD, 'A new master bath may mean tile, fixture and drywall work as the addition comes together.'],
    ['civic', C311_DRAIN, 'A reported clogged storm drain could mean drain cleaning or sewer repair work nearby.'],
    ['civic', C311_TREE, 'This 311 report about a cracked branch could mean tree trimming or removal work.'],
    ['civic', VIOL_PAINT, 'A peeling paint violation may mean exterior scraping and painting work for this property.'],
    ['civic', INSP_REST, 'A restaurant inspection that noted vermin may lead to pest control and deep cleaning work.'],
    ['civic', C311_GRAF, 'A graffiti report on a private wall could mean pressure washing or repainting work.'],
  ];
  // Ten more, on the real adapter output for the test fixtures (Chicago, New Orleans, Buffalo, NYC, Austin, Dallas).
  const chiP = adapterRecords('socrata-chicago-permits');
  const nolaP = adapterRecords('socrata-nola-permits');
  const bufP = adapterRecords('socrata-buffalo-permits');
  const chi311 = adapterRecords('socrata-chicago-311');
  const nyc311 = adapterRecords('socrata-nyc-311');
  const ausV = adapterRecords('socrata-austin-violations');
  const ausI = adapterRecords('socrata-austin-inspections');
  const dal311 = adapterRecords('socrata-dallas-311');
  const own: Array<['permit' | 'civic', string, string]> = [
    ['permit', chiP[0], 'A Chicago roof permit with a $14,500 job value may mean gutter and flashing work could follow.'],
    ['permit', chiP[1], 'An electrical permit like this may lead to panel or lighting work in the same building.'],
    ['permit', chiP[2], 'A $1,250,000 new construction permit may mean landscaping, fencing and cleaning work later.'],
    ['permit', nolaP[0], 'A Roof and siding permit in New Orleans may also mean gutter work could follow.'],
    ['permit', bufP[0], 'A $6,500 fence and concrete permit may mean driveway or fence installation work nearby.'],
    ['civic', chi311[0], 'A rodent complaint in Chicago may lead to pest control work nearby.'],
    ['civic', nyc311[0], 'A HEAT/HOT WATER report for an entire building may mean boiler or heating repair work.'],
    ['civic', ausV[0], 'A code violation for trash and an overgrown yard could mean cleanup, hauling or lawn care work.'],
    ['civic', ausI[0], 'A failed food establishment inspection in Austin may lead to pest control and deep cleaning work.'],
    ['civic', dal311[0], 'An Illegal Dumping report to Code Compliance may mean junk hauling work nearby in Dallas.'],
  ];
  it('the 20 new notes: the records are the adapters\' own output (guard against a changed fixture)', () => {
    expect(chiP[0]).toContain('Roof permit in Chicago');
    expect(dal311[0]).toContain('Illegal Dumping Reports');
  });
  it('reviewer 10 + own 10 + the earlier 40: at least 90% kept; the drops are listed', () => {
    const all = [...reviewer, ...own];
    const bad: string[] = [];
    for (const [kind, input, note] of all) {
      const v = noteViolations(note, input, { kind });
      if (v.length) bad.push(`${v.join(',')} | ${note}`);
    }
    // the earlier 40 notes live in the describe above; recount them here with the same helper so the combined rate is real
    const earlier = (groups: Array<[string, string[]]>, kind: 'permit' | 'civic') =>
      groups.flatMap(([input, notes]) => notes.map((n) => ({ n, v: noteViolations(n, input, { kind }) })));
    const e40 = [...earlier(EARLIER_PERMITS, 'permit'), ...earlier(EARLIER_CIVICS, 'civic')];
    for (const x of e40) if (x.v.length) bad.push(`${x.v.join(',')} | ${x.n}`);
    const total = all.length + e40.length;
    expect(total).toBe(60);
    const keptRate = (total - bad.length) / total;
    expect(keptRate, bad.join('\n')).toBeGreaterThanOrEqual(0.9);
    // and the new 20 on their own must not be the ones carrying the rate
    const newBad = bad.filter((b) => all.some(([, , n]) => b.endsWith(`| ${n}`)));
    expect((20 - newBad.length) / 20, newBad.join('\n')).toBeGreaterThanOrEqual(0.9);
  });
});
