import type { Metadata } from 'next';
import { connection } from 'next/server';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { Suspense, type ReactNode } from 'react';
import { AreaWaitlist } from '@/components/area-waitlist';
import { CheckForm } from '@/components/check-form';
import { CheckResults } from '@/components/check-results';
import { FooterEs } from '@/components/es/footer';
import { TopNavEs } from '@/components/es/top-nav';
import { BODY_TEXT, PAGE_BOX } from '@/components/grid';
import { FamilyDot, Ledger, type Family } from '@/components/page-header';
import { eventContext, trackVisitorStep } from '@/lib/analytics/request';
import { clientIp, hit } from '@/lib/auth/ratelimit';
import { isServedZip } from '@/lib/check/coverage';
import { coverageFor } from '@/lib/check/cells';
import { checkAnswer } from '@/lib/check/answer';
import { gateCheck } from '@/lib/check/limit';
import { loadCheck } from '@/lib/check/load';
import { alertTotals, memberItems } from '@/lib/check/delivery';
import { checkVerdict } from '@/lib/check/verdict';
import { parseCheckParams } from '@/lib/check/params';
import { CHECK_WINDOW_DAYS, CHECK_RADIUS_MI, deriveScope } from '@/lib/check/scope';
import { tradeLabel } from '@/lib/check/trades';
import { watchList } from '@/lib/check/watch';
import { coverageNotice } from '@/lib/check/coverage-notice';
import { loadSourceStateSnapshot } from '@/lib/signals/source-state-snapshot';
import { lookupZip, nearestCity } from '@/lib/geo';
import { lowerFirst, t } from '@/lib/i18n';
import { ES_PAIRS, pairAlternates } from '@/lib/i18n/seo';
import type { WaitlistCardWords } from '@/lib/waitlist/copy';
import { waitlistTradeGroups } from '@/lib/waitlist/trades';

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
    // Round 24: its own card text. Without it the page inherited the root layout's English twitter description, which names a price,
    // onto every /es/check answer, the waitlist ones included.
    twitter: { card: 'summary_large_image', title, description, images: ['/og.png'] },
    robots: variant ? { index: false, follow: true } : { index: true, follow: true },
  };
}

export default function CheckPageEs(props: PageProps<'/es/check'>) {
  return (
    <>
      {/* Round 24 (review P3-7): no "Empezar gratis" in the header on a waitlist answer; the fallback has none either. */}
      <Suspense fallback={<TopNavEs englishHref={PAIR.en} showStart={false} />}>
        <CheckNavEs sp={props.searchParams} />
      </Suspense>
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

async function CheckNavEs({ sp }: { sp: PageProps<'/es/check'>['searchParams'] }) {
  const q = await sp;
  return <TopNavEs englishHref={PAIR.en} showStart={checkAnswer(q.zip, q.trade)?.state !== 'waitlist'} />;
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

  // Round 23: coverage is per city AND per trade (lib/check/cells.ts), as on the English page. 'waitlist' means this trade has nothing
  // here an owner could act on: say so, and show the waitlist card. Round 24 INT2: the card is on this page, in Spanish, and posts lang
  // 'es', so the confirmation email and the confirm page are Spanish too (it used to send Spanish visitors to the English page). The
  // results block then shows no trial offer and no "Holler is watching near X" list.
  const served = isServedZip(place);
  const answer = coverageFor(place, params.trade, served);
  const coverageState = answer.state;
  const gate = { coverageState, measured: answer.measured, storm: answer.storm };
  // Round 24 (review P2-6): a ZIP Holler reads gets the per-trade wording, as in English; only an unserved ZIP hears "not covered".
  const uncoveredNote =
    coverageState === 'waitlist' ? (
      <AreaWaitlist
        zip={params.zip}
        trade={params.trade}
        placeLabel={placeLabel}
        groups={waitlistTradeGroups(place, served, L)}
        tradeLabel={served ? tradeLabel(params.trade, L) : null}
        words={waitlistWordsEs(placeLabel, served ? lowerFirst(tradeLabel(params.trade, L)) : null, answer.closed)}
      />
    ) : null;

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
  const limit = await gateCheck(clientIp(new Request('https://holler.invalid/es/check', { headers: h })), hit);
  if (limit === 'limited') {
    return (
      <>
        <FormBand>
          <CheckForm lang={L} zip={params.zip} trade={params.trade} />
        </FormBand>
        {uncoveredNote}
        <CheckResults {...common} {...gate} mode="limited" items={[]} checkedAt={new Date(now).toISOString()} />
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

  // Round 25: every record a member with this trade at this ZIP would have (not only the listed 20), and the counted verdict above the list.
  // The verdict word is coverageState (coverageFor above), so the block can never disagree with the offer or the waitlist card.
  const member = memberItems(data.items, place, params.trade);
  const verdict = data.ok ? checkVerdict(coverageState, alertTotals(member, data.clipped === true), { tradeLabel: common.tradeLabel, zip: params.zip, lang: L }) : null;

  return (
    <>
      <FormBand>
        <CheckForm lang={L} zip={params.zip} trade={params.trade} />
      </FormBand>
      {uncoveredNote}
      <CheckResults {...common} {...gate} verdict={verdict} mode={data.ok ? 'results' : 'unreadable'} items={member} checkedAt={data.checkedAt} coverage={coverage?.line ?? null} coverageKnown={snapshot !== null} />
    </>
  );
}

/** The waitlist card's words in Spanish, finished on the server (the place and the trade filled in). */
function waitlistWordsEs(placeLabel: string, tradeWord: string | null, closed = false): WaitlistCardWords {
  return {
    eyebrow: t(L, 'wl.card.eyebrow'),
    heading: tradeWord ? `${t(L, 'chk.h.trade_wait', { trade: tradeWord, place: placeLabel })}.` : t(L, 'wl.card.heading', { place: placeLabel }),
    // Round 24 FIX2 (review P3-1, P3-2): "cuando lo haya" under the trade heading; the closed wording for a closed trade.
    intro: t(L, tradeWord ? 'wl.card.intro_trade' : 'wl.card.intro'),
    note: tradeWord ? (closed ? t(L, 'chk.empty.trade_closed', { trade: tradeWord }) : t(L, 'chk.empty.trade_wait')) : t(L, 'wl.card.note'),
    emailLabel: t(L, 'wl.card.email'),
    tradeLabel: t(L, 'wl.card.trade'),
    button: t(L, 'wl.card.button'),
    sending: t(L, 'wl.card.sending'),
    privacy: t(L, 'wl.card.privacy'),
    thanks: t(L, 'wl.card.thanks', { place: placeLabel }),
    errors: {
      email: t(L, 'wl.err.email'),
      invalid: t(L, 'wl.err.invalid'),
      trade: t(L, 'wl.err.trade'),
      zip: t(L, 'wl.err.zip'),
      limited: t(L, 'wl.err.limited'),
      unavailable: t(L, 'wl.err.unavailable'),
      network: t(L, 'wl.err.network'),
    },
  };
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
      <p className="mt-4 text-muted">{t(L, 'chk.preview.foot', { days: CHECK_WINDOW_DAYS, radius: t(L, 'chk.radius_list') })}</p>
    </section>
  );
}

function nowMs(): number {
  return Date.now();
}
