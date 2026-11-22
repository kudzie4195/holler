import type { Metadata } from 'next';
import Link from 'next/link';
import { FooterEs } from '@/components/es/footer';
import { TopNavEs } from '@/components/es/top-nav';
import { ButtonLink } from '@/components/button';
import { PAGE_BOX } from '@/components/grid';
import { ZipForm } from '@/components/home/zip-form';
import { FamilyDot, Ledger, type Family } from '@/components/page-header';
import { lowerFirst, t } from '@/lib/i18n';
import { ES_PAIRS, pairAlternates } from '@/lib/i18n/seo';
import { tradeLabel } from '@/lib/check/trades';
import { FROM_MONTHLY, TRIAL_DAYS, TRIAL_MONTHS } from '@/lib/plan/price-copy';
import { priceLabel } from '@/lib/stripe/plans';
import { TIER_NAMES } from '@/lib/plan/limits';

const L = 'es' as const;
const PAIR = ES_PAIRS[0];

export function generateMetadata(): Metadata {
  const title = t(L, 'land.title');
  const description = t(L, 'land.description', { from: FROM_MONTHLY, days: TRIAL_DAYS });
  return {
    title: { absolute: title },
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
  };
}

const STEPS = [
  ['how.s1.t', 'how.s1.b'],
  ['how.s2.t', 'how.s2.b'],
  ['how.s3.t', 'how.s3.b'],
] as const;

const FAMILIES: { id: 'weather' | 'permit' | 'civic'; family: Family; trades: string[] }[] = [
  { id: 'weather', family: 'weather', trades: ['roofing', 'tree-service', 'restoration', 'auto-glass'] },
  { id: 'permit', family: 'spending', trades: ['plumbing', 'hvac', 'electrical', 'windows-doors'] },
  { id: 'civic', family: 'civic', trades: ['junk-removal', 'pest-control', 'tree-service', 'handyman'] },
];

const FAQS = [1, 2, 3, 4].map((n) => ({ q: t(L, `faq.q${n}` as 'faq.q1'), a: t(L, `faq.a${n}` as 'faq.a1') }));

function faqLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: 'es',
    mainEntity: FAQS.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}

/**
 * Spanish home. Static: no live data, no client JavaScript. Every word comes from lib/i18n (es.ts); the English home is app/page.tsx.
 * Sign-up, pricing, privacy and terms are English pages, and the links say so.
 */
export default function HomeEs() {
  const trial = t(L, 'land.trial', { months: TRIAL_MONTHS });
  return (
    <>
      <TopNavEs englishHref={PAIR.en} />
      <main id="main" className="flex-1 text-[1.0625rem] leading-[1.55]">
        <section id="top" className="on-brand bg-brand">
          <div className={`${PAGE_BOX} flex flex-col gap-6 pb-16 pt-12 max-[600px]:pb-12 max-[600px]:pt-8`}>
            <h1 className="m-0 max-w-[18ch] font-display text-[clamp(44px,6.4vw,88px)] leading-[0.95] text-balance">{t(L, 'hero.h1')}</h1>
            <p className="m-0 max-w-[560px] text-[clamp(1.0625rem,1.6vw,1.25rem)] leading-[1.55] text-on-brand-muted">{t(L, 'hero.sub')}</p>
            <ZipForm id="hero-zip" lang={L} />
            <p className="m-0 text-[0.9375rem] text-on-brand-muted">{t(L, 'hero.price', { from: FROM_MONTHLY, trial })}</p>
          </div>
        </section>

        <section id="how" aria-labelledby="how-h" className={`${PAGE_BOX} scroll-mt-20 py-14`}>
          <h2 id="how-h" className="text-4xl text-ink md:text-5xl">{t(L, 'how.h')}</h2>
          <Ledger as="ol" className="mt-6">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="flex gap-4 py-4">
                <span aria-hidden="true" className="font-mono text-sm tabular-nums text-muted">{String(i + 1).padStart(2, '0')}</span>
                <div className="min-w-0">
                  <h3 className="text-xl font-semibold text-ink">{t(L, title)}</h3>
                  <p className="text-muted">{t(L, body)}</p>
                </div>
              </li>
            ))}
          </Ledger>
        </section>

        <section aria-labelledby="five-h" className={`${PAGE_BOX} pb-14`}>
          <h2 id="five-h" className="text-3xl text-ink md:text-4xl">{t(L, 'five.h')}</h2>
          <p className="mt-3 max-w-2xl text-muted">{t(L, 'five.p')}</p>
        </section>

        <section aria-labelledby="fam-h" className={`${PAGE_BOX} pb-14`}>
          <h2 id="fam-h" className="text-3xl text-ink md:text-4xl">{t(L, 'fam.h')}</h2>
          <Ledger className="mt-5">
            {FAMILIES.map((f) => (
              <li key={f.id} className="flex gap-4 py-4">
                <FamilyDot family={f.family} className="mt-2" />
                <div className="min-w-0">
                  <p className="font-mono text-xs uppercase tracking-[0.06em] text-muted">{t(L, `fam.${f.id}.tag` as 'fam.weather.tag')}</p>
                  <p className="font-semibold text-ink">{t(L, `fam.${f.id}.title` as 'fam.weather.title')}</p>
                  <p className="text-muted">{t(L, `fam.${f.id}.from` as 'fam.weather.from')}</p>
                  <p className="text-sm text-muted">{t(L, 'fam.good_for', { list: f.trades.map((id) => lowerFirst(tradeLabel(id, L))).join(', ') })}</p>
                </div>
              </li>
            ))}
          </Ledger>
        </section>

        <section aria-labelledby="lang-h" className={`${PAGE_BOX} pb-14`}>
          <div className="max-w-2xl rounded-card border border-line bg-surface p-5 md:p-6">
            <h2 id="lang-h" className="h-plain text-2xl text-ink">{t(L, 'lang.band.h')}</h2>
            <p className="mt-2 text-muted">{t(L, 'lang.band.p')}</p>
          </div>
        </section>

        <section aria-labelledby="price-h" className={`${PAGE_BOX} pb-14`}>
          <h2 id="price-h" className="text-3xl text-ink md:text-4xl">{t(L, 'price.h', { trial: trial.charAt(0).toUpperCase() + trial.slice(1) })}</h2>
          <p className="mt-3 text-muted">{t(L, 'price.p')}</p>
          <p className="mt-2 max-w-2xl text-ink">
            {t(L, 'price.line', {
              starter: TIER_NAMES.starter,
              pro: TIER_NAMES.pro,
              a: priceLabel('starter', 'monthly'),
              b: priceLabel('starter', 'annual'),
              c: priceLabel('pro', 'monthly'),
              d: priceLabel('pro', 'annual'),
            })}
          </p>
          <p className="mt-3">
            <Link href="/pricing" hrefLang="en" className="inline-flex min-h-11 items-center font-semibold text-brand-text underline">{t(L, 'price.cta')}</Link>
          </p>
        </section>

        <section aria-labelledby="faq-h" className={`${PAGE_BOX} pb-14`}>
          <h2 id="faq-h" className="text-3xl text-ink md:text-4xl">{t(L, 'faq.h')}</h2>
          <Ledger as="div" className="mt-5">
            {FAQS.map((f) => (
              <details key={f.q} className="group py-3">
                <summary className="min-h-11 cursor-pointer list-none text-lg font-semibold text-ink [&::-webkit-details-marker]:hidden">{f.q}</summary>
                <p className="mt-2 max-w-2xl text-muted">{f.a}</p>
              </details>
            ))}
          </Ledger>
          <p className="mt-4">
            <Link href="/faq" hrefLang="en" className="inline-flex min-h-11 items-center font-semibold text-brand-text underline">{t(L, 'faq.more')}</Link>
          </p>
        </section>

        <section className="on-brand bg-brand">
          <div className={`${PAGE_BOX} flex flex-col gap-5 py-14`}>
            <h2 className="m-0 font-display text-4xl text-on-brand md:text-5xl">{t(L, 'close.h')}</h2>
            <ZipForm id="close-zip" lang={L} />
            <div>
              <ButtonLink href="/signup" variant="outline-signal">{t(L, 'nav.start')}</ButtonLink>
            </div>
          </div>
        </section>
      </main>
      <FooterEs englishHref={PAIR.en} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd()).replace(/</g, '\\u003c') }} />
    </>
  );
}
