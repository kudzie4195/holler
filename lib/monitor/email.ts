import { escapeHtml } from '../email/templates';
import { formatAge } from '../email/health';
import { postalFooterHtml, postalFooterText } from '../legal/email-footer';
import { sanitizeHealthError } from '../signals/health';
import { recoveredLine, sortConditions, type Condition } from './rules';

/**
 * The ingest alert email. It is a note to the owner, not to a member, so it has no unsubscribe link: ADMIN_EMAIL is set by the owner.
 * It still carries the postal footer. Only source ids, times, counts and errors already cleaned by sanitizeHealthError go in; no
 * signal titles, no summaries, no addresses, nothing from a row.
 */

export const MAX_CONDITION_LINES = 20;
const ERROR_MAX = 200;

export interface MonitorEmail {
  subject: string;
  text: string;
  html: string;
}

/** "2026-11-18 12:11 UTC, which was 26 h ago", or null when there is no usable time. */
function when(iso: string | null, now: Date): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const d = new Date(t).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)} UTC, which was ${formatAge(Math.max(0, now.getTime() - t))} ago`;
}

/** The source id and the last success time as one plain sentence. */
function successSentence(c: Condition, now: Date): string {
  const w = when(c.lastSuccessAt, now);
  const who = c.code.startsWith('scan_') ? 'The last clean scan' : c.code === 'feed_silent' ? 'The last new signal' : `Source ${c.source}`;
  const verb = c.code.startsWith('source_') ? 'last had a good fetch' : c.code === 'feed_silent' ? 'arrived' : 'finished';
  return w ? `${who} ${verb} at ${w}.` : `${who} has no success on record in the last 24 hours.`;
}

function errorSentence(e: string | null): string {
  const s = errorText(e);
  return s === 'none recorded' ? 'No error text was recorded.' : `The last error recorded was: ${s}`;
}

/** Cleans again at the edge so a condition built by hand still cannot carry row data into the email. */
function errorText(e: string | null): string {
  const s = e ? sanitizeHealthError(e) : null;
  return s ? s.replace(/—|–/g, '-').slice(0, ERROR_MAX) : 'none recorded';
}

/** Source ids are lower case names and keep their spelling; the whole-pipeline headlines start with a capital. */
function heading(c: Condition): string {
  return c.code.startsWith('source_') ? c.headline : c.headline[0].toUpperCase() + c.headline.slice(1);
}

/** stillOpen: active problems already emailed in the last 24 hours and not listed again (lib/monitor/rules.ts planAlerts). */
export function monitorSubject(items: Condition[], recoveredCount: number, stillOpen = 0): string {
  const sorted = sortConditions(items);
  if (sorted.length === 0) {
    if (recoveredCount > 0) return stillOpen > 0 ? 'Holler ingest: partly recovered' : 'Holler ingest: recovered';
    return 'Holler ingest: all clear';
  }
  const more = sorted.length - 1;
  return `Holler ingest: ${sorted[0].headline}${more > 0 ? ` (and ${more} more)` : ''}`;
}

export function renderMonitorEmail(input: { items: Condition[]; recovered: string[]; now: Date; sourcesUrl: string; stillOpen?: number }): MonitorEmail {
  const { now } = input;
  const stillOpen = input.stillOpen ?? 0;
  const items = sortConditions(input.items);
  const shown = items.slice(0, MAX_CONDITION_LINES);
  const subject = monitorSubject(items, input.recovered.length, stillOpen);

  const intro =
    items.length > 0
      ? 'Ingest needs a look. Details follow.'
      : stillOpen > 0
        ? 'Some of what was wrong is fine again.'
        : 'Everything that was wrong is fine again.';
  // Problems emailed in the last 24 hours that are still open are not listed again, only counted.
  const openLine =
    stillOpen > 0
      ? stillOpen === 1
        ? '1 problem from an earlier email is still open. It is not listed again here.'
        : `${stillOpen} problems from earlier emails are still open. They are not listed again here.`
      : null;

  const textBlocks = shown.map((c) =>
    [
      heading(c),
      c.reason,
      successSentence(c, now),
      errorSentence(c.lastError),
    ].join('\n'),
  );
  if (items.length > shown.length) textBlocks.push(`And ${items.length - shown.length} more. The source table has the rest.`);
  const recoveredLines = input.recovered.map(recoveredLine);

  const text =
    [
      intro,
      ...textBlocks,
      ...(recoveredLines.length ? [`Recovered\n${recoveredLines.map((l) => `- ${l}`).join('\n')}`] : []),
      ...(openLine ? [openLine] : []),
      `Open the source table at ${input.sourcesUrl} with your cron secret added, and it lists every source with its current status and the last time each one worked.`,
      postalFooterText(),
    ].join('\n\n') + '\n';

  const htmlBlocks = shown.map(
    (c) =>
      `<h2 style="font-size:15px;margin:18px 0 4px 0">${escapeHtml(heading(c))}</h2>` +
      `<p style="margin:0 0 6px 0">${escapeHtml(c.reason)}</p>` +
      `<p style="margin:0 0 4px 0">${escapeHtml(successSentence(c, now))}</p><p style="margin:0">${escapeHtml(errorSentence(c.lastError))}</p>`,
  );
  if (items.length > shown.length) htmlBlocks.push(`<p>And ${items.length - shown.length} more. The source table has the rest.</p>`);
  const html =
    '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:600px;color:#191714;line-height:1.5">' +
    `<h1 style="font-size:18px;margin:0 0 12px 0">${escapeHtml(subject)}</h1>` +
    `<p style="margin:0 0 8px 0">${escapeHtml(intro)}</p>` +
    htmlBlocks.join('') +
    (recoveredLines.length
      ? `<h2 style="font-size:15px;margin:18px 0 4px 0">Recovered</h2><ul style="margin:0;padding-left:20px">${recoveredLines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
      : '') +
    (openLine ? `<p style="margin:18px 0 0 0">${escapeHtml(openLine)}</p>` : '') +
    `<p style="margin:18px 0 0 0">Open the <a href="${escapeHtml(input.sourcesUrl)}" style="color:#AD4205">source table</a> with your cron secret added, and it lists every source with its current status and the last time each one worked.</p>` +
    postalFooterHtml() +
    '</div>';

  return { subject, text, html };
}
