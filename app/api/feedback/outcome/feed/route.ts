import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getUser } from '@/lib/auth/session';
import { hasPendingAsk, isFeedAnswer, recordOutcome } from '@/lib/moat/outcome';

/** Is there a follow-up question for this alert? The member's own session (RLS shows own rows only). Fails soft: pending false. */
export async function GET(req: Request) {
  const signalId = Number(new URL(req.url).searchParams.get('signal'));
  const headers = { 'cache-control': 'no-store' };
  if (!Number.isSafeInteger(signalId) || signalId <= 0) return Response.json({ pending: false }, { headers });
  try {
    const user = await getUser();
    if (!user) return Response.json({ pending: false }, { headers });
    return Response.json({ pending: await hasPendingAsk(await createClient(), user.id, signalId) }, { headers });
  } catch {
    return Response.json({ pending: false }, { headers });
  }
}

/** Answers from the feed card. JSON only (a cross-site form cannot send it), signed-in member only, own ask only. */
export async function POST(req: Request) {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return Response.json({ ok: false }, { status: 415 });
  }
  const body = (await req.json().catch(() => null)) as { signalId?: unknown; answer?: unknown } | null;
  const signalId = body?.signalId;
  if (typeof signalId !== 'number' || !Number.isSafeInteger(signalId) || signalId <= 0 || !isFeedAnswer(body?.answer)) {
    return Response.json({ ok: false }, { status: 400 });
  }
  try {
    const user = await getUser();
    if (!user) return Response.json({ ok: false }, { status: 401 });
    const r = await recordOutcome(createAdminClient(), user.id, signalId, body.answer as string);
    if (r === 'recorded' || r === 'already') return Response.json({ ok: true, result: r, answer: body.answer });
    return Response.json({ ok: false }, { status: r === 'none' ? 404 : 500 });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
