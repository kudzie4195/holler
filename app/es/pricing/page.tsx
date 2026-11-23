import type { Metadata } from 'next';
import Link from 'next/link';
import { ComingNext } from '@/components/coming-next';
import { FooterEs } from '@/components/es/footer';
import { TopNavEs } from '@/components/es/top-nav';
import { BODY_TEXT, PAGE_BOX } from '@/components/grid';
import { PageHeader } from '@/components/page-header';
import { Pricing } from '@/components/pricing';
import { t } from '@/lib/i18n';
import { ES_PAIRS, pairAlternates } from '@/lib/i18n/seo';
import { jsonLdString } from '@/lib/seo/serialize';
import { planNameEs } from '@/lib/plan/price-copy-es';
import { COMPARISON_ES, PRICING_DESCRIPTION_ES, PRICING_FAQ_ES, PRICING_INTRO_ES, PRICING_TITLE_ES, YEARLY_NOTE_ES, pricingFaqLdEs, pricingLdEs } from '@/lib/plan/pricing-page-es';

const L = 'es' as const;
const PAIR = ES_PAIRS[2];

export const metadata: Metadata = {
  title: { absolute: PRICING_TITLE_ES },
  description: PRICING_DESCRIPTION_ES,
  alternates: pairAlternates(PAIR, 'es'),
  openGraph: {
    type: 'website',
    siteName: 'Holler',
    locale: 'es_US',
    title: PRICING_TITLE_ES,
    description: PRICING_DESCRIPTION_ES,
    url: PAIR.es,
    images: [{ url: '/og.png', width: 1200, height: 630, alt: PRICING_TITLE_ES }],
  },
  twitter: { card: 'summary_large_image', title: PRICING_TITLE_ES, description: PRICING_DESCRIPTION_ES, images: ['/og.png'] },
};

const SOLO = planNameEs('starter');
const PRO = planNameEs('pro');

/**
 * /es/pricing: the Spanish twin of /pricing. Static, like the English page. The same plan cards (components/pricing.tsx with lang "es"),
 * the same comparison rows and billing questions in Spanish (lib/plan/pricing-page-es.ts), the same "coming next" list. The terms stay
 * English, and the link says so.
 */
export default function PricingPageEs() {
  return (
    <>
      <TopNavEs englishHref={PAIR.en} />
      <main id="main" className={`w-full flex-1 ${BODY_TEXT}`}>
        <PageHeader width="wide" eyebrow={t(L, 'pricing.eyebrow', { solo: SOLO, pro: PRO })} title={t(L, 'pricing.h1')} lead={<p>{PRICING_INTRO_ES}</p>} />

        <section aria-labelledby="plans-h" className="bg-background">
          <div className={`${PAGE_BOX} py-12 md:py-16`}>
            <h2 id="plans-h" className="sr-only">
              {t(L, 'pricing.plans_h')}
            </h2>
            <Pricing lang={L} />
            {YEARLY_NOTE_ES ? <p className="mt-4 text-sm text-muted">{YEARLY_NOTE_ES}</p> : null}
          </div>
        </section>

        <section aria-labelledby="compare-h" className="bg-sand">
          <div className={`${PAGE_BOX} py-12 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12 md:py-16`}>
            <h2 id="compare-h" className="text-3xl text-ink md:text-4xl">
              {t(L, 'pricing.compare_h', { solo: SOLO, pro: PRO })}
            </h2>
            <div className="mt-6 min-w-0 overflow-x-auto md:mt-0">
              <table className="w-full border-collapse border-t-2 border-ink text-left text-base">
                <thead>
                  <tr className="border-b border-line font-mono text-xs uppercase tracking-[0.06em]">
                    <th scope="col" className="py-3 pr-4 font-medium text-muted">
                      <span className="sr-only">{t(L, 'pricing.feature')}</span>
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium text-ink">
                      {SOLO}
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium text-brand-text">
                      {PRO}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ES.map(([label, s, p]) => (
                    <tr key={label} className="border-b border-line">
                      <th scope="row" className="py-3 pr-4 font-medium text-ink">
                        {label}
                      </th>
                      <td className="px-4 py-3 tabular-nums text-ink">{s}</td>
                      <td className="px-4 py-3 tabular-nums text-ink">{p}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <div className={`${PAGE_BOX} py-12 md:py-16`}>
          <ComingNext page="pricing" split lang={L} />
        </div>

        <section aria-labelledby="faq-h" className={`${PAGE_BOX} pb-16 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12 md:pb-20`}>
          <h2 id="faq-h" className="text-3xl text-ink md:text-4xl">
            {t(L, 'pricing.faq_h')}
          </h2>
          <div className="min-w-0">
            <dl className="mt-6 border-t-2 border-ink md:mt-0">
              {PRICING_FAQ_ES.map((f) => (
                <div key={f.q} className="border-b border-line py-5">
                  <dt className="text-lg font-semibold text-ink">{f.q}</dt>
                  <dd className="mt-1 text-muted">{f.a}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-8 text-sm text-muted">
              {t(L, 'pricing.terms_pre')}{' '}
              <Link href="/terms" hrefLang="en" className="font-medium text-brand-text underline decoration-1 underline-offset-4">
                {t(L, 'pricing.terms_link')}
              </Link>
              .
            </p>
          </div>
        </section>
      </main>
      <FooterEs englishHref={PAIR.en} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString([pricingLdEs(), pricingFaqLdEs()]) }} />
    </>
  );
}
