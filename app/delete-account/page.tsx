import type { Metadata } from 'next';
import Link from 'next/link';
import { DocPage, DocSection } from '@/components/doc-page';
import { COMPANY } from '@/lib/legal/company';
import { APP_DELETE_WORD, LEGAL_UPDATED, Support, supportAddress } from '@/lib/legal/pages';

// Public on purpose: Google Play's account deletion URL points here, so it needs no sign-in and is not noindex. It is not in the
// main nav. Every step is checked against the web and app code in tests/legal/delete-account.test.ts.
export const metadata: Metadata = {
  title: 'Delete your account',
  description: 'How to delete your Holler account in the app or on the website, what we delete, what we keep, and how long it takes.',
  alternates: { canonical: '/delete-account' },
};

export default function DeleteAccountPage() {
  const support = supportAddress();
  return (
    <DocPage
      title="Delete your Holler account"
      intro="You can delete your Holler account yourself, in the app or on the website. You do not need to ask us."
      updated={LEGAL_UPDATED}
    >
      <DocSection title="In the app">
        <ol className="list-decimal pl-5">
          <li>Open the Holler app and sign in.</li>
          <li>Go to Settings.</li>
          <li>Tap Delete account, at the bottom of the screen.</li>
          <li>Type {APP_DELETE_WORD} in the box, then tap Delete my account.</li>
        </ol>
        <p>
          If you bought your plan in the app, the app then tells you to cancel it in the App Store or Google Play. We cannot
          cancel it for you.
        </p>
      </DocSection>

      <DocSection title="On the website">
        <ol className="list-decimal pl-5">
          <li>
            Sign in at <Link href="/login">{COMPANY.site}</Link>.
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
          emails, and the push tokens for your phones. A plan you bought on our website is canceled at once.
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
          <li>
            Records of app store billing events, with your account number removed. Apple and Google keep their own billing
            records. Stripe keeps its own records for website payments.
          </li>
        </ul>
      </DocSection>

      <DocSection title="A plan bought in the app">
        <p>
          Deleting your account does not cancel a plan you bought in the app. Apple or Google bills it. Cancel it in your Apple
          ID or Google Play subscription settings, or you may be charged again. Refunds for it come from the store.
        </p>
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
