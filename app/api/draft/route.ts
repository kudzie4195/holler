import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { generateDraft } from '@/lib/ai/draft';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const Body = z.object({ matchId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number)]) });

interface SignalRow {
  kind: string;
  title: string;
  summary: string | null;
  city: string | null;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'bad_request' }, { status: 400 });
  const matchId = parsed.data.matchId;

  const { data: match, error } = await supabase
    .from('holler_matches')
    .select('id, user_id, signal:holler_signals(kind, title, summary, city)')
    .eq('id', matchId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) return Response.json({ error: 'lookup_failed' }, { status: 500 });
  if (!match) return Response.json({ error: 'not_found' }, { status: 404 });

  const raw = match.signal as unknown as SignalRow | SignalRow[] | null;
  const signal = Array.isArray(raw) ? raw[0] : raw;
  if (!signal) return Response.json({ error: 'not_found' }, { status: 404 });
  if (signal.kind !== 'ask') return Response.json({ error: 'not_an_ask' }, { status: 400 });

  const { data: profile } = await supabase
    .from('holler_profiles')
    .select('business_name, categories, city')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile) return Response.json({ error: 'no_profile' }, { status: 400 });

  const { draft } = await generateDraft({
    businessName: profile.business_name,
    categories: profile.categories ?? [],
    title: signal.title,
    summary: signal.summary,
    city: profile.city ?? signal.city,
  });

  const { error: upErr } = await supabase
    .from('holler_matches')
    .update({ draft })
    .eq('id', matchId)
    .eq('user_id', user.id);
  if (upErr) return Response.json({ error: 'save_failed' }, { status: 500 });
  return Response.json({ draft });
}
