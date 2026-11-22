import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateDraft } from '@/lib/ai/draft';
import { computeAccess } from '@/lib/auth/access';
import { hit, LIMITS } from '@/lib/auth/ratelimit';
import { HOLLER_REQUEST_SOURCE } from '@/lib/signals/request-visibility';
import { originAllowed } from '@/lib/auth/origin';
import { siteUrl } from '@/lib/env';

// Reply drafts: the model is called only when a signed-in member with access (trial or plan, computeAccess) asks for a draft of an
// "ask" record matched to them, under the same monthly AI cap as the cron classification step (lib/ai/draft.ts). Classification
// itself runs only from cron.
export const maxDuration = 30;

const Body = z.object({ matchId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number)]) });

interface SignalRow {
  source: string;
  kind: string;
  title: string;
  summary: string | null;
  city: string | null;
}

export async function POST(req: Request) {
  // SEC-5: JSON only (a cross-site form or a no-cors text/plain fetch cannot send it) and same-origin when the browser says where it
  // came from. Before this the route parsed any body type and leaned on SameSite=Lax alone to stop cross-site calls on the AI budget.
  if (!(req.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    return Response.json({ error: 'unsupported' }, { status: 415 });
  }
  if (!originAllowed(req, siteUrl)) return Response.json({ error: 'forbidden' }, { status: 403 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'bad_request' }, { status: 400 });
  const matchId = parsed.data.matchId;

  const { data: match, error } = await supabase
    .from('holler_matches')
    .select('id, user_id, signal:holler_signals(source, kind, title, summary, city)')
    .eq('id', matchId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) return Response.json({ error: 'lookup_failed' }, { status: 500 });
  if (!match) return Response.json({ error: 'not_found' }, { status: 404 });

  const raw = match.signal as unknown as SignalRow | SignalRow[] | null;
  const signal = Array.isArray(raw) ? raw[0] : raw;
  if (!signal) return Response.json({ error: 'not_found' }, { status: 404 });
  // A resident's request (made on /request) is never sent to the AI model: businesses answer it in their own words through the
  // Reply box. Checked before anything else is read or counted.
  if (signal.source === HOLLER_REQUEST_SOURCE) return Response.json({ error: 'resident_request' }, { status: 400 });
  if (signal.kind !== 'ask') return Response.json({ error: 'not_an_ask' }, { status: 400 });

  // '*': the access columns from 0020 (plan_source, store_expires_at) may not exist yet, and computeAccess treats them as optional.
  const { data: profile } = await supabase.from('holler_profiles').select('*').eq('user_id', user.id).maybeSingle();
  if (!profile) return Response.json({ error: 'no_profile' }, { status: 400 });
  // A locked account (trial over, no plan) gets no AI drafts. Checked before the limiter, so nothing is counted.
  if (computeAccess(profile).locked) {
    return Response.json(
      { error: 'locked', message: 'Your trial or plan has ended. Pick a plan to get reply drafts again.' },
      { status: 403 },
    );
  }

  // AI cost path: 20 drafts per hour per user. Fails closed if the limiter is down.
  const limited = await hit([LIMITS.draftUser(user.id)]);
  if (limited === 'limited') {
    return Response.json(
      { error: 'rate_limited', message: "You've used 20 drafts this hour. Try again in a bit." },
      { status: 429, headers: { 'Retry-After': '3600' } },
    );
  }
  if (limited === 'error') {
    return Response.json({ error: 'unavailable', message: 'Drafts are unavailable right now. Try again in a moment.' }, { status: 503 });
  }

  // Service role: the draft is booked in holler_ai_spend, and `draft` is not in the authenticated role's column grants.
  const admin = createAdminClient();
  const out = await generateDraft(
    {
      businessName: profile.business_name,
      categories: profile.categories ?? [],
      title: signal.title,
      summary: signal.summary,
      city: profile.city ?? signal.city,
    },
    { db: admin },
  );
  if (!out.ok) {
    return out.reason === 'cap_reached'
      ? Response.json(
          { error: 'ai_paused', message: 'Reply drafts are paused until next month. You can still write your own reply.' },
          { status: 503 },
        )
      : Response.json({ error: 'unavailable', message: 'Drafts are unavailable right now. Try again in a moment.' }, { status: 503 });
  }
  const { draft } = out;

  // Ownership was verified above (match selected with user_id = user.id).
  const { error: upErr } = await admin
    .from('holler_matches')
    .update({ draft })
    .eq('id', matchId)
    .eq('user_id', user.id);
  if (upErr) return Response.json({ error: 'save_failed' }, { status: 500 });
  return Response.json({ draft });
}
