import type { Metadata } from 'next';
import { DocPage, DocSection } from '@/components/doc-page';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'The plain-language rules for using Holler.',
  alternates: { canonical: '/terms' },
};

export default function TermsPage() {
  return (
    <DocPage
      title="Terms"
      intro="These are the rules for using Holler, written to be read."
      updated="November 16, 2026"
    >
      <DocSection title="The service">
        <p>
          Holler watches public data and sends you alerts when something matches your trades and location. You use those
          alerts to decide where to look for work. Holler does not post for you, contact anyone for you, or promise you
          any job.
        </p>
      </DocSection>

      <DocSection title="Trial and billing">
        <ul>
          <li>You get a 7-day free trial. No card is needed to start.</li>
          <li>After the trial, Holler costs $5 a month, billed through Stripe.</li>
          <li>If you do not subscribe, your feed locks. Your account stays until you delete it.</li>
          <li>You can cancel any time from Settings. Cancelling stops the next charge. We do not prorate partial months.</li>
        </ul>
      </DocSection>

      <DocSection title="Using it well">
        <ul>
          <li>Be honest about who you are when you reply to someone. Do not pretend to be a customer or a neighbor.</li>
          <li>Follow the rules of any site or group where you post a reply. We do not control those rules.</li>
          <li>Do not use Holler to harass people, spam, or collect data about private individuals.</li>
          <li>Do not try to break, overload or reverse-engineer the service.</li>
          <li>One account per business. Do not share your login.</li>
        </ul>
        <p>We can suspend an account that breaks these rules.</p>
      </DocSection>

      <DocSection title="Data can be wrong">
        <p>
          Alerts come from public sources that can be late, incomplete or mistaken. Holler gives them to you as it finds
          them and does not check them. Verify before you drive across town, buy supplies or promise a customer anything.
          We do not guarantee that you will receive every alert or that any alert is accurate.
        </p>
      </DocSection>

      <DocSection title="Liability">
        <p>
          Holler is provided as is. To the extent the law allows, we are not liable for lost jobs, lost income or other
          indirect losses from using the service, and our total liability to you is limited to what you paid us in the
          three months before the problem.
        </p>
      </DocSection>

      <DocSection title="Changes and contact">
        <p>
          We may change the service or these terms. If a change matters, we will tell you by email before it takes
          effect. For questions, reply to any email from Holler.
        </p>
      </DocSection>
    </DocPage>
  );
}
