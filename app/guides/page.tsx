import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChartIcon, ContractIcon, EnvelopeIcon, HailIcon, HardHatIcon, MegaphoneIcon, StorefrontIcon, WrenchIcon } from '@/components/icons';
import { absoluteUrl } from '@/lib/seo/canonical';
import { GUIDES, guidePath } from '@/lib/seo/guides';
import { GUIDES_HUB_META, hubJsonLd } from '@/lib/seo/guides/seo';
import { socialMeta } from '@/lib/seo/social';
import { JsonLd, PageHeader, Shell, fmtReviewed, proseLink } from './_components/shell';

export function generateMetadata(): Metadata {
  const m = GUIDES_HUB_META;
  return {
    title: { absolute: m.title },
    description: m.description,
    alternates: { canonical: absoluteUrl(m.path) },
    ...socialMeta({ title: m.title, description: m.description, path: m.path }),
  };
}

/** One small decorative icon per guide (the title carries the meaning). Unknown slugs get the wrench. */
const GUIDE_ICON: Record<string, ReactNode> = {
  'how-contractors-find-work-from-building-permits': <HardHatIcon />,
  'storm-damage-leads-from-weather-alerts-and-storm-reports': <HailIcon />,
  'what-311-requests-tell-local-service-businesses': <MegaphoneIcon />,
  'free-public-data-sources-for-local-leads': <ChartIcon />,
  'pay-per-lead-vs-flat-fee-alerts': <WrenchIcon />,
  'federal-contracts-for-small-local-businesses': <ContractIcon />,
  'new-business-licenses-as-a-lead-source': <StorefrontIcon />,
  'how-to-respond-to-a-local-lead-fast': <EnvelopeIcon />,
};

export default function GuidesHubPage() {
  return (
    <Shell
      header={
        <PageHeader
          width="narrow"
          size="sm"
          crumbs={[{ name: 'Home', href: '/' }, { name: 'Guides' }]}
          title="Guides for local service businesses"
        />
      }
    >
      <JsonLd data={hubJsonLd()} />
      <p className="text-lg text-ink">
        Public data can tell you where work is about to start. These eight guides explain how to read it, which official source to trust and
        what to say when you find a lead. Each fact about an agency or a dataset links to the publisher&apos;s own site.
      </p>
      <ul className="mt-10 border-t-2 border-ink">
        {GUIDES.map((g) => (
          <li key={g.slug} className="border-b border-line py-6">
            <article className="flex items-start gap-4">
              <span className="hidden size-11 shrink-0 items-center justify-center rounded-control bg-brand text-signal sm:inline-flex">
                {GUIDE_ICON[g.slug] ?? <WrenchIcon />}
              </span>
              <div className="min-w-0">
                <h2 className="h-plain text-xl text-ink">
                  <Link href={guidePath(g.slug)} className="decoration-1 underline-offset-4 hover:underline">
                    {g.title}
                  </Link>
                </h2>
                <p className="mt-2 text-base text-muted">{g.description}</p>
                <p className="mt-3 font-mono text-xs uppercase tracking-[0.06em] text-muted">Last reviewed {fmtReviewed(g.lastReviewed)}</p>
              </div>
            </article>
          </li>
        ))}
      </ul>
      <p className="mt-10 text-base text-ink">
        Want the answers in short form? Read the <Link href="/faq" className={proseLink}>FAQ</Link>, or see the{' '}
        <Link href="/data" className={proseLink}>live numbers</Link> behind Holler.
      </p>
    </Shell>
  );
}
