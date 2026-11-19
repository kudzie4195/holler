import type { Metadata } from 'next';
import Link from 'next/link';
import { absoluteUrl } from '@/lib/seo/canonical';
import { FAQ_GROUPS } from '@/lib/seo/faq';
import { FAQ_META, faqPageJsonLd } from '@/lib/seo/guides/seo';
import { socialMeta } from '@/lib/seo/social';
import { JsonLd, PageHeader, Shell, proseLink } from '../guides/_components/shell';

export function generateMetadata(): Metadata {
  const m = FAQ_META;
  return {
    title: { absolute: m.title },
    description: m.description,
    alternates: { canonical: absoluteUrl(m.path) },
    ...socialMeta({ title: m.title, description: m.description, path: m.path }),
  };
}

export default function FaqPage() {
  return (
    <Shell
      header={
        <PageHeader
          width="narrow"
          size="sm"
          crumbs={[{ name: 'Home', href: '/' }, { name: 'FAQ' }]}
          title="Holler questions and answers"
          lead={<p>Short answers about what Holler is, where the data comes from, what it costs and how resident requests work.</p>}
        />
      }
    >
      <JsonLd data={faqPageJsonLd()} />
      <nav aria-label="Question groups" className="flex flex-wrap gap-2">
        {FAQ_GROUPS.map((g) => (
          <a
            key={g.id}
            href={`#${g.id}`}
            className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-surface px-4 text-sm font-medium text-ink hover:border-ink hover:bg-sand"
          >
            {g.title}
          </a>
        ))}
      </nav>
      <div className="mt-12 flex flex-col gap-14">
        {FAQ_GROUPS.map((g) => (
          <section key={g.id} aria-labelledby={g.id}>
            <h2 id={g.id} className="h-plain text-2xl text-ink">
              {g.title}
            </h2>
            <dl className="mt-4 border-t-2 border-ink">
              {g.items.map((it) => (
                <div key={it.q} className="border-b border-line py-5">
                  <dt className="text-lg font-semibold text-ink">{it.q}</dt>
                  <dd className="mt-1 leading-relaxed text-ink">{it.a}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="mt-12 text-ink">
        More detail: see <Link href="/pricing" className={proseLink}>pricing</Link>, the <Link href="/guides" className={proseLink}>guides</Link>,
        the live <Link href="/data" className={proseLink}>numbers</Link>, or the <Link href="/request" className={proseLink}>resident request page</Link>.
      </p>
    </Shell>
  );
}
