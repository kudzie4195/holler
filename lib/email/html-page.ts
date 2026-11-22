import { escapeHtml } from './templates';
import { EMAIL_COLORS as C, EMAIL_FONTS as F, EMAIL_STYLE as S, PRIMARY_BUTTON_STYLE, emailHeader } from './theme';

interface PageOptions {
  /** Optional POST form shown under the text (confirm-by-button pages). Hidden fields are escaped. */
  form?: { action: string; button: string; fields?: Record<string, string> };
  links?: { href: string; label: string }[];
  status?: number;
  /** Language of the page (round 18 ES). Only sets <html lang>; English pages are unchanged. */
  lang?: 'en' | 'es';
}

/** Minimal standalone HTML page for token links (unsubscribe, verify). Every dynamic string is escaped. */
export function htmlPage(title: string, body: string, opts: PageOptions = {}): Response {
  const form = opts.form
    ? `<form method="POST" action="${escapeHtml(opts.form.action)}" style="margin:24px 0">${Object.entries(opts.form.fields ?? {})
        .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
        .join('')}<button type="submit" style="${PRIMARY_BUTTON_STYLE};border:0;cursor:pointer">${escapeHtml(opts.form.button)}</button></form>`
    : '';
  const links = (opts.links ?? [])
    .map((l) => `<p><a href="${escapeHtml(l.href)}" style="${S.link};display:inline-flex;align-items:center;min-height:44px">${escapeHtml(l.label)}</a></p>`)
    .join('');
  const html = `<!doctype html><html lang="${opts.lang ?? 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head><body style="font-family:${F.body};background:${C.paper};color:${C.ink};margin:0;padding:48px 16px"><main style="max-width:480px;margin:0 auto">${emailHeader()}<div style="background:${C.surface};border:1px solid ${C.line};border-top:0;border-radius:0 0 10px 10px;padding:24px 20px"><h1 style="${S.h1};font-size:28px;margin:0 0 12px 0">${escapeHtml(title)}</h1><p style="color:${C.muted};line-height:1.5">${escapeHtml(body)}</p>${form}${links}</div></main></body></html>`;
  return new Response(html, {
    status: opts.status ?? 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex',
    },
  });
}
