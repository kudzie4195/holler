import type { Metadata } from 'next';
import { ButtonLink } from '@/components/button';
import { Footer } from '@/components/footer';
import { BODY_TEXT, PAGE_BOX } from '@/components/grid';
import { PageHeader } from '@/components/page-header';
import { TopNav } from '@/components/top-nav';
import { CONFIRM_DAYS } from '@/lib/requests/constants';

export const metadata: Metadata = {
  title: 'Check your email',
  description: 'We sent you a link to confirm your request on Holler.',
  alternates: { canonical: '/request/sent' },
  robots: { index: false, follow: true },
};

/** Where every accepted request lands, new or repeated email alike. It says nothing about the address that was used. */
export default function RequestSentPage() {
  return (
    <>
      <TopNav />
      <main id="main" className={`w-full flex-1 ${BODY_TEXT}`}>
        <PageHeader
          width="narrow"
          size="sm"
          eyebrow="Request received"
          title="Check your email."
          lead={
            <div className="flex flex-col gap-3" role="status">
              <p>We sent you a link. Open it, then press the button on the page to post your request.</p>
              <p>
                The link works for {CONFIRM_DAYS} days. Until you press the button, nothing is shown to anyone. If you never do, we delete
                the request.
              </p>
            </div>
          }
        />
        <div className={`${PAGE_BOX} pb-20 pt-10`}>
        <div className="max-w-2xl">
        <div className="flex flex-col gap-3 text-ink">
          <p>No email? Look in your spam folder first. We send at most 3 links a day to one address, so a repeat may not get a new one.</p>
          <p>Wrong address? Send the form again with the right one.</p>
        </div>
        <div className="mt-8">
          <ButtonLink href="/request" variant="secondary">
            Back to the form
          </ButtonLink>
        </div>
        </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
