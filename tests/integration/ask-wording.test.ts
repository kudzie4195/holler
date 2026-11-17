// Integration round 3, item 3: the 'ask' kind now has one source that needs no key (resident requests made on Holler). Public copy must
// stay truthful: without search or Bluesky keys nothing says "people asking online" or implies Holler reads social sites, and the
// city-page section and /check group that list request rows describe them neutrally.
import { describe, expect, it } from 'vitest';
import { SIGNAL_NEEDS_KEY } from '@/lib/signals/capabilities';
import { aboutCopy, flagsFor, homeCopy, llmsText } from '@/lib/seo/public-copy';
import { SECTION_BY_ID, KIND_NOUN } from '@/lib/seo/sections';
import { getSourceMeta } from '@/lib/signals/source-meta';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const none = () => false;
const SOCIAL = /asking online|public posts?|bluesky|social (sites?|media)|web search|anyone recommend/i;

describe("'ask' wording with no optional keys", () => {
  it("the keyed 'people asking online' feed stays gated: flags.ask is off without keys", () => {
    expect(SIGNAL_NEEDS_KEY.ask).toBeDefined();
    expect(flagsFor(none).ask).toBe(false);
  });
  it('home, about and llms.txt never say people asking online or name a social site', () => {
    expect(JSON.stringify(homeCopy(none))).not.toMatch(SOCIAL);
    expect(JSON.stringify(aboutCopy(none))).not.toMatch(SOCIAL);
    expect(llmsText({ cityCount: 300, states: [], url: (p: string) => `https://x.test${p}` }, none)).not.toMatch(SOCIAL);
  });
  it('the city-page section and the /check group that hold request rows are described neutrally', () => {
    const s = SECTION_BY_ID.asks;
    expect(`${s.title} ${s.noun.join(' ')} ${s.blurb} ${KIND_NOUN.ask}`).not.toMatch(SOCIAL);
    expect(s.title).toBe('Requests for local help');
    expect(readFileSync(path.resolve(__dirname, '../../lib/check/group.ts'), 'utf8')).toContain("{ id: 'ask', title: 'Requests for local help', kinds: ['ask'] }");
    expect(getSourceMeta('holler-request')!.label).toBe('Requests made on Holler');
  });
});
