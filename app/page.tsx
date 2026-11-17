import type { Metadata } from 'next';
import { ButtonLink } from '@/components/button';
import { CheckForm } from '@/components/check-form';
import { Card } from '@/components/card';
import { StaticChip } from '@/components/chip';
import { Badge } from '@/components/badge';
import { Footer } from '@/components/footer';
import { TopNav } from '@/components/top-nav';
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

export default function Home() {
  const copy = homeCopy();
  const jsonLd = faqLd(copy.faqs);
  return (
    <>
      <TopNav />
      <main id="main">
        {/* Hero */}
        <section className="mx-auto grid w-full max-w-5xl gap-12 px-5 pb-16 pt-12 md:grid-cols-[1.1fr_1fr] md:items-center md:gap-14 md:pb-24 md:pt-20">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-accent-text">For people with a truck, not a pitch deck</p>
            <h1 className="mt-4 text-4xl text-ink md:text-6xl">Know when your town needs you.</h1>
            <p className="mt-5 max-w-xl text-lg text-muted">{copy.heroLead}</p>
            <div className="mt-8">
              <CheckForm idPrefix="hero" />
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <ButtonLink href="/signup" variant="secondary">
                Start free trial
              </ButtonLink>
              <ButtonLink href="/local" variant="ghost">
                See a city page
              </ButtonLink>
            </div>
            <p className="mt-4 text-sm text-muted">No card to start. $5 a month or $48 a year after. Holler never posts for you.</p>
          </div>
          <ExampleAlerts examples={copy.examples} />
        </section>

        {/* How it works */}
        <section id="how" className="border-y border-line bg-surface">
          <div className="mx-auto w-full max-w-5xl px-5 py-16 md:py-24">
            <h2 className="text-2xl text-ink md:text-4xl">How it works</h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-10">
              {copy.steps.map((s, i) => (
                <li key={s.title}>
                  <span className="font-mono text-sm tabular-nums text-accent-text">0{i + 1}</span>
                  <h3 className="mt-2 text-lg text-ink">{s.title}</h3>
                  <p className="mt-2 text-muted">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Sources */}
        <section id="sources" className="mx-auto w-full max-w-5xl px-5 py-16 md:py-24">
          <h2 className="text-2xl text-ink md:text-4xl">{copy.sourcesHeading}</h2>
          <p className="mt-4 max-w-2xl text-lg text-muted">{copy.sourcesIntro}</p>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2">
            {copy.sources.map((s) => (
              <li key={s.name}>
                <Card className="h-full !p-5">
                  <h3 className="text-lg text-ink">{s.name}</h3>
                  <p className="mt-1 text-muted">{s.note}</p>
                </Card>
              </li>
            ))}
          </ul>
          <p className="mt-6 max-w-2xl text-sm text-muted">{copy.sourcesNote}</p>
        </section>

        {/* Who it's for */}
        <section id="who" className="border-y border-line bg-surface">
          <div className="mx-auto w-full max-w-5xl px-5 py-16 md:py-24">
            <h2 className="text-2xl text-ink md:text-4xl">Built for people who show up</h2>
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
            <dl className="mt-10 grid gap-6 md:grid-cols-3">
              {copy.who.map((w) => (
                <div key={w.title}>
                  <dt className="font-semibold text-ink">{w.title}</dt>
                  <dd className="mt-1 text-muted">{w.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mx-auto w-full max-w-5xl px-5 py-16 md:py-24">
          <div className="grid gap-10 md:grid-cols-2 md:items-center">
            <div>
              <h2 className="text-2xl text-ink md:text-4xl">One price. Cheap on purpose.</h2>
              <p className="mt-4 text-lg text-muted">
                Try it for a week. If it finds you a job, it paid for the year. If not, walk away. You never entered a card.
              </p>
            </div>
            <Card className="!p-7">
              <p className="flex items-baseline gap-2">
                <span className="font-mono text-6xl font-semibold tabular-nums tracking-tight text-ink">$5</span>
                <span className="text-lg text-muted">a month</span>
              </p>
              <p className="mt-1 text-lg text-muted">or $48 a year</p>
              <p className="mt-1 font-semibold text-accent-text">7-day free trial. No card to start.</p>
              <ul className="mt-6 flex flex-col gap-3 text-ink">
                {[
                  'Every source, every trade',
                  'Email alerts, at most one an hour',
                  'Draft replies you edit and post yourself',
                  'Cancel any time from Settings',
                ].map((li) => (
                  <li key={li} className="flex gap-3">
                    <svg className="mt-1 shrink-0 text-success" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                      <path d="m4 9.5 3.2 3.2L14 5.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>{li}</span>
                  </li>
                ))}
              </ul>
              <ButtonLink href="/signup" size="lg" full className="mt-7">
                Start free for 7 days
              </ButtonLink>
            </Card>
          </div>
        </section>

        {/* Comparison */}
        <section className="border-y border-line bg-surface">
          <div className="mx-auto w-full max-w-5xl px-5 py-16 md:py-24">
            <h2 className="text-2xl text-ink md:text-4xl">Other tools charge $199 a month to watch one site</h2>
            <p className="mt-4 max-w-2xl text-lg text-muted">
              Holler costs $5, reads far more than one website, and keeps its hands off your accounts.
            </p>
            <div className="mt-10 overflow-hidden rounded-card border border-line bg-surface">
              <div aria-hidden="true" className="grid grid-cols-2 bg-background text-sm font-semibold md:grid-cols-[1fr_1.5fr_1.5fr]">
                <div className="hidden px-5 py-3 md:block" />
                <div className="px-4 py-3 text-accent-text md:px-5">Holler</div>
                <div className="px-4 py-3 text-muted md:px-5">A typical $199/mo Reddit bot</div>
              </div>
              <ul>
                {copy.comparison.map((row) => (
                  <li key={row.label} className="grid grid-cols-2 border-t border-line md:grid-cols-[1fr_1.5fr_1.5fr]">
                    <p className="col-span-2 px-4 pt-4 text-xs font-semibold uppercase tracking-wide text-muted md:col-span-1 md:px-5 md:py-4 md:text-sm md:normal-case md:tracking-normal">
                      {row.label}
                    </p>
                    <p className="px-4 py-3 font-medium text-ink md:px-5 md:py-4">
                      <span className="sr-only">Holler: </span>
                      {row.holler}
                    </p>
                    <p className="px-4 py-3 text-muted md:px-5 md:py-4">
                      <span className="sr-only">A typical $199 a month Reddit bot: </span>
                      {row.other}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto w-full max-w-3xl px-5 py-16 md:py-24">
          <h2 className="text-2xl text-ink md:text-4xl">Questions</h2>
          <div className="mt-8 divide-y divide-line border-y border-line">
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
          <div className="rounded-card bg-ink px-6 py-12 text-center md:px-12 md:py-16">
            <h2 className="mx-auto max-w-xl text-2xl text-white md:text-4xl">Find out what is happening near you this week.</h2>
            <p className="mx-auto mt-4 max-w-md text-white/75">Seven days free. No card. Set up in about a minute.</p>
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
          <Card key={e.title} className="!p-4 sm:!p-5">
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
