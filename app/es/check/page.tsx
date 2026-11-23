import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { Suspense, type ReactNode } from 'react';
import { CheckForm } from '@/components/check-form';
import { CheckResults } from '@/components/check-results';
import { FooterEs } from '@/components/es/footer';
import { TopNavEs } from '@/components/es/top-nav';
import { BODY_TEXT, PAGE_BOX } from '@/components/grid';
import { FamilyDot, Ledger, type Family } from '@/components/page-header';
import { eventContext, trackVisitorStep } from '@/lib/analytics/request';
import { clientIp, hit } from '@/lib/auth/ratelimit';
import { isServedZip } from '@/lib/check/coverage';
import { gateCheck } from '@/lib/check/limit';
import { loadCheck } from '@/lib/check/load';
import { parseCheckParams } from '@/lib/check/params';
import { CHECK_WINDOW_DAYS, CHECK_RADIUS_MI, deriveScope } from '@/lib/check/scope';
import { tradeLabel } from '@/lib/check/trades';
import { watchList } from '@/lib/check/watch';
import { coverageNotice } from '@/lib/check/coverage-notice';
import { loadSourceStateSnapshot } from '@/lib/signals/source-state-snapshot';
import { lookupZip, nearestCity } from '@/lib/geo';
import { t } from '@/lib/i18n';
import { ES_PAIRS, pairAlternates } from '@/lib/i18n/seo';

const L = 'es' as const;
const PAIR = ES_PAIRS[1];

// Only /es/check itself is indexed. Every ?zip=&trade= variant is noindex (one canonical), as on the English page.
export async function generateMetadata(props: PageProps<'/es/check'>): Promise<Metadata> {
  const sp = await props.searchParams;
  const variant = sp.zip !== undefined || sp.trade !== undefined;
  const title = t(L, 'chk.meta.title');
  const description = t(L, 'chk.meta.desc');
  return {
    title,
    description,
    alternates: pairAlternates(PAIR, 'es'),
    openGraph: {
      type: 'website',
      siteName: 'Holler',
      locale: 'es_US',
      title,
      description,
      url: PAIR.es,
      images: [{ url: '/og.png', width: 1200, height: 630, alt: title }],
    },
    robots: variant ? { index: false, follow: true } : { index: true, follow: true },
  };
}

export default function CheckPageEs(props: PageProps<'/es/check'>) {
  return (
    <>
      <TopNavEs englishHref={PAIR.en} />
      <main id="main" className={`w-full flex-1 ${BODY_TEXT}`}>
        <div className="on-brand bg-brand">
          <div className={`${PAGE_BOX} pb-24 pt-6 md:pb-28 md:pt-10`}>
            <p className="eyebrow mb-3">{t(L, 'chk.eyebrow')}</p>
            <h1 className="max-w-[22ch] text-5xl sm:text-6xl md:text-7xl">{t(L, 'chk.h1')}</h1>
            <p className="mt-4 max-w-xl text-lg text-on-brand-muted">{t(L, 'chk.intro', { days: CHECK_WINDOW_DAYS })}</p>
          </div>
        </div>
        <div className={`${PAGE_BOX} -mt-16 pb-20 md:-mt-20`}>
          <div className="max-w-4xl">
            <Suspense fallback={<FormBand><CheckForm lang={L} /></FormBand>}>
              <Check searchParams={props.searchParams} />
            </Suspense>
          </div>
        </div>
      </main>
      <FooterEs englishHref={PAIR.en} />
    </>
  );
}

/** The sentence for a ZIP the lookup does not know, or a ZIP that is not 5 digits. The same decisions as lib/check/params.ts, in Spanish. */
function zipMessage(raw: string, known: 'unknown' | 'bad' | 'missing'): string {
  void raw;
  return t(L, known === 'unknown' ? 'chk.err.zip_unknown' : known === 'bad' ? 'chk.err.zip_bad' : 'chk.err.zip_missing');
}

async function Check({ searchParams }: { searchParams: PageProps<'/es/check'>['searchParams'] }) {
  await connection();
  const sp = await searchParams;
  const params = parseCheckParams({ zip: sp.zip, trade: sp.trade });

  if (params.status === 'empty') {
    return (
      <>
        <FormBand>
          <CheckForm lang={L} />
        </FormBand>
        <CheckPreview />
      </>
    );
  }
  if (params.status === 'zip') {
    const known = lookupZip(params.zip);
    return (
      <>
        <FormBand>
          <CheckForm lang={L} zip={params.zip} prompt={known ? t(L, 'chk.prompt.trade') : undefined} zipError={known ? undefined : zipMessage(params.zip, 'unknown')} />
        </FormBand>
        <CheckPreview />
      </>
    );
  }
  if (params.status === 'invalid') {
    return (
      <>
        <FormBand>
          <CheckForm
            lang={L}
            zip={params.zip}
            trade={params.trade}
            zipError={params.zipError ? zipMessage(params.zip, params.zip ? 'bad' : 'missing') : undefined}
            tradeError={params.tradeError ? t(L, 'chk.err.trade') : undefined}
          />
        </FormBand>
        <CheckPreview />
      </>
    );
  }

  const place = lookupZip(params.zip);
  if (!place) {
    return (
      <FormBand>
        <CheckForm lang={L} zip={params.zip} trade={params.trade} zipError={zipMessage(params.zip, 'unknown')} />
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
    tradeLabel: tradeLabel(params.trade, L),
    citySlug: city?.slug ?? null,
    watches: watchList(params.trade, city?.slug ?? null, undefined, L),
    now,
    origin: { lat: place.lat, lon: place.lon },
    lang: L,
  };

  // A ZIP with no local source within reach: say so, and point to the English waitlist card (the waitlist form is English only).
  const uncoveredNote = isServedZip(place) ? null : <Waitlist placeLabel={placeLabel} zip={params.zip} trade={params.trade} />;

  if (!scope.covered) {
    return (
      <>
        <FormBand>
          <CheckForm lang={L} zip={params.zip} trade={params.trade} />
        </FormBand>
        {uncoveredNote}
      </>
    );
  }

  const h = await headers();
  const gate = await gateCheck(clientIp(new Request('https://holler.invalid/es/check', { headers: h })), hit);
  if (gate === 'limited') {
    return (
      <>
        <FormBand>
          <CheckForm lang={L} zip={params.zip} trade={params.trade} />
        </FormBand>
        {uncoveredNote}
        <CheckResults {...common} mode="limited" items={[]} checkedAt={new Date(now).toISOString()} />
      </>
    );
  }

  // Funnel step: one area check. Path only, never the ZIP or the trade. Runs after the response; skipped for privacy signals and bots.
  const ctx = await eventContext().catch(() => null);
  if (ctx) after(() => trackVisitorStep('area_check', ctx, '/es/check'));

  const [data, snapshot] = await Promise.all([
    loadCheck(scope.cellLat, scope.cellLon, scope.state, params.trade),
    loadSourceStateSnapshot().catch(() => null),
  ]);
  const coverage = coverageNotice({ lat: place.lat, lon: place.lon, radiusMi: CHECK_RADIUS_MI, trades: [params.trade], states: snapshot?.states, now, lang: L });

  return (
    <>
      <FormBand>
        <CheckForm lang={L} zip={params.zip} trade={params.trade} />
      </FormBand>
      {uncoveredNote}
      <CheckResults {...common} mode={data.ok ? 'results' : 'unreadable'} items={data.items} checkedAt={data.checkedAt} coverage={coverage?.line ?? null} coverageKnown={snapshot !== null} />
    </>
  );
}

/** "Holler does not cover X yet", and a link to the English page that has the waitlist form. */
function Waitlist({ placeLabel, zip, trade }: { placeLabel: string; zip: string; trade: string }) {
  const href = `/check?zip=${encodeURIComponent(zip)}&trade=${encodeURIComponent(trade)}`;
  return (
    <section aria-labelledby="es-waitlist-h" className="mt-10">
      <h2 id="es-waitlist-h" className="text-3xl text-ink md:text-4xl">{t(L, 'chk.h.uncovered', { place: placeLabel })}</h2>
      <p className="mt-3 max-w-2xl text-muted">{t(L, 'chk.empty.uncovered', { place: placeLabel })}</p>
      <p className="mt-3 max-w-2xl text-muted">{t(L, 'chk.uncovered.cta')}</p>
      <p className="mt-2">
        <Link href={href} hrefLang="en" className="inline-flex min-h-11 items-center font-semibold text-brand-text underline">{t(L, 'chk.uncovered.link')}</Link>
      </p>
    </section>
  );
}

function FormBand({ children }: { children: ReactNode }) {
  return <div className="on-light rounded-card border border-line bg-surface p-5 shadow-lift sm:p-6">{children}</div>;
}

const PREVIEW: { family: Family; t: 'weather' | 'permit' | 'civic' }[] = [
  { family: 'weather', t: 'weather' },
  { family: 'spending', t: 'permit' },
  { family: 'civic', t: 'civic' },
];

/** Before a search: what the check will list. Words only, no sample records, so nothing here can be mistaken for live data. */
function CheckPreview() {
  return (
    <section aria-labelledby="check-preview-h" className="mt-12">
      <h2 id="check-preview-h" className="text-3xl text-ink md:text-4xl">{t(L, 'chk.preview.h')}</h2>
      <Ledger className="mt-5">
        {PREVIEW.map((r) => (
          <li key={r.t} className="flex gap-4 py-4">
            <FamilyDot family={r.family} className="mt-2" />
            <div className="min-w-0">
              <p className="font-semibold text-ink">{t(L, `chk.preview.${r.t}.t` as 'chk.preview.weather.t')}</p>
              <p className="text-muted">{t(L, `chk.preview.${r.t}.b` as 'chk.preview.weather.b')}</p>
            </div>
          </li>
        ))}
      </Ledger>
      <p className="mt-4 text-muted">{t(L, 'chk.preview.foot', { days: CHECK_WINDOW_DAYS, radius: t(L, 'chk.radius') })}</p>
    </section>
  );
}

function nowMs(): number {
  return Date.now();
}
