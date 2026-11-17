import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Suspense } from 'react';
import { CheckForm } from '@/components/check-form';
import { CheckResults } from '@/components/check-results';
import { Footer } from '@/components/footer';
import { TopNav } from '@/components/top-nav';
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
      <main id="main" className="mx-auto w-full max-w-3xl px-5 pb-20 pt-12 md:pt-16">
        <h1 className="text-4xl text-ink md:text-5xl">See what happened near you.</h1>
        <p className="mt-4 max-w-xl text-lg text-muted">
          Pick your trade and ZIP code. Holler shows what it recorded nearby in the last 30 days, with a link to every source. No
          login.
        </p>
        <div className="mt-8">
          <Suspense fallback={<CheckForm />}>
            <Check searchParams={props.searchParams} />
          </Suspense>
        </div>
      </main>
      <Footer />
    </>
  );
}

async function Check({ searchParams }: { searchParams: PageProps<'/check'>['searchParams'] }) {
  const sp = await searchParams;
  const params = parseCheckParams({ zip: sp.zip, trade: sp.trade });

  if (params.status === 'empty') return <CheckForm />;
  if (params.status === 'invalid') {
    return <CheckForm zip={params.zip} trade={params.trade} zipError={params.zipError} tradeError={params.tradeError} />;
  }

  const place = lookupZip(params.zip);
  if (!place) {
    return (
      <CheckForm
        zip={params.zip}
        trade={params.trade}
        zipError="We could not find that ZIP code. Check it and try again."
      />
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
  };

  // Territories and military mail codes have no source rows yet: say so, read nothing.
  if (!scope.covered) {
    return (
      <>
        <CheckForm zip={params.zip} trade={params.trade} />
        <CheckResults {...common} mode="uncovered" items={[]} checkedAt={new Date(now).toISOString()} />
      </>
    );
  }

  const h = await headers();
  const gate = await gateCheck(clientIp(new Request('https://holler.invalid/check', { headers: h })), hit);
  if (gate === 'limited') {
    return (
      <>
        <CheckForm zip={params.zip} trade={params.trade} />
        <CheckResults {...common} mode="limited" items={[]} checkedAt={new Date(now).toISOString()} />
      </>
    );
  }

  const data = await loadCheck(scope.cellLat, scope.cellLon, scope.state, params.trade);
  // No trim here: holler_signals_near already applied the distance test in SQL before its row limit (see lib/check/load.ts).

  return (
    <>
      <CheckForm zip={params.zip} trade={params.trade} />
      <CheckResults {...common} mode={data.ok ? 'results' : 'unreadable'} items={data.items} checkedAt={data.checkedAt} />
    </>
  );
}

function nowMs(): number {
  return Date.now();
}
