import { escapeHtml } from '@/lib/email/templates';
import { postalFooterHtml, postalFooterText } from '@/lib/legal/email-footer';
import type { AlertKind } from './budget';

/**
 * Owner email for the AI spend cap (sent to ADMIN_EMAIL, else SUPPORT_EMAIL). Internal operations mail to the operator, like the
 * daily health report: it is not sent to members, so it carries the postal footer but no member unsubscribe link.
 * Every figure comes from holler_ai_spend (spent) and AI_MONTHLY_CAP_USD (cap).
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthName(month: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(month);
  if (!m) return month;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

const usd = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

export function renderAiSpendAlert(o: { kind: AlertKind; month: string; spentUsd: number; capUsd: number; model?: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const when = monthName(o.month);
  const pct = o.capUsd > 0 ? Math.floor((o.spentUsd / o.capUsd) * 100) : 100;
  let subject: string;
  let paras: string[];
  if (o.kind === 'alert_price') {
    subject = `Holler AI step is off: the model has no price`;
    paras = [
      `AI_CLASSIFY_MODEL is set to ${o.model ?? 'a model'}, which is not in the price table in lib/ai/budget.ts.`,
      `The AI step does not run without a price, because the monthly cap could not be checked.`,
      `Alerts still go out with the trades the keyword rules picked, so members still hear about new records near them.`,
      `Unset AI_CLASSIFY_MODEL, or add that model and its real prices to the table, then redeploy.`,
      `This email comes once a day at most.`,
    ];
  } else if (o.kind === 'alert_80') {
    subject = `Holler AI spend is at ${pct}% of the monthly cap`;
    paras = [
      `Holler AI spend for ${when} is ${usd(o.spentUsd)} of the ${usd(o.capUsd)} monthly cap.`,
      `That is ${pct}% of the cap.`,
      `The AI step reads new public records once an hour, sorts each one by trade, and writes the short note that members see on their feed cards and in the email digest.`,
      `At the cap it stops by itself.`,
      `Alerts keep going out after that with the trades the keyword rules picked, so members still hear about new records near them.`,
      `To change the cap, set AI_MONTHLY_CAP_USD on Vercel and redeploy.`,
      `This email comes once a month at most.`,
    ];
  } else {
    subject = `Holler AI step paused: monthly cap reached`;
    paras = [
      `Holler AI spend for ${when} reached the ${usd(o.capUsd)} monthly cap, with ${usd(o.spentUsd)} booked so far.`,
      `The AI step is paused.`,
      `New records keep the trades the keyword rules gave them, so member alerts still go out as usual for every area and every trade, and nothing breaks for members while the step waits.`,
      `Only the short AI notes stop, for records that arrive from now on.`,
      `It starts again by itself on the first day of next month.`,
      `To resume sooner, raise AI_MONTHLY_CAP_USD on Vercel and redeploy.`,
      `This email comes once a month at most.`,
    ];
  }
  const text = `${subject}\n\n${paras.join('\n\n')}\n\n${postalFooterText()}\n`;
  const html =
    '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#191714;background:#FAF6EE;line-height:1.5">' +
    `<h1 style="font-size:20px;margin:0 0 16px 0">${escapeHtml(subject)}</h1>` +
    paras.map((p) => `<p style="margin:0 0 12px 0">${escapeHtml(p)}</p>`).join('') +
    postalFooterHtml() +
    '</div>';
  return { subject, text, html };
}
