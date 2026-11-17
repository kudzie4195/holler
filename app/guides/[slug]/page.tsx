import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { absoluteUrl } from '@/lib/seo/canonical';
import { GUIDES, guideBySlug } from '@/lib/seo/guides';
import { linksIn, isExternal } from '@/lib/seo/guides/inline';
import { guideJsonLd, guideMeta } from '@/lib/seo/guides/seo';
import { socialMeta } from '@/lib/seo/social';
import { Crumbs, Inline, JsonLd, Shell, fmtReviewed, proseLink } from '../_components/shell';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const g = guideBySlug(slug);
  if (!g) return { title: 'Not found', robots: { index: false } };
  const m = guideMeta(g);
  return {
    title: { absolute: m.title },
    description: m.description,
    alternates: { canonical: absoluteUrl(m.path) },
    ...socialMeta({ title: m.title, description: m.description, path: m.path, type: 'article' }),
  };
}

function sectionId(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default async function GuidePage({ params }: Props) {
  const { slug } = await params;
  const g = guideBySlug(slug);
  if (!g) notFound();

  const allText = [...g.sections.flatMap((s) => [...s.paragraphs, ...(s.bullets ?? [])]), g.howHolerHelps];
  const seen = new Set<string>();
  const sources = allText
    .flatMap((t) => linksIn(t))
    .filter((l) => isExternal(l.href) && !seen.has(l.href) && seen.add(l.href))
    .map((l) => ({ ...l, host: new URL(l.href).hostname.replace(/^www\./, '') }));

  return (
    <Shell>
      <JsonLd data={guideJsonLd(g)} />
      <Crumbs items={[{ name: 'Home', href: '/' }, { name: 'Guides', href: '/guides' }, { name: g.title }]} />
      <h1 className="text-4xl text-ink">{g.title}</h1>
      <p className="mt-5 rounded-control border border-line bg-surface p-4 text-lg leading-relaxed text-ink">{g.directAnswer}</p>
      <p className="mt-3 text-sm text-muted">
        Last reviewed <time dateTime={g.lastReviewed}>{fmtReviewed(g.lastReviewed)}</time>
      </p>

      <div className="mt-10 flex flex-col gap-10">
        {g.sections.map((s) => (
          <section key={s.heading} aria-labelledby={sectionId(s.heading)}>
            <h2 id={sectionId(s.heading)} className="text-2xl text-ink">
              {s.heading}
            </h2>
            <div className="mt-3 flex flex-col gap-3 text-base leading-relaxed text-ink/90">
              {s.paragraphs.map((p) => (
                <p key={p}>
                  <Inline text={p} />
                </p>
              ))}
              {s.bullets ? (
                s.ordered ? (
                  <ol className="flex list-decimal flex-col gap-2 pl-5">
                    {s.bullets.map((b) => (
                      <li key={b} className="pl-1">
                        <Inline text={b} />
                      </li>
                    ))}
                  </ol>
                ) : (
                  <ul className="flex list-disc flex-col gap-2 pl-5">
                    {s.bullets.map((b) => (
                      <li key={b} className="pl-1">
                        <Inline text={b} />
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </div>
          </section>
        ))}

        <section aria-labelledby="how-holler-helps" className="rounded-card border border-line bg-surface p-5 md:p-6">
          <h2 id="how-holler-helps" className="text-2xl text-ink">
            How Holler helps
          </h2>
          <p className="mt-3 text-base leading-relaxed text-ink/90">
            <Inline text={g.howHolerHelps} />
          </p>
        </section>

        <section aria-labelledby="quick-answers">
          <h2 id="quick-answers" className="text-2xl text-ink">
            Quick answers
          </h2>
          <dl className="mt-3 flex flex-col gap-4">
            {g.faq.map((f) => (
              <div key={f.q}>
                <dt className="font-semibold text-ink">{f.q}</dt>
                <dd className="mt-1 text-base text-ink/90">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="related">
          <h2 id="related" className="text-2xl text-ink">
            Related pages
          </h2>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-base">
            {g.related.map((r) => (
              <li key={r.href} className="pl-1">
                <Link href={r.href} className={proseLink}>
                  {r.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {sources.length > 0 ? (
          <section aria-labelledby="sources">
            <h2 id="sources" className="text-2xl text-ink">
              Official sources used
            </h2>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-base">
              {sources.map((s) => (
                <li key={s.href} className="pl-1">
                  <a href={s.href} target="_blank" rel="noopener" className={proseLink}>
                    {s.label}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>{' '}
                  <span className="text-muted">({s.host})</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}

