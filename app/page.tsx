import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ButtonLink } from '@/components/button';
import { CheckForm } from '@/components/check-form';
import { Card } from '@/components/card';
import { Badge } from '@/components/badge';
import { kindStripe } from '@/components/signal-meta';
import { Footer } from '@/components/footer';
import { TopNav } from '@/components/top-nav';
import { Pricing } from '@/components/pricing';
import { MainStreet } from '@/components/illustrations/main-street';
import {
  ArrowRightIcon,
  BellIcon,
  BookIcon,
  ChartIcon,
  ClipboardIcon,
  ContractIcon,
  EnvelopeIcon,
  FloodIcon,
  HailIcon,
  HardHatIcon,
  HouseIcon,
  MapPinIcon,
  MegaphoneIcon,
  PlaneIcon,
  QuestionIcon,
  RecordIcon,
  StormCloudIcon,
} from '@/components/icons';
import { homeCopy, type ExampleAlert, type HomeIcon } from '@/lib/seo/public-copy';
import { loadHomeLive, type HomeLive } from '@/lib/seo/home-live';
import { tradeEntry, tradePath } from '@/lib/seo/trade-view';
import { priceLabel, TIER_LABEL } from '@/lib/stripe/plans';
import { TRIAL_DAYS } from '@/lib/auth/membership';

export function generateMetadata(): Metadata {
  return {
    title: { absolute: 'Holler: know when your town needs you' },
    description: homeCopy().metaDescription,
    alternates: { canonical: '/' },
  };
}

/** Trade chips: label shown, category id for the /for/<id> page. A chip links only when that page exists. */
const trades: [string, string][] = [
  ['Roofers', 'roofing'],
  ['Plumbers', 'plumbing'],
  ['HVAC', 'hvac'],
  ['Electricians', 'electrical'],
  ['Tree service', 'tree-service'],
  ['Restoration', 'restoration'],
  ['Movers', 'moving'],
  ['Auto glass', 'auto-glass'],
  ['Food trucks', 'food-truck'],
];

/** Each source with its record family dot (same three families as the badges): weather blue, spending and city records sage, the rest orange. */
const publicSources: { name: string; dot: string }[] = [
  { name: 'National Weather Service', dot: 'bg-storm' },
  { name: 'NOAA Storm Prediction Center', dot: 'bg-storm' },
  { name: 'FEMA', dot: 'bg-storm' },
  { name: 'USGS', dot: 'bg-storm' },
  { name: 'FAA', dot: 'bg-accent' },
  { name: 'USAspending.gov', dot: 'bg-sage-mark' },
  { name: 'City open-data portals', dot: 'bg-sage-mark' },
];

/**
 * Hero lead: the words that name a record family ("storm", "permit", "311 request") are shown as that family's tag, with its icon.
 * No words are added or changed (the home page has a word budget); if the copy changes and a word is missing, it simply stays plain.
 * Text on tint: 7.59, 6.47 and 6.49 to 1.
 */
const LEAD_FAMILIES: { word: string; icon: HomeIcon; tint: string }[] = [
  { word: 'storm', icon: 'storm', tint: 'bg-kind-alert-bg text-kind-alert-fg' },
  { word: 'permit', icon: 'hardhat', tint: 'bg-kind-permit-bg text-kind-permit-fg' },
  { word: '311 request', icon: 'megaphone', tint: 'bg-kind-civic-bg text-kind-civic-fg' },
];

function HeroLead({ text }: { text: string }) {
  const pattern = new RegExp(`\\b(${LEAD_FAMILIES.map((f) => f.word).join('|')})\\b`);
  const parts = text.split(pattern);
  const out: ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const f = i % 2 === 1 ? LEAD_FAMILIES.find((x) => x.word === part) : undefined;
    if (!f) {
      out.push(part);
      continue;
    }
    // Punctuation right after a tag ("storm,") sits tight against the pill and never wraps away from it.
    const next = parts[i + 1] ?? '';
    const punct = /^[,.;:!?]+/.exec(next)?.[0] ?? '';
    if (punct) parts[i + 1] = next.slice(punct.length);
    out.push(
      <span key={i} className="whitespace-nowrap">
        <span className={`rounded-full py-0.5 pl-1.5 pr-2 font-semibold box-decoration-clone ${f.tint}`}>
          <span aria-hidden="true" className="mr-1 inline-block align-[-0.15em]">
            {ICON[f.icon].el('h-[1em] w-[1em]')}
          </span>
          {part}
        </span>
        {punct}
      </span>,
    );
  }
  return <>{out}</>;
}

/** How it works: one family tint per step (orange, storm blue, sage). Icon on tint: 4.96, 4.44 and 4.01 to 1 (3:1 needed). */
const STEP_TINT = ['bg-accent-soft text-accent-text', 'bg-sky text-storm', 'bg-sage text-sage-mark'];

/** Icon and quiet kind tint for each copy icon name. Tints are the badge colors, so a tile matches the chips on real alerts. */
const ICON: Record<HomeIcon, { el: (c: string) => ReactNode; tint: string }> = {
  pin: { el: (c) => <MapPinIcon className={c} />, tint: 'bg-accent-soft text-accent-text' },
  bell: { el: (c) => <BellIcon className={c} />, tint: 'bg-accent-soft text-accent-text' },
  envelope: { el: (c) => <EnvelopeIcon className={c} />, tint: 'bg-accent-soft text-accent-text' },
  storm: { el: (c) => <StormCloudIcon className={c} />, tint: 'bg-kind-alert-bg text-kind-alert-fg' },
  hail: { el: (c) => <HailIcon className={c} />, tint: 'bg-kind-report-bg text-kind-report-fg' },
  flood: { el: (c) => <FloodIcon className={c} />, tint: 'bg-kind-disaster-bg text-kind-disaster-fg' },
  plane: { el: (c) => <PlaneIcon className={c} />, tint: 'bg-kind-travel-bg text-kind-travel-fg' },
  hardhat: { el: (c) => <HardHatIcon className={c} />, tint: 'bg-kind-permit-bg text-kind-permit-fg' },
  megaphone: { el: (c) => <MegaphoneIcon className={c} />, tint: 'bg-kind-civic-bg text-kind-civic-fg' },
  clipboard: { el: (c) => <ClipboardIcon className={c} />, tint: 'bg-kind-civic-bg text-kind-civic-fg' },
  contract: { el: (c) => <ContractIcon className={c} />, tint: 'bg-kind-contract-bg text-kind-contract-fg' },
};

const KIND_TINT: Record<string, string> = {
  alert: 'bg-kind-alert-bg text-kind-alert-fg',
  report: 'bg-kind-report-bg text-kind-report-fg',
  permit: 'bg-kind-permit-bg text-kind-permit-fg',
  civic: 'bg-kind-civic-bg text-kind-civic-fg',
  contract: 'bg-kind-contract-bg text-kind-contract-fg',
  event: 'bg-kind-event-bg text-kind-event-fg',
  disaster: 'bg-kind-disaster-bg text-kind-disaster-fg',
  quake: 'bg-kind-quake-bg text-kind-quake-fg',
  travel: 'bg-kind-travel-bg text-kind-travel-fg',
};

/** The Learn row, merged into the questions band: three icon links, a few words each. */
const learn = [
  { href: '/guides', title: 'Guides', icon: <BookIcon className="h-5 w-5" /> },
  { href: '/data', title: 'Data', icon: <ChartIcon className="h-5 w-5" /> },
  { href: '/faq', title: 'All questions', icon: <QuestionIcon className="h-5 w-5" /> },
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

const h2 = 'text-3xl text-ink md:text-4xl';

export default async function Home() {
  const copy = homeCopy();
  const live = await loadHomeLive();
  // The same list renders the accordions and the FAQPage JSON-LD, so they cannot drift apart.
  const jsonLd = faqLd(copy.faqs);
  return (
    <>
      <TopNav />
      <main id="main">
        {/* Hero */}
        <div className="hero-paper">
          <section className="mx-auto grid w-full max-w-5xl gap-10 px-5 pb-12 pt-10 md:grid-cols-[1.1fr_1fr] md:items-center md:gap-14 md:pb-16 md:pt-14">
            <div className="min-w-0">
              <h1 className="text-[2.5rem] leading-[1.05] text-ink sm:text-5xl md:text-6xl">Know when your town needs you.</h1>
              <p className="mt-5 max-w-xl text-lg leading-[1.75] text-muted">
                <HeroLead text={copy.heroLead} />
              </p>
              <div className="mt-7 rounded-card border border-line bg-surface p-4 shadow-soft sm:p-5">
                <CheckForm idPrefix="hero" />
              </div>
              <p className="mt-4 flex items-center gap-2 text-sm text-muted">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sage text-sage-ink">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                </span>
                <span>
                  {TIER_LABEL.starter} {priceLabel('starter', 'monthly')} a month, {TIER_LABEL.pro} {priceLabel('pro', 'monthly')}. {TRIAL_DAYS} days free, no card.
                </span>
              </p>
            </div>
            <div className="min-w-0">
              <MainStreet className="h-auto w-full" />
              <div className="-mt-6 sm:px-6">
                <ExampleAlerts examples={copy.examples} />
              </div>
            </div>
          </section>
        </div>

        {/* Trust strip: names only, no logos, no endorsement implied */}
        <section aria-labelledby="reads-from" className="border-y border-line bg-surface">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-5 py-5">
            <h2 id="reads-from" className="font-sans text-xs font-semibold uppercase tracking-wide text-ink">
              Reads public data from
            </h2>
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              {publicSources.map((s) => (
                <li key={s.name} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                  {s.name}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {live ? <ThisWeek live={live} /> : null}

        {/* How it works */}
        <section id="how" aria-labelledby="how-h" className="mx-auto w-full max-w-5xl px-5 py-12 md:py-16">
          <h2 id="how-h" className={`${h2} text-center`}>
            How it works
          </h2>
          <div className="relative mt-10">
            <div aria-hidden="true" className="pointer-events-none absolute left-[17%] right-[17%] top-8 hidden border-t-2 border-dashed border-line md:block" />
            <ol className="relative grid gap-6 md:grid-cols-3 md:gap-6">
              {copy.steps.map((s, i) => (
                <li key={s.title} className="relative flex items-center gap-4 md:flex-col md:gap-0 md:text-center">
                  <span className={`relative inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 border-background ${STEP_TINT[i % STEP_TINT.length]}`}>
                    {ICON[s.icon].el('h-8 w-8')}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-lg text-ink md:mt-4">{s.title}</h3>
                    <p className="mt-1 text-muted md:mx-auto md:max-w-[16rem]">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* What Holler watches */}
        <section id="sources" aria-labelledby="watch-h" className="border-y border-line bg-sky">
          <div className="mx-auto w-full max-w-5xl px-5 py-12 md:py-16">
            <h2 id="watch-h" className={h2}>
              What Holler watches
            </h2>
            <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 md:gap-4">
              {copy.watches.map((w) => (
                <li key={w.label} className="flex min-h-28 flex-col items-start justify-between gap-3 rounded-card border border-line bg-background p-4 sm:min-h-32 sm:p-5">
                  <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full sm:h-12 sm:w-12 ${ICON[w.icon].tint}`}>{ICON[w.icon].el('h-6 w-6 sm:h-7 sm:w-7')}</span>
                  <span className="font-semibold leading-snug text-ink">{w.label}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-sm text-muted">{copy.watchNote}</p>
          </div>
        </section>

        {/* Who it is for */}
        <section id="who" aria-labelledby="who-h" className="mx-auto w-full max-w-5xl px-5 py-10 md:py-14">
          <h2 id="who-h" className={h2}>
            Made for local trades
          </h2>
          <ul className="mt-7 flex flex-wrap gap-2">
            {trades.map(([label, id]) => (
              <li key={id}>
                <TradeChip href={tradeEntry(id) ? tradePath(id) : null}>{label}</TradeChip>
              </li>
            ))}
            <li>
              <Link
                href="/for"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft px-4 text-sm font-semibold text-accent-text transition-colors duration-150 hover:border-accent"
              >
                All trades
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </li>
          </ul>
        </section>

        {/* Residents */}
        <section aria-labelledby="residents" className="border-y border-line bg-sage">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-12 md:flex-row md:items-center md:justify-between md:py-14">
            <div className="flex items-start gap-4">
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface text-sage-ink">
                <HouseIcon />
              </span>
              <div>
                <h2 id="residents" className={h2}>
                  Need something done at home?
                </h2>
                <p className="mt-2 max-w-xl text-lg text-ink/80">Post it free. Local businesses can reply.</p>
              </div>
            </div>
            <ButtonLink href="/request" size="lg" className="shrink-0 self-start md:self-center">
              Request a service
            </ButtonLink>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" aria-labelledby="pricing-h" className="mx-auto w-full max-w-5xl px-5 py-12 md:py-16">
          <h2 id="pricing-h" className={`${h2} mb-6`}>
            Two plans. Both are cheap.
          </h2>
          <Pricing />
        </section>

        {/* Questions, with the Learn links merged in under them: one band instead of two. */}
        <section id="faq" aria-labelledby="faq-h" className="border-y border-line bg-sand">
          <div className="mx-auto w-full max-w-3xl px-5 py-12 md:py-16">
            <h2 id="faq-h" className={`${h2} text-center`}>
              Questions
            </h2>
            <div className="mt-8 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface px-5 shadow-soft">
              {copy.faqs.map((f) => (
                <details key={f.q} className="group">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-lg font-semibold text-ink [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sand text-ink transition-transform group-open:rotate-180">
                      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                        <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </summary>
                  <p className="pb-5 pr-10 text-muted">{f.a}</p>
                </details>
              ))}
            </div>
            <nav aria-label="Learn more" className="mt-6">
              <ul className="grid gap-3 sm:grid-cols-3">
                {learn.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="group flex min-h-14 items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 shadow-soft transition-[box-shadow,border-color] duration-150 hover:border-ink/25 hover:shadow-lift"
                    >
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text">{l.icon}</span>
                      <span className="font-semibold text-ink group-hover:underline group-hover:underline-offset-4">{l.title}</span>
                      <ArrowRightIcon className="ml-auto h-4 w-4 shrink-0 text-accent-text" />
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </section>

        {/* Final CTA */}
        <section className="mx-auto w-full max-w-5xl px-5 py-12 md:py-16">
          <div className="rounded-card bg-ink px-6 py-10 text-center shadow-lift md:px-12 md:py-14">
            <h2 className="mx-auto max-w-xl text-3xl text-white md:text-4xl">See what is near you.</h2>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <ButtonLink href="/signup" size="lg">
                Start free for {TRIAL_DAYS} days
              </ButtonLink>
              <ButtonLink href="/check" size="lg" variant="secondary">
                Check your area
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
    </>
  );
}

function TradeChip({ href, children }: { href: string | null; children: ReactNode }) {
  const cls = 'inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink shadow-[0_1px_1px_rgb(74_52_24/0.04)]';
  return href ? (
    <Link href={href} className={`${cls} transition-colors duration-150 hover:border-ink/40 hover:bg-sand`}>
      {children}
    </Link>
  ) : (
    <span className={cls}>{children}</span>
  );
}

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * "This week on Holler": real counts and a few real, recent records (lib/seo/home-live.ts). Rendered only when there is data.
 * The words say what these are: records Holler read from public sources. Not jobs, not leads.
 */
function ThisWeek({ live }: { live: HomeLive }) {
  const stats = [
    { n: live.total7, label: 'records in 7 days' },
    ...(live.cities30 ? [{ n: live.cities30, label: 'cities in 30 days' }] : []),
    ...(live.sources ? [{ n: live.sources, label: 'sources reporting' }] : []),
  ];
  return (
    <section aria-labelledby="this-week" className="border-b border-line bg-sand">
      <div className="mx-auto w-full max-w-5xl px-5 py-12 md:py-14">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 id="this-week" className={h2}>
            This week on Holler
          </h2>
        </div>
        <p className="mt-1 text-muted">Public records Holler read. Not jobs or leads.</p>
        <div className={`mt-8 grid gap-8 ${live.recent.length ? 'md:grid-cols-[1fr_1.35fr] md:items-start md:gap-10' : ''}`}>
          <dl className="grid grid-cols-3 gap-3 md:grid-cols-1 md:gap-4">
            {stats.map((s) => (
              <div key={s.label} className="flex min-w-0 flex-col rounded-card border border-line bg-surface px-3 py-4 md:flex-row md:items-baseline md:gap-4 md:px-5">
                <dt className="order-2 mt-2 text-xs leading-snug text-muted sm:text-sm md:mt-0">{s.label}</dt>
                <dd className="order-1 font-display text-3xl font-semibold leading-none tracking-tight text-ink tabular-nums sm:text-4xl md:min-w-[6.5rem]">
                  {fmt(s.n)}
                </dd>
              </div>
            ))}
          </dl>
          {live.recent.length ? (
            <ul className="flex flex-col gap-3" aria-label="Recent records">
              {live.recent.map((r) => {
                const body = (
                  <>
                    <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${KIND_TINT[r.kind] ?? 'bg-line/60 text-muted'}`}>
                      <RecordIcon kind={r.kind} subtype={r.subtype} className="h-6 w-6" />
                    </span>
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        <Badge kind={r.kind} />
                        <time dateTime={r.occurredAt}>{r.ago}</time>
                      </span>
                      <span className="font-semibold leading-snug text-ink">{r.title}</span>
                      <span className="flex items-center gap-1 text-sm text-muted">
                        <MapPinIcon className="h-4 w-4 shrink-0" />
                        {r.place}
                      </span>
                    </span>
                  </>
                );
                const cls = 'flex items-start gap-3 rounded-card border border-line bg-surface p-4 shadow-soft';
                return (
                  <li key={r.id}>
                    {r.path ? (
                      <Link href={r.path} className={`${cls} transition-[box-shadow,border-color] duration-150 hover:border-ink/25 hover:shadow-lift`}>
                        {body}
                      </Link>
                    ) : (
                      <div className={cls}>{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** Static, clearly labelled illustration of what an alert looks like. Not live data. The first example needs no key; see homeCopy. */
function ExampleAlerts({ examples }: { examples: ExampleAlert[] }) {
  return (
    <div role="group" aria-label="Example alerts, not live data" className="relative">
      <div className="flex flex-col gap-4">
        {examples.map((e, i) => (
          <Card key={e.title} className={`!p-4 !shadow-lift sm:!p-5 ${kindStripe(e.kind)}`}>
            {i === 0 ? (
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
                {examples.length > 1 ? 'Example alerts' : 'Example alert'}, not live data
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <Badge kind={e.kind} />
              <span className="font-mono text-xs tabular-nums">{e.time}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-xs tabular-nums">{e.distance}</span>
            </div>
            <p className="mt-2 text-lg font-semibold leading-snug text-ink">{e.title}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
