// Round 15 re-grade (Q2, pattern 5): the word "lead" or "leads" appeared on 42 of 50 cards, in the "Who to contact" guide link
// (lib/outreach/plan.ts). The brief's own banned-word test covered only brief sentences. This test reads every string literal in the
// modules that write words a member sees in the app, an alert, a push or an email, and fails on "lead"/"leads". Code identifiers
// (lead-rules, a variable called lead) and URL slugs are not strings a member reads, so they are skipped.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDE_RESPOND_PATH, GUIDE_STORMS_PATH } from '@/lib/outreach/links';
import { FOLLOWUP_INTRO, FOLLOWUP_OUTRO, FOLLOWUP_SUBJECT } from '@/lib/moat/email';

const ROOT = process.cwd();

function walk(path: string): string[] {
  const st = statSync(join(ROOT, path));
  if (st.isFile()) return [path];
  return readdirSync(join(ROOT, path)).flatMap((f) => walk(join(path, f)));
}

/** String literal contents of a TS/TSX source (single, double and template text), with comments and import lines removed. */
export function stringLiterals(src: string): string[] {
  const noComments = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
    .replace(/^\s*(?:import|export)\b[^;\n]*\bfrom\s+['"][^'"]+['"];?/gm, ' ');
  const out: string[] = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  for (let m = re.exec(noComments); m; m = re.exec(noComments)) {
    const t = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
    out.push(t);
  }
  return out;
}

/** Text between tags in a TSX file (JSX text), with expressions removed. */
function jsxText(src: string): string[] {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  return [...noComments.matchAll(/>([^<>{}\n][^<>{}]*)</g)].map((m) => m[1]);
}

const isSlug = (t: string) => /^\/[a-z0-9/_-]*$/i.test(t) || /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(t);

/** Member-facing modules: cards, the feed, alerts, push, emails, outreach kits. SEO guides and legal pages are separate surfaces. */
const MEMBER_FACING = [
  'lib/outreach',
  'lib/signals/brief.ts',
  'lib/signals/approx-location.ts',
  'lib/push',
  'lib/moat/email.ts',
  'lib/lifecycle/templates.ts',
  'lib/mobile/verify-email.ts',
  'components/feed.tsx',
  'components/feed',
  'app/app',
];

describe('no "lead" in any word a member reads in the app, a card, an alert or an email', () => {
  const files = MEMBER_FACING.flatMap(walk).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
  it('covers the outreach plan, the cards, the feed, push and email modules', () => {
    for (const must of ['lib/outreach/plan.ts', 'lib/signals/brief.ts', 'components/feed/who-to-contact.tsx', 'lib/moat/email.ts']) expect(files).toContain(must);
  });
  for (const f of files) {
    it(`${f}`, () => {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const texts = [...stringLiterals(src), ...(f.endsWith('.tsx') ? jsxText(src) : [])].filter((t) => !isSlug(t));
      const bad = texts.filter((t) => /\bleads?\b/i.test(t));
      expect(bad, `"lead" in ${f}`).toEqual([]);
    });
  }

  it('the two guide links on a card, and the follow-up email, carry no "lead"', () => {
    for (const label of [
      'Read the guide on storm damage work',
      'Read the guide on replying fast',
      FOLLOWUP_SUBJECT,
      ...FOLLOWUP_INTRO,
      ...FOLLOWUP_OUTRO,
    ]) expect(label).not.toMatch(/\blead/i);
    // The URL slugs keep the word (public, indexed addresses); they are not shown as words.
    expect(GUIDE_STORMS_PATH).toMatch(/^\/guides\//);
    expect(GUIDE_RESPOND_PATH).toMatch(/^\/guides\//);
  });
});
