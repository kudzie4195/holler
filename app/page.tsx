import type { Metadata } from 'next';
import { Footer } from '@/components/footer';
import { TopNav } from '@/components/top-nav';
import { Anatomy } from '@/components/home/anatomy';
import { ClosingBand } from '@/components/home/closing-band';
import { Faq } from '@/components/home/faq';
import { Hero } from '@/components/home/hero';
import { LatestBand } from '@/components/home/latest-band';
import { Ledger } from '@/components/home/ledger';
import { PricingBand } from '@/components/home/pricing-band';
import { ProofStrip } from '@/components/home/proof-strip';
import { ledgerExamples } from '@/components/home/select';
import { homeCopy } from '@/lib/seo/public-copy';
import { loadHomeLive } from '@/lib/seo/home-live';
import { exampleMap } from '@/lib/seo/home-map';
import { ES_PAIRS, pairAlternates } from '@/lib/i18n/seo';
import { socialMeta } from '@/lib/seo/social';

const HOME_TITLE = 'See where the work is near you this week | Holler';

export function generateMetadata(): Metadata {
  const description = homeCopy().metaDescription;
  return {
    // Round 23: the page title, the share title and the h1 are now one message (owner wording), and the share card carries the picture.
    title: { absolute: HOME_TITLE },
    description,
    alternates: pairAlternates(ES_PAIRS[0], 'en'),
    ...socialMeta({ title: HOME_TITLE, description, path: '/' }),
  };
}

function faqLd(faqs: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

/**
 * The home page, Version 3 (gates/r9/design/project/V3.dc.html). Server components only, no client JavaScript.
 * Live parts (lib/seo/home-live.ts) are real data or absent: with no data the map, the alert card and the phone show the labelled
 * example set, and the newest-on-the-map band, the proof strip and the ledger's example lines are not rendered.
 * Body text sizes are in rem so browser text zoom scales them; only the fixed-size pictures (the map, the phone) keep px.
 */
export default async function Home() {
  const copy = homeCopy();
  const live = await loadHomeLive();
  const map = live.map ?? exampleMap();
  // The same list renders the FAQ and the FAQPage JSON-LD, so they cannot drift apart.
  const jsonLd = faqLd(copy.faqs);
  return (
    <>
      <TopNav />
      <main id="main" className="text-[1.0625rem] leading-[1.55]">
        <Hero lead={copy.heroLead} map={map} />
        <LatestBand map={map} />
        {live.proof ? <ProofStrip proof={live.proof} /> : null}
        <Anatomy map={map} steps={copy.steps} />
        <Ledger families={copy.families} examples={ledgerExamples(map, live.weather)} />
        <PricingBand />
        <Faq faqs={copy.faqs} />
        <ClosingBand />
      </main>
      <Footer />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
    </>
  );
}
