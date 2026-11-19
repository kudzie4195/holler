import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/footer';
import { BODY_TEXT, PAGE_BOX } from '@/components/grid';
import { RequestForm } from '@/components/request-form';
import { TopNav } from '@/components/top-nav';
import { CONFIRM_DAYS, MAX_REPLIES_PER_REQUEST, OPEN_DAYS, PURGE_AFTER_DAYS } from '@/lib/requests/constants';
import { requestsEnabled } from '@/lib/requests/enabled';
import { requestTradeGroups } from '@/lib/requests/trades';

export const metadata: Metadata = {
  title: 'Ask local businesses for a quote',
  description:
    'Tell local businesses what you need. Holler sends your request to matching businesses near you and they reply by email. Your address stays private. Free.',
  alternates: { canonical: '/request' },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Ask local businesses for a quote | Holler',
    description:
      'Tell local businesses what you need. Holler sends your request to matching businesses near you and they reply by email. Your address stays private. Free.',
    url: '/request',
    siteName: 'Holler',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Holler: know when your town needs you' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Ask local businesses for a quote | Holler',
    description:
      'Tell local businesses what you need. Holler sends your request to matching businesses near you and they reply by email. Your address stays private. Free.',
    images: ['/og.png'],
  },
};

/** Public, server-rendered. Everything a visitor needs to know is in the HTML; the form itself posts without JavaScript too. */
export default function RequestPage() {
  const groups = requestTradeGroups();
  const enabled = requestsEnabled();
  return (
    <>
      <TopNav />
      <main id="main" className={`w-full flex-1 ${BODY_TEXT}`}>
        <div className="on-brand bg-brand">
          <div className={`${PAGE_BOX} pb-24 pt-6 md:pb-28 md:pt-10`}>
            <p className="eyebrow mb-3">For residents · Free</p>
            <h1 className="max-w-[22ch] text-5xl sm:text-6xl md:text-7xl">Ask local businesses for a quote.</h1>
            <p className="mt-4 max-w-xl text-lg text-on-brand-muted">
              Tell us what you need and your ZIP code. We send it to businesses on Holler that do that work near you. It is free.
            </p>
          </div>
        </div>
        <div className={`${PAGE_BOX} pb-20`}>
        <div className="max-w-3xl">
        <section aria-labelledby="request-form-title" className="on-light relative -mt-16 rounded-card border border-line bg-surface p-5 shadow-lift md:-mt-20 md:p-7">
          <h2 id="request-form-title" className="h-plain text-2xl text-ink">
            Your request
          </h2>
          <div className="mt-5">
            {enabled ? (
              <RequestForm groups={groups} />
            ) : (
              <p role="status" className="text-ink">
                Requests are paused right now. Try again later.
              </p>
            )}
          </div>
        </section>

        <section aria-labelledby="request-next" className="mt-12">
          <h2 id="request-next" className="text-3xl text-ink md:text-4xl">
            What happens after you send it
          </h2>
          <ol className="mt-6 flex list-none flex-col gap-5 text-ink [counter-reset:step] [&>li]:relative [&>li]:pl-12 [&>li]:[counter-increment:step] [&>li]:before:absolute [&>li]:before:left-0 [&>li]:before:top-0 [&>li]:before:inline-flex [&>li]:before:size-8 [&>li]:before:items-center [&>li]:before:justify-center [&>li]:before:rounded-full [&>li]:before:bg-brand [&>li]:before:font-mono [&>li]:before:text-sm [&>li]:before:text-signal [&>li]:before:content-[counter(step)]">
            <li>
              We email you a link. Open it, then press the button on the page. Nothing is posted until you press it. A request you never
              confirm is deleted after {CONFIRM_DAYS} days.
            </li>
            <li>
              Once you confirm, Holler&apos;s public pages show only the service and your city. Your description is never on a public
              page.
            </li>
            <li>
              Matching businesses near you get your description in their Holler feed and alert email, after a filter takes out phone
              numbers, emails, links, street addresses and names. It can miss things. Leave them out.
            </li>
            <li>
              They reply by email through Holler. You see the business name, its city and its reply. Businesses never see your email
              address unless you answer them. Then they get your address and what you write back. Nothing else.
            </li>
            <li>
              Your request stays open for {OPEN_DAYS} days. Close it sooner with the link in the email we send when it goes live. It
              leaves Holler&apos;s pages within about 15 minutes.
            </li>
          </ol>
        </section>

        <section aria-labelledby="request-know" className="mt-12">
          <h2 id="request-know" className="text-3xl text-ink md:text-4xl">
            Good to know
          </h2>
          <div className="mt-6 flex flex-col border-t-2 border-ink text-ink [&>p]:border-b [&>p]:border-line [&>p]:py-4">
            <p>
              Holler is new. Some areas have no businesses on it yet, so you may get no replies at all. Up to {MAX_REPLIES_PER_REQUEST}{' '}
              businesses can answer one request.
            </p>
            <p>
              Holler does not check businesses or their work. Ask for a license and proof of insurance before you hire anyone.
            </p>
            <p>
              We email a copy of each confirmed request to Holler&apos;s support inbox, so we can remove one that breaks the rules. Our
              email provider keeps its own delivery records.
            </p>
            <p>
              Close the request and we delete your email address and your description right away. If it just runs out, we delete them{' '}
              {PURGE_AFTER_DAYS} days later. We keep only the service, ZIP code, city and dates. Read the{' '}
              <Link href="/privacy" className="font-medium text-brand-text underline decoration-1 underline-offset-4">privacy policy</Link> for the details.
            </p>
            <p>It costs you nothing. Businesses pay for Holler.</p>
          </div>
        </section>
        </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
