import type { Metadata } from 'next';
import Link from 'next/link';
import { Card } from '@/components';
import { absoluteUrl } from '@/lib/seo/canonical';
import { GUIDES, guidePath } from '@/lib/seo/guides';
import { GUIDES_HUB_META, hubJsonLd } from '@/lib/seo/guides/seo';
import { socialMeta } from '@/lib/seo/social';
import { Crumbs, JsonLd, Shell, fmtReviewed } from './_components/shell';

export function generateMetadata(): Metadata {
  const m = GUIDES_HUB_META;
  return {
    title: { absolute: m.title },
    description: m.description,
    alternates: { canonical: absoluteUrl(m.path) },
    ...socialMeta({ title: m.title, description: m.description, path: m.path }),
  };
}

export default function GuidesHubPage() {
  return (
    <Shell>
      <JsonLd data={hubJsonLd()} />
      <Crumbs items={[{ name: 'Home', href: '/' }, { name: 'Guides' }]} />
      <h1 className="text-4xl text-ink">Guides for local service businesses</h1>
      <p className="mt-4 text-lg text-ink/90">
        Public data can tell you where work is about to start. These eight guides explain how to read it, which official source to trust and
        what to say when you find a lead. Each fact about an agency or a dataset links to the publisher&apos;s own site.
      </p>
      <ul className="mt-10 flex flex-col gap-4">
        {GUIDES.map((g) => (
          <li key={g.slug}>
            <Card as="article">
              <h2 className="text-xl text-ink">
                <Link href={guidePath(g.slug)} className="underline-offset-2 hover:underline">
                  {g.title}
                </Link>
              </h2>
              <p className="mt-2 text-base text-muted">{g.description}</p>
              <p className="mt-3 text-sm text-muted">Last reviewed {fmtReviewed(g.lastReviewed)}</p>
            </Card>
          </li>
        ))}
      </ul>
      <p className="mt-10 text-base text-ink/90">
        Want the answers in short form? Read the <Link href="/faq" className="font-medium text-accent-text underline underline-offset-2">FAQ</Link>, or see the{' '}
        <Link href="/data" className="font-medium text-accent-text underline underline-offset-2">live numbers</Link> behind Holler.
      </p>
    </Shell>
  );
}
