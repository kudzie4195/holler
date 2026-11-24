import type { Metadata } from 'next';
import Link from 'next/link';
import { DocPage, DocSection } from '@/components/doc-page';
import { COMPANY } from '@/lib/legal/company';
import { LEGAL_UPDATED, Support, supportAddress } from '@/lib/legal/pages';

// Public on purpose: it needs no sign-in and is not noindex. It is not in the main nav. Round 24 (review P1-5): Holler is a website
// only, so the page describes the website steps only. Every step is checked against the web code in tests/legal/delete-account.test.ts.
export const metadata: Metadata = {
  title: 'Delete your account',
  description: 'How to delete your Holler account on the website, what we delete, what we keep, and how long it takes.',
  alternates: { canonical: '/delete-account' },
};

export default function DeleteAccountPage() {
  const support = supportAddress();
  return (
    <DocPage
      title="Delete your Holler account"
      intro="You can delete your Holler account yourself, on the website. You do not need to ask us."
      updated={LEGAL_UPDATED}
    >
      <DocSection title="On the website">
        <ol className="list-decimal pl-5">
          <li>
            Sign in at <Link href="/login" className="inline-flex min-h-11 items-center">{COMPANY.site}</Link>.
          </li>
          <li>Open Settings.</li>
          <li>Under Delete account, press Delete my account.</li>
          <li>Press Yes, delete everything.</li>
        </ol>
      </DocSection>

      <DocSection title="What we delete">
        <p>
          Your business profile and your matched alerts go, with any reply drafts. So do your feedback and answers about
          alerts, your alert log, your feature picks, and the record of which resident requests you replied to. We also delete
          your account steps (signup, trial start, first alert and first payment), your source tag, the record of trial
          emails. A plan you bought on our website is canceled at once.
        </p>
      </DocSection>

      <DocSection title="What we keep">
        <ul>
          <li>
            Your sign-in. It is shared with other apps we run, so it stays. Holler is removed from it. Ask us and we will delete
            it too.
          </li>
          <li>A note of when your free trial started. It stops a second free trial.</li>
          <li>
            Visit counts. They hold only a random ID from your browser, never your account number. They are deleted about 13
            months after the visit.
          </li>
          <li>
            Trend counts made from old public records. They never held your name or account. Public records are about places
            and permits, not about your account, so deleting your account does not remove them.
          </li>
          <li>Stripe keeps its own records for website payments.</li>
        </ul>
      </DocSection>

      <DocSection title="How long it takes">
        <p>
          Deletion starts the moment you confirm. The data listed above leaves our database right then, you are signed
          out, and there is no waiting period in which you could undo it, so be sure before you press the button. If something
          goes wrong, you see an error and can safely try again. If we cannot cancel a website plan, we delete nothing.
        </p>
      </DocSection>

      <DocSection title="Cannot sign in?">
        <p>
          Write to <Support support={support} /> from the email on your account and ask us to delete it. We may ask you to
          confirm it is you. We answer within 30 days. Our <Link href="/privacy">Privacy Policy</Link> has the full details.
        </p>
      </DocSection>
    </DocPage>
  );
}
