// Round 7 leftovers guard. Scans every .ts/.tsx file under app/, components/ and lib/ for:
//  - the old prices ($5, 5/mo, $48, 48/yr, $9.99, 9.99, $96, 96/yr, and the old cents and Offer prices typed into code),
//  - the old display name "Starter" (the internal id `starter` in lower case is fine everywhere),
//  - 7-day trial wording (the trial is TRIAL_DAYS = 60 days since round 18, printed from the constant).
// Any hit outside ALLOW fails. Each ALLOW entry names one file and one exact snippet, with the reason. Entries marked `patch` go away
// when the commander applies the PRICING "Patches for integration" (shared files this unit may not edit); delete them then.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const DIRS = ['app', 'components', 'lib'];

const RULES: { name: string; re: RegExp }[] = [
  { name: 'old price $5', re: /\$5(?![\d.,])/g },
  { name: 'old price 5/mo', re: /(?<![\d.])5\/mo\b/g },
  { name: 'old price $48', re: /\$48(?![\d.])/g },
  { name: 'old price 48/yr', re: /(?<![\d.])48\/yr\b/g },
  { name: 'old price 9.99', re: /(?<![\d.])9\.99(?![\d])/g },
  { name: 'old price $96', re: /\$96(?![\d.])/g },
  { name: 'old price 96/yr', re: /(?<![\d.])96\/yr\b/g },
  { name: 'old Offer price typed', re: /price:\s*'(5|48|9\.99|96)(\.00)?'/g },
  { name: 'old cents typed', re: /(monthly|annual|unit_amount):\s*(500|4800|999|9600)\b/g },
  { name: 'display name Starter', re: /\bStarter\b/g },
  { name: '7-day trial wording', re: /\b7-day\b|\b7 days free\b|first 7 days|free for 7 days|\bfree week\b|seven-day|\b7 day trial|trialDays \?\? 7\b/gi },
  // Sentence-initial "Seven days" was the trial copy ("Seven days, no card"); lower-case "seven days" is data-source wording (NWS).
  { name: '7-day trial wording', re: /\bSeven days\b/g },
];

/** Allowed hits: file (relative), the exact text of the line part that contains the hit, and why. */
const ALLOW: { file: string; snippet: string; reason: string; patch?: true }[] = [
  // Comments and one log line in MATCH-owned files (lib/signals/**): not shown to members; MATCH owns the wording.
  { file: 'lib/signals/backfill.ts', snippet: 'a Starter profile with saved Pro extras', reason: 'code comment, MATCH-owned file' },
  { file: 'lib/signals/backfill.ts', snippet: 'no plan columns means Starter limits', reason: 'code comment, MATCH-owned file' },
  { file: 'lib/signals/match.ts', snippet: 'Missing means Starter limits.', reason: 'code comment, MATCH-owned file' },
  { file: 'lib/signals/store.ts', snippet: 'which gives every profile Starter limits.', reason: 'code comment, MATCH-owned file' },
  { file: 'lib/signals/store.ts', snippet: 'keep matching on Starter limits instead of matching nobody.', reason: 'code comment, MATCH-owned file' },
  { file: 'lib/signals/store.ts', snippet: "matching with Starter limits');", reason: 'server log line (console.error), never shown to a member; MATCH-owned' },
  // This unit's own documentation of the rename.
  { file: 'lib/stripe/products.ts', snippet: 'A display name change ("Holler Starter" to "Holler Solo")', reason: 'doc comment naming the old Stripe product name the rename replaces' },
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (n === 'node_modules' || n.startsWith('.')) return [];
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

interface Hit {
  file: string;
  line: number;
  rule: string;
  text: string;
}

function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const d of DIRS) {
    for (const f of files(path.join(ROOT, d))) {
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((text, i) => {
          for (const r of RULES) {
            r.re.lastIndex = 0;
            if (r.re.test(text)) hits.push({ file: rel, line: i + 1, rule: r.name, text: text.trim() });
          }
        });
    }
  }
  return hits;
}

const allowed = (h: Hit) => ALLOW.some((a) => a.file === h.file && h.text.includes(a.snippet));

describe('no old prices, no "Starter", no 7-day trial wording in app/, components/, lib/', () => {
  const hits = scan();
  it('every hit is on the allowlist', () => {
    const bad = hits.filter((h) => !allowed(h)).map((h) => `${h.file}:${h.line} [${h.rule}] ${h.text.slice(0, 140)}`);
    expect(bad).toEqual([]);
  });
  it('the allowlist has no stale entries (each still matches a real hit)', () => {
    const stale = ALLOW.filter((a) => !hits.some((h) => h.file === a.file && h.text.includes(a.snippet))).map((a) => `${a.file}: ${a.snippet}`);
    expect(stale).toEqual([]);
  });
  it('the rules catch what they must (self-test on known strings)', () => {
    const t = (s: string) => RULES.filter((r) => ((r.re.lastIndex = 0), r.re.test(s))).map((r) => r.name);
    expect(t('from $5 a month')).toContain('old price $5');
    expect(t('Get alerts from $5/mo')).toContain('old price $5');
    expect(t('or $48 a year')).toContain('old price $48');
    expect(t('Pro is $9.99')).toContain('old price 9.99');
    expect(t("price: '48'")).toContain('old Offer price typed');
    expect(t('starter: { monthly: 500, annual: 4800 }')).toContain('old cents typed');
    expect(t('Starter is')).toContain('display name Starter');
    expect(t('a 7-day free trial')).toContain('7-day trial wording');
    expect(t('Seven days, no card')).toContain('7-day trial wording');
    expect(t('Start your free week')).toContain('7-day trial wording');
    // and leave the new values and unrelated numbers alone
    for (const ok of ['$7.99 a month', '$79.99 a year', '$13.99', '$139.99', "plan: 'starter'", 'lat: 29.9902', '23:59:59.999Z', 'last 7 days', '60-day free trial', '$500 per job', '$50', 'Free weekly city email', 'holds the past seven days']) {
      expect(t(ok), ok).toEqual([]);
    }
  });
});
