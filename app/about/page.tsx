import type { Metadata } from 'next';
import Link from 'next/link';
import { DocPage, DocSection } from '@/components/doc-page';
import { ButtonLink } from '@/components/button';
import { aboutCopy } from '@/lib/seo/public-copy';

export function generateMetadata(): Metadata {
  return {
    title: 'About',
    description: aboutCopy().metaDescription,
    alternates: { canonical: '/about' },
  };
}

export default function AboutPage() {
  const copy = aboutCopy();
  return (
    <DocPage
      title="About Holler"
      intro="Holler tells local businesses when their area needs them."
    >
      <DocSection title="What it is">
        {copy.whatItIs.map((t) => (
          <p key={t}>{t}</p>
        ))}
      </DocSection>

      <DocSection title="Where the data comes from">
        <p>{copy.dataIntro}</p>
        <ul>
          {copy.sources.map((s) => (
            <li key={s.name}>
              <a href={s.href} target="_blank" rel="noopener noreferrer">
                {s.name}
              </a>
              . {s.what}
            </li>
          ))}
        </ul>
        <p>{copy.coverage}</p>
        <p>{copy.cadence}</p>
      </DocSection>

      <DocSection title="What we never do">
        <ul>
          <li>We never post, comment or message anyone for you.</li>
          <li>We never log in to, or connect to, your social accounts.</li>
          <li>We never sell upvotes, fake reviews or bought accounts.</li>
          <li>We never use data from LinkedIn, Facebook, Nextdoor or Craigslist, and we do not scrape sites that forbid it.</li>
          <li>We never sell your email or business details.</li>
        </ul>
        {copy.postsNote ? <p>{copy.postsNote}</p> : null}
      </DocSection>

      <DocSection title="City pages">
        <p>
          Every city also has a free public page built from the same data, with each item cited. Start at{' '}
          <Link href="/local">City pages</Link>.
        </p>
      </DocSection>

      <div>
        <ButtonLink href="/signup" size="lg">
          Start free for 7 days
        </ButtonLink>
      </div>
    </DocPage>
  );
}
