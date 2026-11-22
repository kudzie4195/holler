// Round 18 ROUTES review probe (logs/REV-ROUTES-probe-tests), kept as a permanent regression test (redo 1). With REV_OUT set it also
// writes its table to that path; without it it writes nothing.
/**
 * REV-ROUTES probe 02: the real STORED permit rows in tests/signals/__data__ (summary only, no contacts on file in the fixtures), per
 * source: how many have a job-site address the gate accepts in the summary (siteAddressFromSummary), how many print a part that starts
 * with a house number but the gate rejects, and how many print none.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { contactPathOf } from '@/lib/signals/alert-gate';
import { sanitizeContacts } from '@/lib/contacts/sanitize';

const j = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
interface Row { id: number; source: string; title: string; summary: string | null }
const rows = new Map<number, Row>();
for (const r of j('tests/signals/__data__/review-f-sample-156.json') as [number, string, string, string | null, string, string[]][]) rows.set(r[0], { id: r[0], source: r[1], title: r[2], summary: r[3] });
for (const c of j('tests/signals/__data__/quality-gate-r15-cards.json').cards as { signal: { id: number; source: string; kind?: string; title: string; summary: string | null } }[]) {
  if (c.signal && (c.signal.kind === 'permit' || /permit/.test(c.signal.source))) rows.set(c.signal.id, { id: c.signal.id, source: c.signal.source, title: c.signal.title, summary: c.signal.summary ?? null });
}

describe('REV-ROUTES 02: stored real permit rows, contact path from the summary', () => {
  it('prints the table', () => {
    const by = new Map<string, { n: number; site: number; rejected: string[]; none: number; rescued: number }>();
    for (const r of rows.values()) {
      if (!/permits$/.test(r.source)) continue;
      const b = by.get(r.source) ?? { n: 0, site: 0, rejected: [], none: 0, rescued: 0 };
      b.n++;
      const cp = contactPathOf([], r.summary);
      if (cp) b.site++;
      else {
        const numbered = (r.summary ?? '').split(' | ').find((p) => /^\s*\d+[A-Za-z]?\s+[A-Za-z]/.test(p) && !/job value|^1 or 2 family/i.test(p));
        if (numbered) {
          b.rejected.push(`${r.id}: ${numbered}`);
          // would the scan's own site contact (the same address column, after the sanitiser) have counted?
          if (contactPathOf(sanitizeContacts([{ role: 'site', name: '', address: numbered }], {}), null)) b.rescued++;
        }
        else b.none++;
      }
      by.set(r.source, b);
    }
    const out = ['| Source (stored real rows) | Rows | Site address accepted | Numbered street part REJECTED by the gate | No address in summary | % with a contact path (summary only) | % if the address column is also held as a site contact (estimate) |', '|---|---|---|---|---|---|---|'];
    const rej: string[] = [];
    for (const [s, b] of [...by].sort()) {
      out.push(`| ${s} | ${b.n} | ${b.site} | ${b.rejected.length} | ${b.none} | ${Math.round((100 * b.site) / b.n)}% | ${Math.round((100 * (b.site + b.rescued)) / b.n)}% |`);
      for (const x of b.rejected) rej.push(`${s}\t${x}`);
    }
    const f = process.env.REV_OUT as string;
    if (process.env.REV_OUT) writeFileSync(f, out.join('\n') + '\n\nRejected numbered parts:\n' + rej.join('\n') + '\n');
    console.log(out.join('\n') + '\n' + rej.join('\n'));
    expect(by.size).toBeGreaterThan(0);
    // Redo 1 (decision 1): no stored row that prints a numbered street part is refused by the gate; the only rows with no path print no
    // address at all (DeKalb's summaries carry none: its site address is in the private locationLine1 column, read by the scan).
    for (const [s, b] of by) expect(b.rejected, s).toEqual([]);
    expect(by.get('arcgis-atlanta-permits')).toMatchObject({ n: 8, site: 8 });
    expect(by.get('arcgis-mecklenburg-permits')).toMatchObject({ n: 7, site: 7 });
  });
});
