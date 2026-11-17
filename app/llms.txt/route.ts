import { STATES, citiesInState, CITIES } from '@/lib/geo';
import { absoluteUrl } from '@/lib/seo/canonical';
import { withPublicPages } from '@/lib/seo/llms-extra';
import { llmsText } from '@/lib/seo/public-copy';

export function GET() {
  const states = STATES.filter((s) => citiesInState(s.code).length > 0).map((s) => ({ name: s.name, slug: s.slug }));
  const base = llmsText({ cityCount: CITIES.length, states, url: absoluteUrl });
  return new Response(withPublicPages(base, absoluteUrl), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
