import type { Metadata } from 'next';
import Link from 'next/link';
import { absoluteUrl } from '@/lib/seo/canonical';
import { FAQ_GROUPS } from '@/lib/seo/faq';
import { FAQ_META, faqPageJsonLd } from '@/lib/seo/guides/seo';
import { socialMeta } from '@/lib/seo/social';
import { Crumbs, JsonLd, Shell, proseLink } from '../guides/_components/shell';

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
    <Shell>
      <JsonLd data={faqPageJsonLd()} />
      <Crumbs items={[{ name: 'Home', href: '/' }, { name: 'FAQ' }]} />
      <h1 className="text-4xl text-ink">Holler questions and answers</h1>
      <p className="mt-4 text-lg text-ink/90">
        Short answers about what Holler is, where the data comes from, what it costs and how resident requests work.
      </p>
      <nav aria-label="Question groups" className="mt-6 flex flex-wrap gap-2">
        {FAQ_GROUPS.map((g) => (
          <a
            key={g.id}
            href={`#${g.id}`}
            className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink/40"
          >
            {g.title}
          </a>
        ))}
      </nav>
      <div className="mt-10 flex flex-col gap-12">
        {FAQ_GROUPS.map((g) => (
          <section key={g.id} aria-labelledby={g.id}>
            <h2 id={g.id} className="text-2xl text-ink">
              {g.title}
            </h2>
            <dl className="mt-4 flex flex-col gap-6">
              {g.items.map((it) => (
                <div key={it.q}>
                  <dt className="text-lg font-semibold text-ink">{it.q}</dt>
                  <dd className="mt-1 text-base leading-relaxed text-ink/90">{it.a}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="mt-12 text-base text-ink/90">
        More detail: see <Link href="/pricing" className={proseLink}>pricing</Link>, the <Link href="/guides" className={proseLink}>guides</Link>,
        the live <Link href="/data" className={proseLink}>numbers</Link>, or the <Link href="/request" className={proseLink}>resident request page</Link>.
      </p>
    </Shell>
  );
}
