import type { Metadata } from 'next';
import { connection } from 'next/server';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { Suspense, type ReactNode } from 'react';
import { CheckForm } from '@/components/check-form';
import { CheckResults } from '@/components/check-results';
import { Footer } from '@/components/footer';
import { TopNav } from '@/components/top-nav';
import { eventContext, trackVisitorStep } from '@/lib/analytics/request';
import { clientIp, hit } from '@/lib/auth/ratelimit';
import { gateCheck } from '@/lib/check/limit';
import { loadCheck } from '@/lib/check/load';
import { parseCheckParams } from '@/lib/check/params';
import { CHECK_RADIUS_MI, deriveScope } from '@/lib/check/scope';
import { tradeLabel } from '@/lib/check/trades';
import { watchList } from '@/lib/check/watch';
import { lookupZip, nearestCity } from '@/lib/geo';

// Only /check itself is indexed. Every ?zip=&trade= variant is noindex (tens of thousands of combinations, one canonical).
export async function generateMetadata(props: PageProps<'/check'>): Promise<Metadata> {
  const sp = await props.searchParams;
  const variant = sp.zip !== undefined || sp.trade !== undefined;
  return {
    title: 'See what happened near you',
    description:
      'Free local check. Enter a ZIP code and a trade to see recent storm reports, permits, 311 requests and more near you, with sources. No login.',
    alternates: { canonical: '/check' },
    robots: variant ? { index: false, follow: true } : { index: true, follow: true },
  };
}

export default function CheckPage(props: PageProps<'/check'>) {
  return (
    <>
      <TopNav />
      <main id="main" className="w-full flex-1">
        {/* Green header band. The form card below is pulled up over its lower edge, so the form reads as part of the header. */}
        <div className="on-brand bg-brand">
          <div className="mx-auto w-full max-w-4xl px-5 pb-24 pt-6 md:pb-28 md:pt-10">
            <p className="eyebrow mb-3">Free area check</p>
            <h1 className="max-w-[22ch] text-5xl sm:text-6xl md:text-7xl">See what happened near you.</h1>
            <p className="mt-4 max-w-xl text-lg text-on-brand-muted">
              Pick your trade and ZIP code. Holler shows what it recorded nearby in the last 30 days, with a link to every source. No
              login.
            </p>
          </div>
        </div>
        <div className="mx-auto -mt-16 w-full max-w-4xl px-5 pb-20 md:-mt-20">
          <Suspense fallback={<FormBand><CheckForm /></FormBand>}>
            <Check searchParams={props.searchParams} />
          </Suspense>
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

  if (params.status === 'empty') return <FormBand><CheckForm /></FormBand>;
  // The home page ZIP form sends only ?zip=. A ZIP we know is a step, not an error: the ZIP stays filled in and the page asks for
  // the trade. A ZIP we cannot find gets the same message as with a trade.
  if (params.status === 'zip') {
    const known = lookupZip(params.zip);
    return (
      <FormBand>
        <CheckForm
          zip={params.zip}
          prompt={known ? `Now pick your trade.` : undefined}
          zipError={known ? undefined : 'We could not find that ZIP code. Check it and try again.'}
        />
      </FormBand>
    );
  }
  if (params.status === 'invalid') {
    return (
      <FormBand>
        <CheckForm zip={params.zip} trade={params.trade} zipError={params.zipError} tradeError={params.tradeError} />
      </FormBand>
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

  // Territories and military mail codes have no source rows yet: say so, read nothing.
  if (!scope.covered) {
    return (
      <>
        <FormBand>
          <CheckForm zip={params.zip} trade={params.trade} />
        </FormBand>
        <CheckResults {...common} mode="uncovered" items={[]} checkedAt={new Date(now).toISOString()} />
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
        <CheckResults {...common} mode="limited" items={[]} checkedAt={new Date(now).toISOString()} />
      </>
    );
  }

  // Funnel step: one area check. Path only, never the ZIP or the trade. Runs after the response; skipped for privacy signals and bots.
  const ctx = await eventContext().catch(() => null);
  if (ctx) after(() => trackVisitorStep('area_check', ctx, '/check'));

  const data = await loadCheck(scope.cellLat, scope.cellLon, scope.state, params.trade);
  // No trim here: holler_signals_near already applied the distance test in SQL before its row limit (see lib/check/load.ts).

  return (
    <>
      <FormBand>
        <CheckForm zip={params.zip} trade={params.trade} />
      </FormBand>
      <CheckResults {...common} mode={data.ok ? 'results' : 'unreadable'} items={data.items} checkedAt={data.checkedAt} />
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

function nowMs(): number {
  return Date.now();
}
