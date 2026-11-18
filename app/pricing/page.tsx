import type { Metadata } from 'next';
import Link from 'next/link';
import { ComingNext } from '@/components/coming-next';
import { Footer } from '@/components/footer';
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
      <main id="main" className="w-full flex-1">
        <div className="hero-paper border-b border-line">
          <div className="mx-auto w-full max-w-5xl px-5 pb-10 pt-12 md:pb-14 md:pt-16">
            <h1 className="text-4xl text-ink md:text-[2.75rem]">Holler pricing</h1>
            <div className="mt-4 flex max-w-2xl flex-col gap-2 text-lg text-muted">
              {PRICING_INTRO.map((t) => (
                <p key={t}>{t}</p>
              ))}
            </div>
          </div>
        </div>

        <section aria-labelledby="plans-h" className="mx-auto w-full max-w-5xl px-5 py-12 md:py-16">
          <h2 id="plans-h" className="sr-only">
            Plans
          </h2>
          <Pricing />
          <p className="mt-4 text-sm text-muted">{YEARLY_NOTE}</p>
        </section>

        <section aria-labelledby="compare-h" className="border-y border-line bg-surface">
          <div className="mx-auto w-full max-w-3xl px-5 py-12 md:py-16">
            <h2 id="compare-h" className="text-2xl text-ink md:text-3xl">
              Starter and Pro side by side
            </h2>
            <div className="mt-6 overflow-x-auto rounded-card border border-line">
              <table className="w-full text-left text-base">
                <thead className="bg-background text-sm">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold text-muted">
                      <span className="sr-only">Feature</span>
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold text-ink">
                      {TIER_NAMES.starter}
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold text-accent-text">
                      {TIER_NAMES.pro}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map(([label, s, p]) => (
                    <tr key={label} className="border-t border-line">
                      <th scope="row" className="px-4 py-3 font-medium text-ink">
                        {label}
                      </th>
                      <td className="px-4 py-3 font-mono tabular-nums text-ink">{s}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-ink">{p}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <div className="mx-auto w-full max-w-3xl px-5 py-12 md:py-16">
          <ComingNext page="pricing" />
        </div>

        <section aria-labelledby="faq-h" className="mx-auto w-full max-w-3xl px-5 py-12 md:py-16">
          <h2 id="faq-h" className="text-2xl text-ink md:text-3xl">
            Billing questions
          </h2>
          <dl className="mt-6 flex flex-col gap-6">
            {PRICING_FAQ.map((f) => (
              <div key={f.q}>
                <dt className="text-lg font-semibold text-ink">{f.q}</dt>
                <dd className="mt-1 text-ink/90">{f.a}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 text-sm text-muted">
            The full rules are in the{' '}
            <Link href="/terms" className="font-medium text-accent-text underline">
              terms
            </Link>
            .
          </p>
        </section>
      </main>
      <Footer />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString([pricingLd(), faqLd(PRICING_FAQ)]) }} />
    </>
  );
}
