import type { QualityReport, TradeQuality } from './quality';
import { aiCoverageLine, type AiCoverage } from './ai-coverage';
import type { DuplicateReport } from '@/lib/signals/dedupe-metrics';
import type { ContactPathReport } from './contact-path';
import { HELD_MIN_CARDS, HELD_SHARE_FLAG, type HeldPermitReport } from './held-permits';

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
  const head = `<h2>Duplicate listings per source (last ${d.windowDays} days)</h2>`;
  if (d.status === 'unavailable') return `${head}<p>Not recorded: ${esc(d.reason ?? 'unavailable')} (blank, not zero).</p>`;
  if (d.bySource.length === 0) return `${head}<p>No duplicate listings since ${esc(d.since)}.</p>`;
  const rows = d.bySource
    .map((r) => `<tr><th scope="row">${esc(r.source)}</th><td>${r.duplicates}</td><td>${r.corroborations}</td><td>${r.stored === null ? 'blank' : r.stored}</td><td>${r.rate === null ? 'blank' : pct(r.rate)}</td></tr>`)
    .join('');
  return (
    `${head}<p>${d.totals.duplicates} stored as another listing of a project the same source already had, ${d.totals.corroborations} stored as corroboration from another source: none makes a second card. Rate = duplicate listings / rows stored.</p>` +
    `<table><thead><tr><th>Source</th><th>Duplicate listing (no second card)</th><th>Stored as corroboration</th><th>Stored</th><th>Duplicate rate</th></tr></thead><tbody>${rows}</tbody></table>`
  );
}

/** Round 18: share of alerted cards in the last 7 days that had a contact path (a named business or a job-site street address), per trade. */
function contactPathBlock(c: (ContactPathReport & { partial?: boolean }) | undefined): string {
  if (!c) return '';
  const head = `<h2>Alerts with a contact path (last ${c.windowDays} days)</h2>`;
  if (c.status === 'unavailable') return `${head}<p>Unavailable (blank, not zero).</p>`;
  if (c.all.alerted === 0) return `${head}<p>No alerted cards logged since ${esc(c.since)}.</p>`;
  const line = (x: ContactPathReport['all']) => `<tr><th scope="row">${esc(x.trade)}</th><td>${x.alerted}</td><td>${x.withPath}</td><td>${pct(x.share)}</td></tr>`;
  return (
    `${head}<p>An alert has a contact path when it names a business or gives a job-site street address: it tells the member who to call or where to go.${c.partial ? ' Partial: the row limit was reached, only the newest alerts are counted.' : ''}</p>` +
    `<table><thead><tr><th>Trade</th><th>Alerted</th><th>With a contact path</th><th>Share</th></tr></thead><tbody>${line(c.all)}${c.trades.map(line).join('')}</tbody></table>`
  );
}

/**
 * Round 18 integration: permit cards held as Background by the contact gate, per source (last 7 days). A source over 80% with at least 10
 * cards is flagged with the owner line. Nothing at all when the gate is off (migration 0027 not applied).
 */
export function heldPermitsBlock(h: (HeldPermitReport & { partial?: boolean }) | undefined): string {
  if (!h || h.status === 'off') return '';
  const head = `<h2>Permit cards held for no contact path (last ${h.windowDays} days)</h2>`;
  if (h.status === 'unavailable') return `${head}<p>Unavailable (blank, not zero).</p>`;
  if (h.sources.length === 0) return `${head}<p>No alert-eligible permit cards since ${esc(h.since)}.</p>`;
  const flagged = h.lines.length ? `<ul>${h.lines.map((l) => `<li><strong>${esc(l)}</strong></li>`).join('')}</ul>` : '<p>No source over the line.</p>';
  const line = (x: HeldPermitReport['sources'][number]) =>
    `<tr${x.cards >= HELD_MIN_CARDS && x.share > HELD_SHARE_FLAG ? ' class="bad"' : ''}><th scope="row">${esc(x.source)}</th><td>${x.cards}</td><td>${x.held}</td><td>${pct(x.share)}</td></tr>`;
  return (
    `${head}<p>A permit card with no named business and no job-site street address stays in the feed as Background. A source is flagged when more than ${Math.round(HELD_SHARE_FLAG * 100)}% of at least ${HELD_MIN_CARDS} cards were held: its site-address field is probably empty or no longer read.${h.partial ? ' Partial: the row limit was reached.' : ''}</p>` +
    flagged +
    `<table><thead><tr><th>Source</th><th>Permit cards</th><th>Held as Background</th><th>Share held</th></tr></thead><tbody>${h.sources.map(line).join('')}</tbody></table>`
  );
}

export function renderQualityHtml(r: QualityReport, ai?: AiCoverage, contactPaths?: ContactPathReport & { partial?: boolean }, heldPermits?: HeldPermitReport & { partial?: boolean }): string {
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
    (ai ? `<p>${esc(aiCoverageLine(ai))}</p>` : '') +
    (unavailable.length ? `<p><strong>Unavailable reads:</strong> ${unavailable.join(', ')} (blank, not zero).</p>` : '') +
    (partial.length ? `<p><strong>Partial reads:</strong> ${partial.join(', ')} (row limit reached: only the newest rows are counted).</p>` : '') +
    (r.belowTarget.length ? `<p><strong>Below target:</strong> ${r.belowTarget.map(esc).join(', ')}</p>` : '') +
    `<table><thead>${head}</thead><tbody>${row(r.all, r.target)}${r.trades.map((t) => row(t, r.target)).join('')}</tbody></table>` +
    '<p>* fewer than 10 answers: small sample. "Sent" = emailed (holler_alert_log.emailed_at). "Not relevant" is what members told us, not proof the record was wrong. Time to first card counts any card in the feed that is Act now or Coming soon for one of the member&#39;s trades.</p>' +
    duplicatesBlock(r.duplicates) +
    contactPathBlock(contactPaths) +
    heldPermitsBlock(heldPermits) +
    (r.notes.length ? `<h2>Notes</h2><ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '') +
    '</body></html>'
  );
}
