import type { Metadata } from 'next';
import Link from 'next/link';
import { DocPage, DocSection } from '@/components/doc-page';
import { ButtonLink } from '@/components/button';
import { aboutCopy } from '@/lib/seo/public-copy';
import { TRIAL_DAYS } from '@/lib/plan/price-copy';

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
                <span className="sr-only"> (opens in a new tab)</span>
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
          <li>We never post for you, and we message nobody unless you write the reply and press send.</li>
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

      <div className="rounded-card border border-line bg-sand p-6 shadow-soft md:p-8">
        <p className="font-display text-2xl text-ink">Try it on your own town.</p>
        <p className="mt-2 text-muted">{TRIAL_DAYS} days free. No card to start.</p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/signup" size="lg">
            Start free for {TRIAL_DAYS} days
          </ButtonLink>
          <ButtonLink href="/check" variant="secondary" size="lg">
            Check your area
          </ButtonLink>
        </div>
      </div>
    </DocPage>
  );
}
