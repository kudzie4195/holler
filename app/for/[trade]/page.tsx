import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CATEGORIES } from '@/lib/signals/categories';
import { absoluteUrl } from '@/lib/seo/canonical';
import { breadcrumbLd, faqLd } from '@/lib/seo/jsonld';
import { sourceInfo } from '@/lib/seo/sources';
import { loadTradeSignals, isTradeIndexable, type TradeSignalItem } from '@/lib/seo/trade-data';
import {
  HOW_IT_WORKS,
  TRADE_PRICE_LINE,
  serviceLd,
  tradeDescription,
  tradeEntry,
  tradeHeadline,
  tradeLead,
  tradeFaq,
  tradePath,
  tradeTitle,
  cityRecordsCaveat,
  visibleSignals,
} from '@/lib/seo/trade-view';
import { fmtDateTime, fmtItemTime } from '@/lib/seo/view';
import { JsonLd } from '../../local/_components/jsonld';
import { ClosingBand, FamilyDot, H2, Ledger, Page, PageHeader, PrimaryLink, SecondaryLink, linkClass, PublicRecordsNote, type Family } from '../../local/_components/ui';
import { kindFamily } from '@/components/signal-meta';

type Props = { params: Promise<{ trade: string }> };

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ trade: c.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { trade } = await params;
  const t = tradeEntry(trade);
  if (!t) return { title: 'Not found', robots: { index: false } };
  const live = await loadTradeSignals(t.id);
  const title = tradeTitle(t);
  const description = tradeDescription(t);
  const path = tradePath(t.id);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: absoluteUrl(path) },
    robots: isTradeIndexable(live.items.length) ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title, description, url: absoluteUrl(path), siteName: 'Holler', type: 'website' },
    twitter: { card: 'summary', title, description },
  };
}

function LiveRow({ item, asOf }: { item: TradeSignalItem; asOf: string }) {
  const src = sourceInfo(item.source);
  const place = item.city && item.state ? `${item.city}, ${item.state}` : item.state;
  return (
    <li className="flex gap-3 py-4">
      <FamilyDot family={kindFamily(item.kind)} className="mt-1.5" />
      <div className="min-w-0">
        <p className="font-medium leading-snug">
          {item.url ? (
            <a href={item.url} target="_blank" rel={item.kind === 'ask' ? 'nofollow ugc noopener' : 'noopener'} className={linkClass}>
              {item.title}
            </a>
          ) : (
            item.title
          )}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <time dateTime={item.occurredAt} className="font-mono text-xs uppercase tracking-[0.04em] text-ink">
            {fmtItemTime(item.occurredAt, asOf)}
          </time>
          {place ? <span>{place}</span> : null}
          <span>
            Source:{' '}
            {src.homeUrl ? (
              <a href={src.homeUrl} target="_blank" rel="noopener" className={`${linkClass} inline-flex min-h-11 items-center`}>
                {src.label}
              </a>
            ) : (
              src.label
            )}
          </span>
        </div>
      </div>
    </li>
  );
}

export default async function TradePage({ params }: Props) {
  const { trade } = await params;
  const t = tradeEntry(trade);
  if (!t) notFound();
  const live = await loadTradeSignals(t.id);
  const faq = tradeFaq(t);
  const signals = visibleSignals(t);
  const caveat = cityRecordsCaveat(signals);
  const path = tradePath(t.id);
  const checkHref = `/check?trade=${encodeURIComponent(t.id)}`;

  return (
    <Page
      header={
        <PageHeader
          crumbs={[{ name: 'Home', href: '/' }, { name: 'By trade', href: '/for' }, { name: t.label }]}
          title={tradeHeadline(t)}
          size="md"
          lead={<p className="leading-relaxed">{tradeLead(t)}</p>}
        >
          <div className="flex flex-wrap items-center gap-3">
            <PrimaryLink href="/signup" onBrand>
              Start free
            </PrimaryLink>
            <SecondaryLink href={checkHref} onBrand>
              Check your area
            </SecondaryLink>
          </div>
          <p className="mt-3 text-sm text-on-brand-muted">{TRADE_PRICE_LINE}</p>
        </PageHeader>
      }
    >
      <JsonLd
        data={[
          serviceLd(t),
          faqLd(faq),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'By trade', path: '/for' },
            { name: t.label, path },
          ]),
        ]}
      />
      <div className="flex flex-col gap-14">
        <section aria-labelledby="what-you-get">
          <H2 id="what-you-get">What Holler sends {t.facts.noun}</H2>
          {signals.length === 0 ? (
            <p className="mt-4 text-muted">Nothing yet. The sources behind this trade are not switched on for this launch.</p>
          ) : (
            <Ledger className="mt-4">
              {signals.map((s) => (
                <li key={s.signal} className="flex gap-3 py-4">
                  <FamilyDot family={signalFamily(s.type)} className="mt-1.5" />
                  <div className="min-w-0">
                    <p className="text-lg font-semibold leading-snug">{s.signal}</p>
                    <p className="mt-1 text-muted">{s.why}</p>
                  </div>
                </li>
              ))}
            </Ledger>
          )}
          {caveat ? <p className="mt-4 text-sm text-muted">{caveat}</p> : null}
        </section>

        {live.items.length > 0 ? (
          <section aria-labelledby="latest">
            <H2 id="latest">Latest signals for {t.label.toLowerCase()}</H2>
            <p className="mt-2 text-muted">
              The newest matching records across the country, each linked to its source. Your alerts are limited to
              your own area.
            </p>
            <Ledger className="mt-4">
              {live.items.map((it) => (
                <LiveRow key={it.id} item={it} asOf={live.asOf} />
              ))}
            </Ledger>
            <p className="mt-3 text-sm text-muted">
              Refreshed <time dateTime={live.asOf} className="font-mono">{fmtDateTime(live.asOf)}</time>
            </p>
          </section>
        ) : null}

        <section aria-labelledby="how-it-works">
          <H2 id="how-it-works">How it works</H2>
          <ol className="mt-5 flex flex-col gap-5">
            {HOW_IT_WORKS.map((line, i) => (
              <li key={line} className="flex items-start gap-4">
                <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand font-mono text-sm text-signal">
                  {i + 1}
                </span>
                <span className="pt-1">{line}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="faq">
          <H2 id="faq">Questions from {t.facts.noun}</H2>
          <Ledger as="dl" className="mt-4">
            {faq.map((f) => (
              <div key={f.q} className="py-5">
                <dt className="text-lg font-semibold">{f.q}</dt>
                <dd className="mt-1 text-muted">{f.a}</dd>
              </div>
            ))}
          </Ledger>
        </section>

        <ClosingBand line="See what is happening near you today.">
          <PrimaryLink href="/signup" onBrand>
            Start free
          </PrimaryLink>
          <SecondaryLink href={checkHref} onBrand>
            Check your area
          </SecondaryLink>
        </ClosingBand>
      </div>
      <PublicRecordsNote />
    </Page>
  );
}

/** Record family of a trade signal type, for its ledger mark: weather sky, permits and spending sage, everything else civic. */
function signalFamily(type: string): Family {
  if (type === 'weather-alert' || type === 'storm-report' || type === 'disaster' || type === 'quake') return 'weather';
  if (type === 'permit' || type === 'contract') return 'spending';
  return 'civic';
}
