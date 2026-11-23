import type { Metadata } from 'next';
import { connection } from 'next/server';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { Suspense, type ReactNode } from 'react';
import { AreaWaitlist } from '@/components/area-waitlist';
import { CheckForm } from '@/components/check-form';
import { CheckResults } from '@/components/check-results';
import { Footer } from '@/components/footer';
import { BODY_TEXT, PAGE_BOX } from '@/components/grid';
import { FamilyDot, Ledger, type Family } from '@/components/page-header';
import { TopNav } from '@/components/top-nav';
import { eventContext, trackVisitorStep } from '@/lib/analytics/request';
import { clientIp, hit } from '@/lib/auth/ratelimit';
import { isServedZip } from '@/lib/check/coverage';
import { gateCheck } from '@/lib/check/limit';
import { loadCheck } from '@/lib/check/load';
import { parseCheckParams } from '@/lib/check/params';
import { CHECK_RADIUS_LABEL, CHECK_RADIUS_MI, CHECK_WINDOW_DAYS, deriveScope } from '@/lib/check/scope';
import { tradeLabel } from '@/lib/check/trades';
import { watchList } from '@/lib/check/watch';
import { coverageNotice } from '@/lib/check/coverage-notice';
import { loadSourceStateSnapshot } from '@/lib/signals/source-state-snapshot';
import { lookupZip, nearestCity } from '@/lib/geo';
import { ES_PAIRS, pairAlternates } from '@/lib/i18n/seo';

// Only /check itself is indexed. Every ?zip=&trade= variant is noindex (tens of thousands of combinations, one canonical).
export async function generateMetadata(props: PageProps<'/check'>): Promise<Metadata> {
  const sp = await props.searchParams;
  const variant = sp.zip !== undefined || sp.trade !== undefined;
  return {
    title: 'See what happened near you',
    description:
      'Free local check. Enter a ZIP code and a trade to see recent storm reports, permits, 311 requests and more near you, with sources. No login.',
    alternates: pairAlternates(ES_PAIRS[1], 'en'),
    robots: variant ? { index: false, follow: true } : { index: true, follow: true },
  };
}

export default function CheckPage(props: PageProps<'/check'>) {
  return (
    <>
      <TopNav />
      <main id="main" className={`w-full flex-1 ${BODY_TEXT}`}>
        {/* Green header band. The form card below is pulled up over its lower edge, so the form reads as part of the header. */}
        <div className="on-brand bg-brand">
          <div className={`${PAGE_BOX} pb-24 pt-6 md:pb-28 md:pt-10`}>
            <p className="eyebrow mb-3">Free area check</p>
            <h1 className="max-w-[22ch] text-5xl sm:text-6xl md:text-7xl">See what happened near you.</h1>
            <p className="mt-4 max-w-xl text-lg text-on-brand-muted">
              Pick your trade and ZIP code. Holler shows what it recorded nearby in the last {CHECK_WINDOW_DAYS} days, with a link to every
              source. No login.
            </p>
          </div>
        </div>
        <div className={`${PAGE_BOX} -mt-16 pb-20 md:-mt-20`}>
          <div className="max-w-4xl">
            <Suspense fallback={<FormBand><CheckForm /></FormBand>}>
              <Check searchParams={props.searchParams} />
            </Suspense>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

async function Check({ searchParams }: { searchParams: PageProps<'/check'>['searchParams'] }) {
  // Opt this render into request time before the clock is read: without it Next logs "Date.now() while prerendering" on every request.
  await connection();
  const sp = await searchParams;
  const params = parseCheckParams({ zip: sp.zip, trade: sp.trade });

  if (params.status === 'empty') {
    return (
      <>
        <FormBand>
          <CheckForm />
        </FormBand>
        <CheckPreview />
      </>
    );
  }
  // The home page ZIP form sends only ?zip=. A ZIP we know is a step, not an error: the ZIP stays filled in and the page asks for
  // the trade. A ZIP we cannot find gets the same message as with a trade.
  if (params.status === 'zip') {
    const known = lookupZip(params.zip);
    return (
      <>
        <FormBand>
          <CheckForm
            zip={params.zip}
            prompt={known ? `Now pick your trade.` : undefined}
            zipError={known ? undefined : 'We could not find that ZIP code. Check it and try again.'}
          />
        </FormBand>
        <CheckPreview />
      </>
    );
  }
  if (params.status === 'invalid') {
    return (
      <>
        <FormBand>
          <CheckForm zip={params.zip} trade={params.trade} zipError={params.zipError} tradeError={params.tradeError} />
        </FormBand>
        <CheckPreview />
      </>
    );
  }

  const place = lookupZip(params.zip);
  if (!place) {
    return (
      <FormBand>
        <CheckForm
          zip={params.zip}
          trade={params.trade}
          zipError="We could not find that ZIP code. Check it and try again."
        />
      </FormBand>
    );
  }

  const scope = deriveScope(place);
  const placeLabel = `${place.city}, ${place.state}`;
  const city = nearestCity(place.lat, place.lon, CHECK_RADIUS_MI);
  const now = nowMs();
  const common = {
    placeLabel,
    trade: params.trade,
    tradeLabel: tradeLabel(params.trade),
    citySlug: city?.slug ?? null,
    watches: watchList(params.trade, city?.slug ?? null),
    now,
    origin: { lat: place.lat, lon: place.lon },
  };

  // A ZIP with no local source within reach (isServedZip: territories, military codes, and places with no connected permit or city feed
  // nearby) gets the "Coming to your area" card: leave an email, hear when Holler covers it. A served ZIP never gets it.
  const waitlist = isServedZip(place) ? null : <AreaWaitlist zip={params.zip} trade={params.trade} placeLabel={placeLabel} />;

  // Territories and military mail codes have no source rows yet: say so, read nothing. The waitlist card is the answer here.
  if (!scope.covered) {
    return (
      <>
        <FormBand>
          <CheckForm zip={params.zip} trade={params.trade} />
        </FormBand>
        {waitlist}
      </>
    );
  }

  const h = await headers();
  const gate = await gateCheck(clientIp(new Request('https://holler.invalid/check', { headers: h })), hit);
  if (gate === 'limited') {
    return (
      <>
        <FormBand>
          <CheckForm zip={params.zip} trade={params.trade} />
        </FormBand>
        {waitlist}
        <CheckResults {...common} mode="limited" items={[]} checkedAt={new Date(now).toISOString()} />
      </>
    );
  }

  // Funnel step: one area check. Path only, never the ZIP or the trade. Runs after the response; skipped for privacy signals and bots.
  const ctx = await eventContext().catch(() => null);
  if (ctx) after(() => trackVisitorStep('area_check', ctx, '/check'));

  const [data, snapshot] = await Promise.all([
    loadCheck(scope.cellLat, scope.cellLon, scope.state, params.trade),
    // Source states (lib/signals/source-state.ts): when a source covering this ZIP and trade is behind, the results say so.
    loadSourceStateSnapshot().catch(() => null),
  ]);
  const coverage = coverageNotice({ lat: place.lat, lon: place.lon, radiusMi: CHECK_RADIUS_MI, trades: [params.trade], states: snapshot?.states, now });
  // No trim here: holler_signals_near already applied the distance test in SQL before its row limit (see lib/check/load.ts).

  return (
    <>
      <FormBand>
        <CheckForm zip={params.zip} trade={params.trade} />
      </FormBand>
      {waitlist}
      <CheckResults {...common} mode={data.ok ? 'results' : 'unreadable'} items={data.items} checkedAt={data.checkedAt} coverage={coverage?.line ?? null} coverageKnown={snapshot !== null} />
    </>
  );
}

/**
 * The form on a white card (.on-light) over the green band's lower edge: labels, input edges (line-strong 3.85:1 on surface) and
 * the error text keep the light-surface rules, which they would not on green.
 */
function FormBand({ children }: { children: ReactNode }) {
  return <div className="on-light rounded-card border border-line bg-surface p-5 shadow-lift sm:p-6">{children}</div>;
}

const PREVIEW: { family: Family; title: string; body: string }[] = [
  { family: 'weather', title: 'Storm reports and weather alerts', body: 'Hail, wind and tornado reports and weather service alerts, anywhere in the US.' },
  { family: 'spending', title: 'Permits', body: 'Building permits from the cities Holler has connected.' },
  { family: 'civic', title: '311 requests and code cases', body: 'From the same city feeds, where the city publishes them.' },
];

/**
 * Before a search (and on the ZIP step or a form error): what the check will list, so the page is not a lone form above a tall footer (review 2 P2-15). Words only, no
 * sample records, so nothing here can be mistaken for live data.
 */
function CheckPreview() {
  return (
    <section aria-labelledby="check-preview-h" className="mt-12">
      <h2 id="check-preview-h" className="text-3xl text-ink md:text-4xl">
        What the check lists
      </h2>
      <Ledger className="mt-5">
        {PREVIEW.map((r) => (
          <li key={r.title} className="flex gap-4 py-4">
            <FamilyDot family={r.family} className="mt-2" />
            <div className="min-w-0">
              <p className="font-semibold text-ink">{r.title}</p>
              <p className="text-muted">{r.body}</p>
            </div>
          </li>
        ))}
      </Ledger>
      <p className="mt-4 text-muted">
        Records from the last {CHECK_WINDOW_DAYS} days, {CHECK_RADIUS_LABEL} around your ZIP. Each one shows its public
        source.
      </p>
    </section>
  );
}

function nowMs(): number {
  return Date.now();
}
