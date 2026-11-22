import type { Metadata } from 'next';
import Link from 'next/link';
import { ComingNext } from '@/components/coming-next';
import { Footer } from '@/components/footer';
import { BODY_TEXT, PAGE_BOX } from '@/components/grid';
import { PageHeader } from '@/components/page-header';
import { Pricing } from '@/components/pricing';
import { TopNav } from '@/components/top-nav';
import { faqLd } from '@/lib/seo/jsonld';
import { jsonLdString } from '@/lib/seo/serialize';
import { socialMeta } from '@/lib/seo/social';
import { TIER_NAMES } from '@/lib/plan/limits';
import { COMPARISON, PRICING_DESCRIPTION, PRICING_FAQ, PRICING_INTRO, PRICING_TITLE, YEARLY_NOTE, pricingLd } from '@/lib/plan/pricing-page';

export const metadata: Metadata = {
  title: { absolute: PRICING_TITLE },
  description: PRICING_DESCRIPTION,
  alternates: { canonical: '/pricing' },
  ...socialMeta({ title: PRICING_TITLE, description: PRICING_DESCRIPTION, path: '/pricing' }),
};

export default function PricingPage() {
  return (
    <>
      <TopNav />
      <main id="main" className={`w-full flex-1 ${BODY_TEXT}`}>
        <PageHeader
          width="wide"
          eyebrow={`${TIER_NAMES.starter} and ${TIER_NAMES.pro}`}
          title="Holler pricing"
          lead={<p>{PRICING_INTRO[0]}</p>}
        />

        <section aria-labelledby="plans-h" className="bg-background">
          <div className={`${PAGE_BOX} py-12 md:py-16`}>
            <h2 id="plans-h" className="sr-only">
              Plans
            </h2>
            <Pricing />
            {YEARLY_NOTE ? <p className="mt-4 text-sm text-muted">{YEARLY_NOTE}</p> : null}
          </div>
        </section>

        {/* Below the cards: heading left, body right from md up (the home FAQ shape), so the lower sections use the full box. */}
        <section aria-labelledby="compare-h" className="bg-sand">
          <div className={`${PAGE_BOX} py-12 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12 md:py-16`}>
            <h2 id="compare-h" className="text-3xl text-ink md:text-4xl">
              {TIER_NAMES.starter} and {TIER_NAMES.pro} side by side
            </h2>
            <div className="mt-6 min-w-0 overflow-x-auto md:mt-0">
              <table className="w-full border-collapse border-t-2 border-ink text-left text-base">
                <thead>
                  <tr className="border-b border-line font-mono text-xs uppercase tracking-[0.06em]">
                    <th scope="col" className="py-3 pr-4 font-medium text-muted">
                      <span className="sr-only">Feature</span>
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium text-ink">
                      {TIER_NAMES.starter}
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium text-brand-text">
                      {TIER_NAMES.pro}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map(([label, s, p]) => (
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
          <ComingNext page="pricing" split />
        </div>

        <section aria-labelledby="faq-h" className={`${PAGE_BOX} pb-16 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12 md:pb-20`}>
          <h2 id="faq-h" className="text-3xl text-ink md:text-4xl">
            Billing questions
          </h2>
          <div className="min-w-0">
            <dl className="mt-6 border-t-2 border-ink md:mt-0">
              {PRICING_FAQ.map((f) => (
                <div key={f.q} className="border-b border-line py-5">
                  <dt className="text-lg font-semibold text-ink">{f.q}</dt>
                  <dd className="mt-1 text-muted">{f.a}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-8 text-sm text-muted">
              The full rules are in the{' '}
              <Link href="/terms" className="font-medium text-brand-text underline decoration-1 underline-offset-4">
                terms
              </Link>
              .
            </p>
          </div>
        </section>
      </main>
      <Footer />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString([pricingLd(), faqLd(PRICING_FAQ)]) }} />
    </>
  );
}
