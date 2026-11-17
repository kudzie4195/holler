import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CheckForm } from '@/components/check-form';
import { CheckResults } from '@/components/check-results';
import { Footer } from '@/components/footer';
import { TopNav } from '@/components/top-nav';
import { loadCheck } from '@/lib/check/load';
import { parseCheckParams } from '@/lib/check/params';
import { deriveScope } from '@/lib/check/scope';
import { tradeLabel } from '@/lib/check/trades';
import { cityBySlug, lookupZip } from '@/lib/geo';

// Results views (with query params) share this canonical, so only /check itself is indexed.
export const metadata: Metadata = {
  title: 'See what happened near you',
  description:
    'Free local check. Enter a ZIP code and a trade to see recent storm reports, permits, 311 requests and more near you, with sources. No login.',
  alternates: { canonical: '/check' },
  robots: { index: true, follow: true },
};

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
  const data = await loadCheck(scope.citySlug, scope.state, params.trade);
  const city = scope.citySlug ? cityBySlug(scope.citySlug) : undefined;
  const now = nowMs();
  const placeLabel = `${place.city}, ${place.state}`;

  return (
    <>
      <CheckForm zip={params.zip} trade={params.trade} />
      <CheckResults
        items={data.items}
        ok={data.ok}
        checkedAt={data.checkedAt}
        placeLabel={placeLabel}
        trade={params.trade}
        tradeLabel={tradeLabel(params.trade)}
        citySlug={city?.slug ?? null}
        now={now}
      />
    </>
  );
}

function nowMs(): number {
  return Date.now();
}
