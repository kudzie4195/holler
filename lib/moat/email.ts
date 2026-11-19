import { escapeHtml, kindLabel, contactAddress, timeAgo } from '@/lib/email/templates';
import { postalFooterHtml, postalFooterText } from '@/lib/legal/email-footer';
import { EMAIL_STYLE, PRIMARY_BUTTON_STYLE, SECONDARY_BUTTON_STYLE, cardClose, wrapOpen, WRAP_CLOSE } from '@/lib/email/theme';

const S = EMAIL_STYLE;

export interface FollowUpItem {
  title: string;
  kind: string;
  place: string | null;
  occurredAt: string;
  yesUrl: string;
  noUrl: string;
}

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

const noDash = (s: string) => s.replace(/[–—]/g, '-');

export const FOLLOWUP_SUBJECT = 'Did any of these alerts lead to work?';
export const FOLLOWUP_INTRO = [
  'About a week ago you marked the alerts below as useful, and we would like to know how they turned out.',
  'Did any of them lead to work?',
  'Tap Yes or No under each one.',
  'It takes a few seconds per alert, and you do not need to log in or know your password to answer.',
  'Your answers help us learn which kinds of alerts pay off for people in your trade.',
];
export const FOLLOWUP_OUTRO = ['That is all.'];

function link(href: string, label: string, primary: boolean): string {
  const style = primary
    ? `${PRIMARY_BUTTON_STYLE};margin-right:8px`
    : SECONDARY_BUTTON_STYLE;
  return `<a href="${escapeHtml(href)}" style="${style}">${escapeHtml(label)}</a>`;
}

export function renderFollowUp(opts: { businessName: string; items: FollowUpItem[]; unsubscribeUrl: string; now?: Date }): Rendered {
  const now = opts.now ?? new Date();
  const items = opts.items.slice(0, 5);
  const contact = contactAddress();
  const html =
    wrapOpen() +
    `<p style="margin:0 0 6px 0;${S.eyebrow}">Holler for ${escapeHtml(noDash(opts.businessName))}</p>` +
    `<h1 style="${S.h1};font-size:24px;margin:0 0 16px 0">${escapeHtml(FOLLOWUP_SUBJECT)}</h1>` +
    `<p>${FOLLOWUP_INTRO.map(escapeHtml).join(' ')}</p>` +
    `<ul style="margin:16px 0;padding:0">${items
      .map(
        (it) =>
          `<li style="margin:0 0 20px 0;padding:0;list-style:none"><div style="${S.small}">${escapeHtml(
            [kindLabel(it.kind), it.place ? noDash(it.place) : null, timeAgo(it.occurredAt, now)].filter(Boolean).join(' | '),
          )}</div><div style="font-size:16px;font-weight:600;margin:2px 0 10px 0">${escapeHtml(noDash(it.title))}</div>${link(it.yesUrl, 'Yes', true)}${link(it.noUrl, 'No', false)}</li>`,
      )
      .join('')}</ul>` +
    `<p>${FOLLOWUP_OUTRO.map(escapeHtml).join(' ')}</p>` +
    `<p style="${S.small};margin-top:32px">You get this because email alerts are on for your Holler account. <a href="${escapeHtml(opts.unsubscribeUrl)}" style="${S.mutedLink}">Turn off email alerts</a>.${
      contact ? ` Questions? <a href="mailto:${escapeHtml(contact)}" style="${S.mutedLink}">Contact us</a>.` : ''
    }</p>` +
    cardClose() +
    postalFooterHtml() +
    WRAP_CLOSE;
  const text =
    `Holler for ${noDash(opts.businessName)}\n\n${FOLLOWUP_SUBJECT}\n\n${FOLLOWUP_INTRO.join(' ')}\n\n` +
    items
      .map(
        (it) =>
          `${[kindLabel(it.kind), it.place ? noDash(it.place) : null, timeAgo(it.occurredAt, now)].filter(Boolean).join(' | ')}\n${noDash(it.title)}\nYes: ${it.yesUrl}\nNo: ${it.noUrl}`,
      )
      .join('\n\n') +
    `\n\n${FOLLOWUP_OUTRO.join(' ')}\n\nTurn off email alerts: ${opts.unsubscribeUrl}\n${contact ? `Questions? Contact us: ${contact}\n` : ''}\n${postalFooterText()}\n`;
  return { subject: FOLLOWUP_SUBJECT, html, text };
}
