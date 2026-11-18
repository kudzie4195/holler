import { STATES, citiesInState, CITIES } from '@/lib/geo';
import { absoluteUrl } from '@/lib/seo/canonical';
import { withPublicPages } from '@/lib/seo/llms-extra';
import { llmsText } from '@/lib/seo/public-copy';

export function GET() {
  const states = STATES.filter((s) => citiesInState(s.code).length > 0).map((s) => ({ name: s.name, slug: s.slug }));
  const base = llmsText({ cityCount: CITIES.length, states, url: absoluteUrl });
  const storms = `- [Storm reports](${absoluteUrl('/storms')}): counties with at least 3 hail, wind or tornado reports from the NOAA Storm Prediction Center in one day, and FEMA storm declarations, from the last 60 days, each page with its source records.`;
  return new Response(`${withPublicPages(base, absoluteUrl).replace(/\n*$/, '\n')}\n## Storm reports\n\n${storms}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
