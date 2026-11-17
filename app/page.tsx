import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink } from '@/components/button';
import { CheckForm } from '@/components/check-form';
import { Card } from '@/components/card';
import { StaticChip } from '@/components/chip';
import { Badge } from '@/components/badge';
import { Footer } from '@/components/footer';
import { TopNav } from '@/components/top-nav';
import { Pricing } from '@/components/pricing';
import { MainStreet } from '@/components/illustrations/main-street';
import { homeCopy, type ExampleAlert } from '@/lib/seo/public-copy';

export function generateMetadata(): Metadata {
  return {
    title: { absolute: 'Holler: know when your town needs you' },
    description: homeCopy().metaDescription,
    alternates: { canonical: '/' },
  };
}

const trades = [
  'Roofers',
  'Plumbers',
  'HVAC',
  'Electricians',
  'Tree service',
  'Landscapers',
  'Cleaners',
  'Pest control',
  'Restoration',
  'Painters',
  'Towing',
  'Movers',
  'Locksmiths',
  'Auto glass',
  'Food trucks',
  'Caterers',
  'Delivery drivers',
  'Real estate',
];

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

const publicSources = [
  'National Weather Service',
  'NOAA Storm Prediction Center',
  'FEMA',
  'USGS',
  'FAA',
  'USAspending.gov',
  'City open-data portals',
];

const learn = [
  { href: '/guides', title: 'Guides', body: 'Short, plain guides for local trades. Start here if you are new.' },
  {
    href: '/data',
    title: 'Local public records in numbers',
    body: 'Counts of the public records Holler has read in the last 7 and 30 days.',
  },
  { href: '/faq', title: 'FAQ', body: 'Plans, data sources, coverage and privacy, answered in plain words.' },
];

export default function Home() {
  const copy = homeCopy();
  const jsonLd = faqLd(copy.faqs);
  return (
    <>
      <TopNav />
      <main id="main">
        {/* Hero */}
        <div className="hero-paper">
          <section className="mx-auto grid w-full max-w-5xl gap-12 px-5 pb-14 pt-10 md:grid-cols-[1.1fr_1fr] md:items-center md:gap-14 md:pb-20 md:pt-16">
            <div className="min-w-0">
              <p className="text-sm font-semibold uppercase tracking-wide text-accent-text">For people with a truck, not a pitch deck</p>
              <h1 className="mt-4 text-[2.5rem] leading-[1.05] text-ink sm:text-5xl md:text-6xl">Know when your town needs you.</h1>
              <p className="mt-5 max-w-xl text-lg text-muted">{copy.heroLead}</p>
              <div className="mt-8 rounded-card border border-line bg-surface p-4 shadow-soft sm:p-5">
                <CheckForm idPrefix="hero" />
              </div>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                <ButtonLink href="/signup" variant="secondary">
                  Start free trial
                </ButtonLink>
                <ButtonLink href="/local" variant="ghost">
                  See a city page
                </ButtonLink>
              </div>
              <p className="mt-4 text-sm text-muted">
                No card to start. Starter is $5 a month and Pro is $9.99. Holler never posts for you.
              </p>
            </div>
            <div className="min-w-0">
              <MainStreet className="h-auto w-full" />
              <div className="mt-5 sm:px-4">
                <ExampleAlerts examples={copy.examples} />
              </div>
            </div>
          </section>
        </div>

        {/* Trust strip: names only, no logos, no endorsement implied */}
        <section aria-labelledby="reads-from" className="border-y border-line bg-surface">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-5 py-6 md:flex-row md:items-center md:gap-6">
            <h2 id="reads-from" className="shrink-0 font-sans text-sm font-semibold tracking-normal text-ink">
              Reads public data from
            </h2>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
              {publicSources.map((s) => (
                <li key={s} className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto w-full max-w-5xl px-5 py-16 md:py-24">
          <h2 className="text-3xl text-ink md:text-4xl">How it works</h2>
          <ol className="mt-10 grid gap-5 md:grid-cols-3">
            {copy.steps.map((s, i) => (
              <li key={s.title}>
                <Card className="h-full">
                  <span
                    aria-hidden="true"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft font-mono text-sm font-semibold tabular-nums text-accent-text"
                  >
                    {i + 1}
                  </span>
                  <h3 className="mt-4 text-lg text-ink">{s.title}</h3>
                  <p className="mt-2 text-muted">{s.body}</p>
                </Card>
              </li>
            ))}
          </ol>
        </section>

        {/* Sources */}
        <section id="sources" className="border-y border-line bg-surface">
          <div className="mx-auto w-full max-w-5xl px-5 py-16 md:py-24">
            <h2 className="text-3xl text-ink md:text-4xl">{copy.sourcesHeading}</h2>
            <p className="mt-4 max-w-2xl text-lg text-muted">{copy.sourcesIntro}</p>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2">
              {copy.sources.map((s) => (
                <li key={s.name}>
                  <Card className="h-full !bg-background !p-5">
                    <h3 className="text-lg text-ink">{s.name}</h3>
                    <p className="mt-1 text-muted">{s.note}</p>
                  </Card>
                </li>
              ))}
            </ul>
            <p className="mt-6 max-w-2xl text-sm text-muted">{copy.sourcesNote}</p>
          </div>
        </section>

        {/* Who it's for */}
        <section id="who" className="mx-auto w-full max-w-5xl px-5 py-16 md:py-24">
          <h2 className="text-3xl text-ink md:text-4xl">Built for people who show up</h2>
          <ul className="mt-8 flex flex-wrap gap-2">
            {trades.map((t) => (
              <li key={t}>
                <StaticChip>{t}</StaticChip>
              </li>
            ))}
            <li>
              <StaticChip className="text-muted">and more</StaticChip>
            </li>
          </ul>
          <dl className="mt-10 grid gap-5 md:grid-cols-3">
            {copy.who.map((w) => (
              <div key={w.title} className="rounded-card border border-line bg-sand p-5">
                <dt className="font-semibold text-ink">{w.title}</dt>
                <dd className="mt-1 text-muted">{w.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Residents */}
        <section aria-labelledby="residents" className="border-y border-line bg-sage">
          <div className="mx-auto grid w-full max-w-5xl gap-8 px-5 py-14 md:grid-cols-[1.4fr_1fr] md:items-center md:py-20">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-sage-ink">For homeowners and renters</p>
              <h2 id="residents" className="mt-3 text-3xl text-ink md:text-4xl">
                Need something done at home?
              </h2>
              <p className="mt-4 max-w-xl text-lg text-ink/80">
                Anyone can ask for a local service on Holler, and it costs nothing. Businesses nearby that do that kind of work see your
                request and reply to you by email.
              </p>
              <p className="mt-3 max-w-xl text-sm text-muted">
                Once you confirm it, a public page shows only the service and your city. Businesses see your email address only if you reply to them.
              </p>
            </div>
            <div className="flex md:justify-end">
              <ButtonLink href="/request" size="lg">
                Request a service
              </ButtonLink>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mx-auto w-full max-w-5xl px-5 py-16 md:py-24">
          <div className="max-w-2xl">
            <h2 className="text-3xl text-ink md:text-4xl">Two plans. Both cheap on purpose.</h2>
            <p className="mt-4 text-lg text-muted">
              Starter is $5 a month for one service area and up to five trades. Pro is $9.99 a month for up to three areas, 15 trades
              and five keyword watches. Try it free for a week. No card.
            </p>
          </div>
          <div className="mt-10">
            <Pricing />
          </div>
          <p className="mt-6 text-sm text-muted">
            Yearly billing and the full list are on the{' '}
            <Link href="/pricing" className="inline-flex min-h-11 items-center font-medium text-ink underline underline-offset-2 hover:text-accent-text">
              pricing page
            </Link>
            .
          </p>
        </section>

        {/* Pricing model: Holler's own terms, stated plainly. No other product is named. */}
        <section aria-labelledby="flat-price" className="border-y border-line bg-surface">
          <div className="mx-auto w-full max-w-5xl px-5 py-16 md:py-24">
            <h2 id="flat-price" className="text-3xl text-ink md:text-4xl">
              {copy.flatPrice.heading}
            </h2>
            <p className="mt-4 max-w-2xl text-lg text-muted">{copy.flatPrice.intro}</p>
            <dl className="mt-10 grid gap-5 sm:grid-cols-2 md:grid-cols-4">
              {copy.flatPrice.rows.map((row) => (
                <div key={row.label} className="rounded-card border border-line bg-background p-5">
                  <dt className="font-semibold text-ink">{row.label}</dt>
                  <dd className="mt-1 text-muted">{row.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Learn */}
        <section aria-labelledby="learn" className="mx-auto w-full max-w-5xl px-5 pt-16 md:pt-24">
          <h2 id="learn" className="text-3xl text-ink md:text-4xl">
            Learn more
          </h2>
          <ul className="mt-8 grid gap-4 md:grid-cols-3">
            {learn.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="group flex h-full flex-col rounded-card border border-line bg-surface p-5 shadow-soft transition-[box-shadow,border-color] duration-150 hover:border-ink/25 hover:shadow-lift"
                >
                  <span className="text-lg font-semibold text-ink group-hover:underline group-hover:underline-offset-4">{l.title}</span>
                  <span className="mt-1 text-muted">{l.body}</span>
                  <span aria-hidden="true" className="mt-4 text-sm font-semibold text-accent-text">
                    Read &rarr;
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto w-full max-w-3xl px-5 py-16 md:py-24">
          <h2 className="text-3xl text-ink md:text-4xl">Questions</h2>
          <div className="mt-8 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface px-5 shadow-soft">
            {copy.faqs.map((f) => (
              <details key={f.q} className="group py-1">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-3 text-lg font-semibold text-ink [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <svg
                    className="shrink-0 text-muted transition-transform group-open:rotate-180"
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </summary>
                <p className="pb-4 pr-8 text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="mx-auto w-full max-w-5xl px-5 pb-20 md:pb-28">
          <div className="rounded-card bg-ink px-6 py-12 text-center shadow-lift md:px-12 md:py-16">
            <h2 className="mx-auto max-w-xl text-3xl text-white md:text-4xl">Find out what is happening near you this week.</h2>
            <p className="mx-auto mt-4 max-w-md text-white/80">Seven days free. No card. Set up in about a minute.</p>
            <div className="mt-8 flex justify-center">
              <ButtonLink href="/signup" size="lg">
                Start free for 7 days
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
    </>
  );
}

/** Static, clearly labelled illustration of what an alert looks like. Not live data. The first example needs no key; see homeCopy. */
function ExampleAlerts({ examples }: { examples: ExampleAlert[] }) {
  return (
    <div role="group" aria-label="Example alerts, not live data" className="relative">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex items-center rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {examples.length > 1 ? 'Example alerts' : 'Example alert'}
        </span>
        <span className="text-xs text-muted">Illustration, not live data</span>
      </div>
      <div className="flex flex-col gap-4">
        {examples.map((e) => (
          <Card key={e.title} className="!p-4 !shadow-lift sm:!p-5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <Badge kind={e.kind} />
              <span>{e.source}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-xs tabular-nums">{e.time}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-xs tabular-nums">{e.distance}</span>
            </div>
            <p className="mt-3 text-lg font-semibold leading-snug text-ink">{e.title}</p>
            <p className="mt-1 text-muted">{e.body}</p>
            <div className="mt-4 flex flex-wrap gap-2" aria-hidden="true">
              {e.actions.map((a) =>
                a === 'Draft reply' ? (
                  <span key={a} className="inline-flex min-h-9 items-center rounded-full bg-accent px-4 text-sm font-semibold text-ink">
                    {a}
                  </span>
                ) : (
                  <span key={a} className="inline-flex min-h-9 items-center rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink">
                    {a}
                  </span>
                ),
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
