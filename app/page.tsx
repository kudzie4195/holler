import type { Metadata } from 'next';
import { ButtonLink } from '@/components/button';
import { CheckForm } from '@/components/check-form';
import { Card } from '@/components/card';
import { StaticChip } from '@/components/chip';
import { ExampleAlerts } from '@/components/example-alert';
import { Footer } from '@/components/footer';
import { TopNav } from '@/components/top-nav';
import { CADENCE_SHORT } from '@/lib/seo/cadence';

export const metadata: Metadata = {
  title: { absolute: 'Holler: know when your town needs you' },
  alternates: { canonical: '/' },
};

const steps = [
  {
    title: 'Tell us what you do and where',
    body: 'Your business name, up to five trades, a ZIP code and how far you will drive. One screen, about a minute.',
  },
  {
    title: 'We watch the public record',
    body: `Storm reports, permits, 311 requests, events and people asking for help. ${CADENCE_SHORT}`,
  },
  {
    title: 'You get a short alert',
    body: 'An email and a feed. Open the source, save it, or ask for a draft reply that you edit and post yourself.',
  },
];

const sources = [
  { name: 'Weather alerts', note: 'Warnings and watches from the National Weather Service.' },
  { name: 'Hail and wind reports', note: 'Local storm reports from NOAA Storm Prediction Center.' },
  { name: 'Disasters', note: 'FEMA declarations and USGS earthquake reports.' },
  { name: 'Building permits', note: 'New permits, where your city publishes them.' },
  { name: '311 requests', note: 'Complaints and service requests from city open data.' },
  { name: 'Health inspections', note: 'Failed inspections, where the health department publishes them.' },
  { name: 'Federal contracts', note: 'New awards and bids on USAspending.gov and SAM.gov.' },
  { name: 'Events', note: 'Big concerts, games and festivals from public listings.' },
  { name: 'Airport delays', note: 'Ground stops and delays at 40 major airports, from the FAA.' },
  { name: 'People asking online', note: 'Public posts like "anyone recommend a roofer?" found through licensed search APIs.' },
];

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

const comparison = [
  { label: 'Price', holler: '$5 a month or $48 a year', other: '$199 a month' },
  { label: 'What it watches', holler: '10+ public sources: weather, permits, 311, events and more', other: 'One website' },
  { label: 'Posting', holler: 'Never posts for you, so there is nothing to get banned', other: 'Often sells upvotes and posts from bought accounts' },
  { label: 'Built for', holler: 'Roofers, plumbers, cleaners, food trucks, drivers', other: 'SaaS founders' },
];

const faqs = [
  {
    q: 'Do you post for me?',
    a: 'No. Holler never posts, comments or messages anyone on your behalf, and it never touches your social accounts. If you ask for a draft reply, you get text to edit and post yourself.',
  },
  {
    q: 'Where does the data come from?',
    a: 'Official APIs and open data: the National Weather Service, NOAA, FEMA, USGS, the FAA, city open data portals, USAspending.gov and SAM.gov. People asking online come from licensed search APIs, and we keep only the title, a short snippet and the link. We do not scrape sites that forbid it.',
  },
  {
    q: 'Do I need a card to try it?',
    a: 'No. You get 7 days free with no card. After that it is $5 a month or $48 a year. If you do not subscribe, your feed locks and your account stays put until you decide.',
  },
  {
    q: 'How fast are the alerts?',
    a: 'Weather alerts and airport delays are checked every 15 minutes, storm and earthquake reports every 30 minutes, and posts from people asking online every one to six hours. City records, federal contracts and events are checked a few times a day, and some cities publish permits a day or more after they are issued. Emails go out at most once an hour. You get a digest, not a flood.',
  },
  {
    q: 'Does it work in my town?',
    a: 'Weather alerts, disasters and federal contracts cover the whole US, and airport status covers 40 major airports. Permits, 311 and inspections come from the cities Holler has connected so far, such as Chicago, New York and Austin. Your city page under City pages shows what is flowing there.',
  },
  {
    q: 'Can I cancel?',
    a: 'Any time, from Settings. You can also delete your account there, which removes your profile, matches and drafts.',
  },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
};

export default function Home() {
  return (
    <>
      <TopNav />
      <main id="main">
        {/* Hero */}
        <section className="mx-auto grid w-full max-w-5xl gap-12 px-5 pb-16 pt-12 md:grid-cols-[1.1fr_1fr] md:items-center md:gap-14 md:pb-24 md:pt-20">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-accent-text">For people with a truck, not a pitch deck</p>
            <h1 className="mt-4 text-4xl text-ink md:text-6xl">Know when your town needs you.</h1>
            <p className="mt-5 max-w-xl text-lg text-muted">
              Holler watches storms, permits, 311 reports, events and neighbors asking for help, and when something nearby
              fits what you do, you get a short alert.
            </p>
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
          <ExampleAlerts />
        </section>

        {/* How it works */}
        <section id="how" className="border-y border-line bg-surface">
          <div className="mx-auto w-full max-w-5xl px-5 py-16 md:py-24">
            <h2 className="text-2xl text-ink md:text-4xl">How it works</h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-10">
              {steps.map((s, i) => (
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
          <h2 className="text-2xl text-ink md:text-4xl">Ten kinds of signal, one feed</h2>
          <p className="mt-4 max-w-2xl text-lg text-muted">
            Everything comes from public sources, and each alert links to the page or dataset it came from so you can check it yourself.
          </p>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2">
            {sources.map((s) => (
              <li key={s.name}>
                <Card className="h-full !p-5">
                  <h3 className="text-lg text-ink">{s.name}</h3>
                  <p className="mt-1 text-muted">{s.note}</p>
                </Card>
              </li>
            ))}
          </ul>
          <p className="mt-6 max-w-2xl text-sm text-muted">
            Not every city publishes every dataset, and Holler has connected only some of them. You only get alerts from what is public where you work.
          </p>
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
              <div>
                <dt className="font-semibold text-ink">Roofers and glass shops</dt>
                <dd className="mt-1 text-muted">Hail and wind reports, the same afternoon they land.</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Food trucks and caterers</dt>
                <dd className="mt-1 text-muted">Big events and festivals coming to your side of town.</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Drivers and movers</dt>
                <dd className="mt-1 text-muted">Airport delays and event crowds, before the rush starts.</dd>
              </div>
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
                {comparison.map((row) => (
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
            {faqs.map((f) => (
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
