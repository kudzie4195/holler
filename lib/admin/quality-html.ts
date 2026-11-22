import type { QualityReport, TradeQuality } from './quality';
import type { DuplicateReport } from '@/lib/signals/dedupe-metrics';

/**
 * The alert-quality report as one self-contained HTML page for the owner. No script, no external file, no cookie, no form: a table
 * per view. Every value is escaped. The route (app/api/admin/quality) sends it noindex and no-store.
 */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const pct = (v: number | null): string => (v === null ? '-' : `${Math.round(v * 100)}%`);
const hrs = (v: number | null): string => (v === null ? '-' : `${v} h`);
const NAMES = { act_now: 'Act now', coming_soon: 'Coming soon', market_insight: 'Market insight', context: 'Context' } as const;

function row(t: TradeQuality, target: number): string {
  const s = t.sent;
  const flag = s.meetsTarget === false ? ' class="bad"' : '';
  return (
    `<tr${flag}><th scope="row">${esc(t.trade)}</th>` +
    `<td>${t.members} (${t.membersWithAccess})</td>` +
    `<td>${s.total}</td><td>${s.act_now}</td><td>${s.coming_soon}</td><td>${s.market_insight}</td><td>${s.context}</td>` +
    `<td>${pct(s.usefulShare)}${s.meetsTarget === false ? ` (target ${Math.round(target * 100)}%)` : ''}</td>` +
    `<td>${t.feedback.answered}</td><td>${pct(t.feedback.falsePositiveRate)}${t.feedback.lowSample && t.feedback.answered > 0 ? ' *' : ''}</td>` +
    `<td>${t.firstCard.newMembers}</td><td>${t.firstCard.withUsefulCard}</td><td>${t.firstCard.within24h}</td><td>${hrs(t.firstCard.medianHours)}</td><td>${hrs(t.firstCard.p90Hours)}</td>` +
    `</tr>`
  );
}

function duplicatesBlock(d: DuplicateReport | undefined): string {
  if (!d) return '';
  const head = `<h2>Duplicates dropped per source (last ${d.windowDays} days)</h2>`;
  if (d.status === 'unavailable') return `${head}<p>Not recorded: ${esc(d.reason ?? 'unavailable')} (blank, not zero).</p>`;
  if (d.bySource.length === 0) return `${head}<p>No duplicates dropped since ${esc(d.since)}.</p>`;
  const rows = d.bySource
    .map((r) => `<tr><th scope="row">${esc(r.source)}</th><td>${r.duplicates}</td><td>${r.corroborations}</td><td>${r.stored}</td><td>${pct(r.rate)}</td></tr>`)
    .join('');
  return (
    `${head}<p>${d.totals.duplicates} dropped as duplicates, ${d.totals.corroborations} stored as corroboration (no second card). Rate = duplicates / (stored + duplicates).</p>` +
    `<table><thead><tr><th>Source</th><th>Dropped as duplicate</th><th>Stored as corroboration</th><th>Stored</th><th>Duplicate rate</th></tr></thead><tbody>${rows}</tbody></table>`
  );
}

export function renderQualityHtml(r: QualityReport): string {
  const head =
    '<tr><th>Trade</th><th>Members (with access)</th><th>Sent</th>' +
    Object.values(NAMES).map((n) => `<th>${esc(n)}</th>`).join('') +
    '<th>Act now + Coming soon</th><th>Feedback answers</th><th>Not relevant</th>' +
    '<th>New members</th><th>With a useful card</th><th>Within 24 h</th><th>Median to first card</th><th>90th percentile</th></tr>';
  const sectionsWith = (status: string) => (Object.entries(r.sections) as Array<[string, string]>).filter(([, v]) => v === status).map(([k]) => esc(k));
  const unavailable = sectionsWith('unavailable');
  const partial = sectionsWith('partial');
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Holler alert quality</title>' +
    '<style>body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#111}table{border-collapse:collapse;width:100%}' +
    'th,td{border:1px solid #ccc;padding:4px 8px;text-align:right}th:first-child,thead th{text-align:left}' +
    'thead th{background:#f3f3f3;position:sticky;top:0}tr.bad{background:#fdecea}ul{padding-left:20px}</style></head><body>' +
    `<h1>Holler alert quality</h1><p>Last ${r.windowDays} days, since ${esc(r.since)}. Generated ${esc(r.generatedAt)}. Target: at least ${Math.round(r.target * 100)}% of sent alerts are Act now or Coming soon, per trade.</p>` +
    (unavailable.length ? `<p><strong>Unavailable reads:</strong> ${unavailable.join(', ')} (blank, not zero).</p>` : '') +
    (partial.length ? `<p><strong>Partial reads:</strong> ${partial.join(', ')} (row limit reached: only the newest rows are counted).</p>` : '') +
    (r.belowTarget.length ? `<p><strong>Below target:</strong> ${r.belowTarget.map(esc).join(', ')}</p>` : '') +
    `<table><thead>${head}</thead><tbody>${row(r.all, r.target)}${r.trades.map((t) => row(t, r.target)).join('')}</tbody></table>` +
    '<p>* fewer than 10 answers: small sample. "Sent" = emailed (holler_alert_log.emailed_at). "Not relevant" is what members told us, not proof the record was wrong. Time to first card counts any card in the feed that is Act now or Coming soon for one of the member&#39;s trades.</p>' +
    duplicatesBlock(r.duplicates) +
    (r.notes.length ? `<h2>Notes</h2><ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '') +
    '</body></html>'
  );
}
