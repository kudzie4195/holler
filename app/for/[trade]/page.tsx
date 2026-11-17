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
  showsCityRecords,
  visibleSignals,
} from '@/lib/seo/trade-view';
import { fmtDateTime, fmtItemTime } from '@/lib/seo/view';
import { JsonLd } from '../../local/_components/jsonld';
import { Card, Crumbs, H1, H2, Page, PrimaryLink, linkClass } from '../../local/_components/ui';

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
    <li className="border-t border-line py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
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
        <time dateTime={item.occurredAt} className="font-mono">
          {fmtItemTime(item.occurredAt, asOf)}
        </time>
        {place ? <span>{place}</span> : null}
      </div>
      <p className="mt-1 font-medium leading-snug">
        {item.url ? (
          <a href={item.url} target="_blank" rel={item.kind === 'ask' ? 'nofollow ugc noopener' : 'noopener'} className={linkClass}>
            {item.title}
          </a>
        ) : (
          item.title
        )}
      </p>
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
  const path = tradePath(t.id);
  const checkHref = `/check?trade=${encodeURIComponent(t.id)}`;

  return (
    <Page>
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
      <Crumbs items={[{ name: 'Home', href: '/' }, { name: 'By trade', href: '/for' }, { name: t.label }]} />
      <H1>{tradeHeadline(t)}</H1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed">{tradeLead(t)}</p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <PrimaryLink href={checkHref}>Check your area</PrimaryLink>
        <PrimaryLink href="/signup">Start free</PrimaryLink>
      </div>
      <p className="mt-2 text-sm text-muted">{TRADE_PRICE_LINE}</p>

      <div className="mt-10 flex flex-col gap-6">
        <Card>
          <H2 id="what-you-get">What Holler sends {t.facts.noun}</H2>
          {signals.length === 0 ? (
            <p className="mt-4 text-muted">Nothing yet. The sources behind this trade are not switched on for this launch.</p>
          ) : null}
          <ul className="mt-4 flex flex-col gap-4">
            {signals.map((s) => (
              <li key={s.signal}>
                <p className="font-medium">{s.signal}</p>
                <p className="mt-1 text-muted">{s.why}</p>
              </li>
            ))}
          </ul>
          {showsCityRecords(signals) ? (
            <p className="mt-4 text-sm text-muted">
              Permits, 311 requests, inspections, business licenses and code violations come only from the cities Holler has
              connected so far.
            </p>
          ) : null}
        </Card>

        {live.items.length > 0 ? (
          <Card>
            <H2 id="latest">Latest signals for {t.label.toLowerCase()}</H2>
            <p className="mt-1 text-sm text-muted">
              The newest matching records across the country, each linked to its source. Your alerts are limited to
              your own area.
            </p>
            <ul className="mt-4">
              {live.items.map((it) => (
                <LiveRow key={it.id} item={it} asOf={live.asOf} />
              ))}
            </ul>
            <p className="mt-3 text-sm text-muted">
              Refreshed <time dateTime={live.asOf} className="font-mono">{fmtDateTime(live.asOf)}</time>
            </p>
          </Card>
        ) : null}

        <Card>
          <H2 id="how-it-works">How it works</H2>
          <ol className="mt-4 flex list-decimal flex-col gap-2 pl-5">
            {HOW_IT_WORKS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </Card>

        <Card>
          <H2 id="faq">Questions from {t.facts.noun}</H2>
          <dl className="mt-4 flex flex-col gap-4">
            {faq.map((f) => (
              <div key={f.q}>
                <dt className="font-medium">{f.q}</dt>
                <dd className="mt-1 text-muted">{f.a}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <div className="rounded-xl border border-line bg-surface p-6 text-center">
          <p className="text-2xl font-semibold tracking-[-0.02em]">See what is happening near you today.</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <PrimaryLink href={checkHref}>Check your area</PrimaryLink>
            <PrimaryLink href="/signup">Start free</PrimaryLink>
          </div>
        </div>
      </div>
    </Page>
  );
}
