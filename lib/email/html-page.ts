import { escapeHtml } from './templates';

interface PageOptions {
  /** Optional POST form shown under the text (confirm-by-button pages). Hidden fields are escaped. */
  form?: { action: string; button: string; fields?: Record<string, string> };
  links?: { href: string; label: string }[];
  status?: number;
}

/** Minimal standalone HTML page for token links (unsubscribe, verify). Every dynamic string is escaped. */
export function htmlPage(title: string, body: string, opts: PageOptions = {}): Response {
  const form = opts.form
    ? `<form method="POST" action="${escapeHtml(opts.form.action)}" style="margin:24px 0">${Object.entries(opts.form.fields ?? {})
        .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
        .join('')}<button type="submit" style="background:#E8590C;color:#16181D;border:0;border-radius:999px;padding:12px 22px;font-size:16px;font-weight:600;min-height:44px;cursor:pointer">${escapeHtml(opts.form.button)}</button></form>`
    : '';
  const links = (opts.links ?? [])
    .map((l) => `<p><a href="${escapeHtml(l.href)}" style="color:#E8590C">${escapeHtml(l.label)}</a></p>`)
    .join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#FBFAF7;color:#16181D;margin:0;padding:48px 24px"><main style="max-width:480px;margin:0 auto"><h1 style="font-size:24px;letter-spacing:-0.02em">${escapeHtml(title)}</h1><p style="color:#5D6470;line-height:1.5">${escapeHtml(body)}</p>${form}${links}</main></body></html>`;
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
