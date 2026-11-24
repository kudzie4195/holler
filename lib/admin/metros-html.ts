import { OPPORTUNITY_CHIP, OPPORTUNITY_LABELS } from '@/lib/signals/lead-rules';
import type { CardCounts, MetroReport, MetroScore, SourceCounts } from './metros';

/**
 * The per-metro scorecard as one self-contained HTML page for the owner, like the quality dashboard (lib/admin/quality-html.ts): no
 * script, no external file, no cookie, no form; a table per metro. Every value is escaped. The route (app/api/admin/metros) sends it
 * noindex and no-store.
 */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const pct = (v: number | null): string => (v === null ? '-' : `${Math.round(v * 100)}%`);
const num = (v: number | null): string => (v === null ? 'blank' : String(v));

function cells(c: CardCounts): string {
  return (
    `<td>${c.total}</td>` +
    OPPORTUNITY_LABELS.map((l) => `<td>${c.byLabel[l]}</td>`).join('') +
    `<td>${c.alerted}</td><td>${c.withContact} of ${c.contactEligible}</td><td>${pct(c.contactShare)}</td>`
  );
}

function sourcesLine(s: SourceCounts | null): string {
  if (!s) return 'Sources: blank (states could not be read).';
  const behind = s.behindIds.length ? ` (${s.behindIds.map(esc).join(', ')})` : '';
  return `Sources: ${s.total} live, ${s.healthy} healthy, ${s.behind} behind${behind}, ${s.notSetUp} not set up.`;
}

function metroBlock(m: MetroScore): string {
  const head =
    '<tr><th>Trade</th><th>Cards</th>' +
    OPPORTUNITY_LABELS.map((l) => `<th>${esc(OPPORTUNITY_CHIP[l])}</th>`).join('') +
    '<th>Alerted (Act now + Coming soon)</th><th>With a contact path</th><th>Contact share</th></tr>';
  const rows = m.trades.map((t) => `<tr><th scope="row">${esc(t.trade)}</th>${cells(t)}</tr>`).join('');
  const probation = m.probation.length
    ? `<p>On probation (samples only, never shown to members): ${m.probation
        .map((p) => `${esc(p.id)}: ${p.samples === null ? 'samples blank' : `${p.samples} sample rows`}${p.state ? `, ${esc(p.state)}` : ''}`)
        .join('; ')}.</p>`
    : '';
  return (
    `<h2 id="${esc(m.id)}">${esc(m.label)}</h2>` +
    `<p>${sourcesLine(m.sources)} Waitlist: ${num(m.waitlist.area)} on this site's list, ${num(m.waitlist.zipConfirmed)} confirmed on the earlier list.${byTrade(m.waitlist.zipByTrade)}</p>` +
    probation +
    `<table><thead>${head}</thead><tbody><tr class="all"><th scope="row">All trades</th>${cells(m.cards)}</tr>${rows}</tbody></table>`
  );
}

/** Round 24 FIX2 (review D8): " By trade: lawn-care 2, plumbing 1." for the confirmed ZIP waitlist; nothing when it was not read. */
function byTrade(rec: Record<string, number> | null | undefined): string {
  if (!rec) return '';
  const parts = Object.entries(rec).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([t, n]) => `${esc(t)} ${n}`);
  return parts.length ? ` By trade: ${parts.join(', ')}.` : '';
}

export function renderMetrosHtml(r: MetroReport): string {
  const bad = (Object.entries(r.sections) as Array<[string, string]>).filter(([, v]) => v !== 'ok').map(([k, v]) => `${esc(k)}: ${esc(v)}`);
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Holler metro scorecard</title>' +
    '<style>body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#111}table{border-collapse:collapse;width:100%;margin-bottom:8px}' +
    'th,td{border:1px solid #ccc;padding:4px 8px;text-align:right}th:first-child,thead th{text-align:left}' +
    'thead th{background:#f3f3f3}tr.all{background:#f7f7f7}ul{padding-left:20px}</style></head><body>' +
    `<h1>Holler metro scorecard</h1><p>Cards created in the last ${r.windowDays} days, since ${esc(r.since)}; probation samples over ${r.sampleWindowDays} days. Generated ${esc(r.generatedAt)}.</p>` +
    (bad.length ? `<p><strong>Not fully read:</strong> ${bad.join(', ')} (blank, not zero).</p>` : '') +
    r.metros.map(metroBlock).join('') +
    `<h2>Outside the 10 metros</h2><table><thead><tr><th>Cards</th>${OPPORTUNITY_LABELS.map((l) => `<th>${esc(OPPORTUNITY_CHIP[l])}</th>`).join('')}<th>Alerted</th><th>With a contact path</th><th>Contact share</th></tr></thead><tbody><tr>${cells(r.outside)}</tr></tbody></table>` +
    `<p>National sources: ${r.national ? sourcesLine(r.national).replace('Sources: ', '') : 'blank (states could not be read).'}</p>` +
    (r.notes.length ? `<h2>Notes</h2><ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '') +
    '</body></html>'
  );
}
