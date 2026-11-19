import { describe, expect, it } from 'vitest';
import { renderMonitorEmail, monitorSubject, MAX_CONDITION_LINES } from '@/lib/monitor/email';
import { sentences, copyStats, bannedHits, hasEmDash } from '../seo/helpers/copy-metrics';
import { ago, cond, H, MIN, NOW } from './helpers';
import type { Condition } from '@/lib/monitor/rules';

const URL = 'https://localholler.com/api/admin/sources';
const scanError = cond({ lastError: 'matching failed: relation "holler_profiles" does not exist', lastSuccessAt: ago(21 * MIN) });
const silentNws = cond({
  key: 'source:nws:silent', code: 'source_silent', severity: 4, source: 'nws', headline: 'nws has gone quiet',
  reason: 'The source has produced nothing new for more than 24 hours and its latest fetch failed, so its feed may be down.', lastSuccessAt: ago(26 * H), lastError: 'HTTP 503',
});
const render = (items: Condition[], recovered: string[] = []) => renderMonitorEmail({ items, recovered, now: NOW, sourcesUrl: URL });

describe('subject', () => {
  it('starts with "Holler ingest:" and names the worst condition', () => {
    expect(render([silentNws, scanError]).subject).toBe('Holler ingest: scan error (and 1 more)');
    expect(render([silentNws]).subject).toBe('Holler ingest: nws has gone quiet');
  });
  it('a recovery-only email says recovered', () => {
    expect(monitorSubject([], 2)).toBe('Holler ingest: recovered');
    expect(render([], ['scan:error']).subject).toBe('Holler ingest: recovered');
  });
});

describe('body', () => {
  it('lists source id, last success time, last error, the source table link and the postal footer', () => {
    const m = render([silentNws]);
    expect(m.text).toContain('Source nws last had a good fetch at 2026-11-18 12:11 UTC, which was 26 h ago.');
    expect(m.text).toContain('The last error recorded was: HTTP 503');
    expect(m.text).toContain(URL);
    expect(m.text).toContain('ColorLabPro, Inc.');
    expect(m.html).toContain(`href="${URL}"`);
    expect(m.html).toContain('ColorLabPro, Inc.');
  });
  it('says so when there is no last success or no error', () => {
    const m = render([cond({ lastSuccessAt: null, lastError: null })]);
    expect(m.text).toContain('The last clean scan has no success on record in the last 24 hours.');
    expect(m.text).toContain('No error text was recorded.');
  });
  it('carries the recovered lines', () => {
    const m = render([silentNws], ['source:spc:silent', 'scan:error']);
    expect(m.text).toContain('Recovered\n- spc: delivering again.\n- Scan: the latest run has no error.');
    expect(m.html).toContain('<li>spc: delivering again.</li>');
  });
  it('is capped, with a count of the rest', () => {
    const many = Array.from({ length: 30 }, (_, i) => cond({ key: `source:s${i}:status`, code: 'source_down', severity: 5, source: `s${i}`, headline: `s${i} is unavailable` }));
    const m = render(many);
    expect(m.text).toContain(`And ${30 - MAX_CONDITION_LINES} more.`);
    expect(m.text.match(/^Source s\d+ last had a good fetch/gm)).toHaveLength(MAX_CONDITION_LINES);
  });
  it('escapes html', () => {
    const m = render([cond({ source: '<b>x</b>', headline: '<i>bad</i>', reason: 'a & b' })]);
    expect(m.html).not.toContain('<b>x</b>');
    expect(m.html).toContain('&lt;i&gt;bad&lt;/i&gt;');
  });
});

describe('no row data in the email', () => {
  const dirty = [
    'duplicate key value violates unique constraint "holler_signals_source_external_id_key"\nDETAIL: Key (source, external_id)=(socrata, P-123 Jane Roe) already exists.',
    'failed to parse {"title":"Roof permit for Jane Roe","address":"12 Elm St","phone":"404-555-0199"}',
    'bad row for "Jane Roe" jane@example.com 404-555-0199 at https://x.test/a?api_key=SECRET123&q=Jane',
  ];
  it.each(dirty)('a hand-built condition with a dirty error still cannot leak: %#', (e) => {
    const m = render([cond({ lastError: e })]);
    for (const part of [m.text, m.html]) {
      expect(part).not.toMatch(/Jane|Roe|Elm St|404-555|jane@|SECRET123|P-123|roof permit/i);
    }
  });
  it('the scan_runs error path is cleaned before it reaches the condition', async () => {
    const { evaluateScan } = await import('@/lib/monitor/rules');
    const c = evaluateScan([{ source: 'nws', finished_at: ago(MIN), error: dirty[2].replace('bad row', 'matching failed: bad row') }], NOW);
    const m = render(c);
    expect(m.text).not.toMatch(/Jane|jane@|404-555|SECRET123/);
  });
  it('no dashes in the text, and no banned words', () => {
    const m = render([scanError, silentNws], ['source:spc:silent']);
    for (const part of [m.subject, m.text]) {
      expect(part).not.toMatch(/[–—]/);
      expect(hasEmDash(part)).toBe(false);
      expect(bannedHits(part)).toEqual([]);
    }
  });
});

describe('the two example emails', () => {
  it.each([
    ['scan error', () => render([scanError])],
    ['silent source', () => render([silentNws])],
  ])('%s reads like the copy rules want', (_n, make) => {
    const s = copyStats(make().text);
    console.log(_n, JSON.stringify(s), JSON.stringify(sentences(make().text).map((x) => x.split(/\s+/).length)));
    expect(s.cv).toBeGreaterThanOrEqual(0.55);
    expect(s.shortShare).toBeGreaterThanOrEqual(0.12);
    expect(s.mean).toBeGreaterThanOrEqual(12);
    expect(s.mean).toBeLessThanOrEqual(22);
  });
});

// Round 7 fix-g2 (verify-v3 P2): problems emailed in the last 24 hours are not listed again, only counted, so a recovery email never
// says everything is fine while one is still open.
describe('still open, not listed again', () => {
  it('a recovery email with a problem still open says so in the subject and one plain line, without listing it', async () => {
    const { renderMonitorEmail } = await import('@/lib/monitor/email');
    const m = renderMonitorEmail({ items: [], recovered: ['scan:error'], now: new Date('2026-11-19T14:11:00Z'), sourcesUrl: 'https://x.test/api/health/sources', stillOpen: 1 });
    expect(m.subject).toBe('Holler ingest: partly recovered');
    expect(m.text).toContain('1 problem from an earlier email is still open. It is not listed again here.');
    expect(m.text).not.toContain('Everything that was wrong is fine again.');
    const all = renderMonitorEmail({ items: [], recovered: ['scan:error'], now: new Date('2026-11-19T14:11:00Z'), sourcesUrl: 'https://x.test/api/health/sources' });
    expect(all.subject).toBe('Holler ingest: recovered');
    expect(all.text).not.toContain('still open');
  });
});
