export interface DigestItem {
  kind: string;
  title: string;
  place?: string | null;
  occurredAt: string;
  sourceUrl?: string | null;
}

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

const KIND_LABELS: Record<string, string> = {
  ask: 'Someone is asking',
  alert: 'Weather alert',
  report: 'Storm report',
  permit: 'Building permit',
  civic: 'City data',
  contract: 'Federal contract',
  event: 'Big event',
  disaster: 'Disaster declaration',
  quake: 'Earthquake',
  travel: 'Airport delays',
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? 'Local signal';
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) URLs are allowed into href attributes. */
function safeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  return /^https?:\/\//i.test(u) ? u : null;
}

/** Text we show must never contain an em dash (house copy rule), including text from sources. */
function noDash(s: string): string {
  return s.replace(/—/g, '-');
}

export function timeAgo(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.max(0, Math.round((now.getTime() - t) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

const WRAP_OPEN =
  '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#16181D;background:#FBFAF7;line-height:1.5">';
const WRAP_CLOSE = '</div>';

function button(href: string, label: string): string {
  return `<p style="margin:20px 0"><a href="${escapeHtml(href)}" style="background:#E8590C;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:999px;display:inline-block;font-weight:600">${escapeHtml(label)}</a></p>`;
}

export function renderDigest(opts: {
  businessName: string;
  items: DigestItem[];
  totalCount?: number;
  appUrl: string;
  unsubscribeUrl: string;
  now?: Date;
}): Rendered {
  const now = opts.now ?? new Date();
  const total = opts.totalCount ?? opts.items.length;
  const more = Math.max(0, total - opts.items.length);
  const subject = noDash(
    total === 1
      ? `1 new thing near you: ${opts.items[0]?.title ?? 'local signal'}`.slice(0, 120)
      : `${total} new things near you`,
  );

  const htmlItems = opts.items
    .map((it) => {
      const src = safeUrl(it.sourceUrl);
      const meta = [kindLabel(it.kind), it.place ? noDash(it.place) : null, timeAgo(it.occurredAt, now)]
        .filter(Boolean)
        .map((m) => escapeHtml(m as string))
        .join(' &middot; ');
      return `<li style="margin:0 0 16px 0;padding:0;list-style:none"><div style="font-size:12px;color:#5D6470">${meta}</div><div style="font-size:16px;font-weight:600;margin:2px 0">${escapeHtml(noDash(it.title))}</div>${
        src ? `<a href="${escapeHtml(src)}" style="color:#E8590C;font-size:14px">Open source</a>` : ''
      }</li>`;
    })
    .join('');

  const html =
    WRAP_OPEN +
    `<p style="margin:0 0 4px 0;font-size:14px;color:#5D6470">Holler for ${escapeHtml(noDash(opts.businessName))}</p>` +
    `<h1 style="font-size:22px;margin:0 0 20px 0">${escapeHtml(subject)}</h1>` +
    `<ul style="margin:0;padding:0">${htmlItems}</ul>` +
    (more > 0 ? `<p style="color:#5D6470">Plus ${more} more in your feed.</p>` : '') +
    button(opts.appUrl, 'Open your feed') +
    `<p style="font-size:12px;color:#5D6470;margin-top:32px">You get this because email alerts are on for your Holler account. <a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#5D6470">Turn off email alerts</a>.</p>` +
    WRAP_CLOSE;

  const textItems = opts.items
    .map((it) => {
      const src = safeUrl(it.sourceUrl);
      const meta = [kindLabel(it.kind), it.place ? noDash(it.place) : null, timeAgo(it.occurredAt, now)]
        .filter(Boolean)
        .join(' | ');
      return `${meta}\n${noDash(it.title)}${src ? `\n${src}` : ''}`;
    })
    .join('\n\n');
  const text =
    `Holler for ${noDash(opts.businessName)}\n\n${subject}\n\n${textItems}\n\n` +
    (more > 0 ? `Plus ${more} more in your feed.\n\n` : '') +
    `Open your feed: ${opts.appUrl}\n\nTurn off email alerts: ${opts.unsubscribeUrl}\n`;

  return { subject, html, text };
}

export function renderPasswordReset(opts: { resetUrl: string }): Rendered {
  const subject = 'Reset your Holler password';
  const html =
    WRAP_OPEN +
    `<h1 style="font-size:22px;margin:0 0 12px 0">Reset your password</h1>` +
    `<p>Someone asked to reset the password for this Holler account. If that was you, use the button below. The link works once and expires soon.</p>` +
    button(opts.resetUrl, 'Choose a new password') +
    `<p style="font-size:14px;color:#5D6470">If you did not ask for this, ignore this email. Your password stays the same.</p>` +
    WRAP_CLOSE;
  const text = `Reset your Holler password\n\nSomeone asked to reset the password for this account. If that was you, open this link. It works once and expires soon.\n\n${opts.resetUrl}\n\nIf you did not ask for this, ignore this email. Your password stays the same.\n`;
  return { subject, html, text };
}

export function renderWelcome(opts: { businessName: string; appUrl: string; trialDays?: number }): Rendered {
  const days = opts.trialDays ?? 7;
  const subject = 'Welcome to Holler';
  const html =
    WRAP_OPEN +
    `<h1 style="font-size:22px;margin:0 0 12px 0">Welcome, ${escapeHtml(noDash(opts.businessName))}</h1>` +
    `<p>Holler watches public data near you and emails you when something matches what you do: storms, permits, 311 complaints, people asking for a recommendation. Scans run every 15 to 60 minutes.</p>` +
    `<p>Your ${days}-day free trial has started. No card needed. Holler never posts anything for you.</p>` +
    button(opts.appUrl, 'Open your feed') +
    WRAP_CLOSE;
  const text = `Welcome, ${noDash(opts.businessName)}\n\nHoller watches public data near you and emails you when something matches what you do: storms, permits, 311 complaints, people asking for a recommendation. Scans run every 15 to 60 minutes.\n\nYour ${days}-day free trial has started. No card needed. Holler never posts anything for you.\n\nOpen your feed: ${opts.appUrl}\n`;
  return { subject, html, text };
}
