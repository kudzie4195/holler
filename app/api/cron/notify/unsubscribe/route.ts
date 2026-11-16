import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { verifyUnsubscribeToken } from '@/lib/email/token';
import { escapeHtml } from '@/lib/email/templates';

export const dynamic = 'force-dynamic';

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#FBFAF7;color:#16181D;margin:0;padding:48px 24px"><main style="max-width:480px;margin:0 auto"><h1 style="font-size:24px;letter-spacing:-0.02em">${escapeHtml(title)}</h1><p style="color:#5D6470;line-height:1.5">${escapeHtml(body)}</p><p><a href="/app/settings" style="color:#E8590C">Email settings</a></p></main></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('t') ?? '';
  const userId = env.CRON_SECRET ? verifyUnsubscribeToken(token, env.CRON_SECRET) : null;
  if (!userId) return page('Link not valid', 'This unsubscribe link is not valid. You can turn off email alerts in your settings.', 400);
  const { error } = await createAdminClient().from('holler_profiles').update({ alert_email: false }).eq('user_id', userId);
  if (error) return page('Something went wrong', 'We could not update your settings. Try again, or turn off email alerts in your settings.', 500);
  return page('Email alerts are off', 'You will not get Holler emails anymore. You can turn them back on in settings any time.');
}
