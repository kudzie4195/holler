import type { Metadata } from 'next';
import { DocPage, DocSection } from '@/components/doc-page';
import { env } from '@/lib/env';
import { COMPANY } from '@/lib/legal/company';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What Holler collects, why, who else handles it, how long we keep it, and how to delete it.',
  alternates: { canonical: '/privacy' },
};

/** Where to write to us: SUPPORT_EMAIL when set, otherwise the contact link in our emails (same fallback as before). */
function Support({ support }: { support: string | undefined }) {
  return support ? <a href={`mailto:${support}`}>{support}</a> : <>the contact link in any Holler email</>;
}

export default function PrivacyPage() {
  const support = env.SUPPORT_EMAIL?.trim() || undefined;
  return (
    <DocPage
      title="Privacy"
      intro="Short version: we keep what we need to run Holler, we do not sell it, and you can delete your account yourself."
      updated="November 17, 2026"
    >
      <DocSection title="The short version">
        <ul>
          <li>We collect your email, your business details and your billing status. For a service request, we collect the request and your email.</li>
          <li>We do not sell personal information. We do not share it for ads.</li>
          <li>There are no advertising or analytics trackers on Holler.</li>
          <li>Card numbers go to Stripe. We never see them.</li>
          <li>You can delete your account in Settings. A resident can close a request from the email we send when it goes live.</li>
        </ul>
      </DocSection>

      <DocSection title="Who we are">
        <p>
          Holler is run by {COMPANY.legalName}, {COMPANY.entity}, at {COMPANY.addressLine}. This policy covers{' '}
          {COMPANY.site} and the emails Holler sends. &quot;We&quot; means {COMPANY.legalName}.
        </p>
      </DocSection>

      <DocSection title="Your account">
        <ul>
          <li>
            Your email address and your password. Supabase, our sign-in provider, stores the password as a hash. Nobody at
            Holler can read it.
          </li>
          <li>Notes on when you confirmed your email, when your free trial started, and whether you left Holler.</li>
        </ul>
        <p>
          {COMPANY.legalName} runs other apps too, and they share one sign-in system. If you use the same email in another
          of our apps, it is the same sign-in, and Holler keeps its own data in separate Holler tables. Logging out of Holler
          does not log you out of our other apps.
        </p>
        <p>We use this to let you log in, keep your account safe, and give each person one free trial.</p>
      </DocSection>

      <DocSection title="Your business profile">
        <ul>
          <li>Your business name and the trades you pick.</li>
          <li>
            Your ZIP code, plus the city, state and rough map point we look up from it. The lookup runs on our own server.
          </li>
          <li>How far from your ZIP you want alerts, and whether email alerts are on.</li>
          <li>On Pro, your extra service areas and keyword watches.</li>
          <li>The alerts we matched to you, what you did with each one (saved, done or dismissed), and any reply drafts.</li>
        </ul>
        <p>We use this to match records to you and send your alerts. Your profile is never shown on a public page.</p>
      </DocSection>

      <DocSection title="Billing">
        <p>
          Stripe handles payment. When you subscribe, we give Stripe your email, your business name and your Holler account
          number, and you type your card on Stripe&apos;s own checkout page. We never see or store card numbers.
        </p>
        <p>
          We store your Stripe customer number, your subscription number, your subscription status, your trial end date and
          your plan (Starter or Pro). Stripe keeps its own payment records under its privacy policy and the law.
        </p>
        <p>
          If you move from Pro to Starter, your extra service areas and keyword watches stay saved but are not used. They are
          deleted with your account.
        </p>
      </DocSection>

      <DocSection title="Resident service requests">
        <p>
          When you post a request, we collect the trade, your ZIP code, your description, your email address and the time
          you agreed to our terms. Here is what happens to each.
        </p>
        <ul>
          <li>
            Nothing is public until you open the confirm link and press the button on that page. Our database keeps the
            confirm link and the close link only as one-way hashes. The links themselves are in the emails we send you.
          </li>
          <li>
            After you confirm, public pages show only the service and your city. The public record behind them also holds
            your ZIP code and a map point at the middle of that ZIP code. It never holds your description or your email.
          </li>
          <li>
            Your description is shown only to businesses whose alerts match your request, in their Holler feed and alert
            email. They see up to 140 characters. A filter first removes phone numbers, email addresses, links, street
            addresses and names. It can miss things.
          </li>
          <li>We never send your request to an AI model.</li>
          <li>
            We use your email only to send the confirm link, the notice that your request is live, replies from businesses and
            the link to close your request. We never show it on a page, put it in a public record or give it to a business.
          </li>
          <li>
            Replies come from Holler, with the business as the reply-to address. You see the business name, its city and its
            reply. If you answer, the business gets your email address and what you write back. Nothing else. We record which
            business replied and when. We do not keep the message.
          </li>
          <li>
            We email a copy of each confirmed request, with your full description, to Holler&apos;s support inbox. That lets us
            remove a request that breaks the rules. Resend, our email provider, keeps its own delivery records of every email.
          </li>
          <li>
            A request stays open for 14 days. When it ends, because you closed it, we removed it or the 14 days passed, it
            leaves our pages and we delete its public record within about 15 minutes.
          </li>
          <li>
            Closing or removal deletes your email address, your full description and the filtered text right away. When a
            request simply runs out, we delete them 30 days after it ended.
          </li>
          <li>A request you never confirm is deleted after 7 days.</li>
          <li>
            After that we keep only the trade, the ZIP code, the city and the dates. There is no email address and no text.
          </li>
          <li>
            The copy in our support inbox and Resend&apos;s delivery records are kept apart from our database. These steps do
            not delete them. Ask us and we will delete the inbox copy.
          </li>
        </ul>
        <p>
          If you are a business and reply to a request, the resident sees your business name, your city, your reply and your
          email address. When you delete your account, we delete the record of which requests you replied to.
        </p>
      </DocSection>

      <DocSection title="Emails we send">
        <p>
          We send account emails (confirm your email, reset your password), alert emails when alerts are on, and notices
          about your account or price changes. Each one shows our mailing address. Every alert email has a link to turn
          alerts off.
        </p>
        <p>
          Resend delivers our email and keeps its own delivery records, and on our side we record when we last sent you
          alerts and which ones we already sent, so you do not get repeats.
        </p>
      </DocSection>

      <DocSection title="Reply drafts made with AI">
        <p>
          When you ask for a draft reply, we send the alert&apos;s title and text, your business name, your trades and
          your city to an AI model made by Anthropic. Drafts are not offered for resident requests, and we never send a
          resident&apos;s request to the AI model. It goes through Vercel&apos;s AI Gateway. We do not send your email
          or anyone else&apos;s. If the AI is not available, we fill in a fixed template and send nothing, and the draft is
          saved with that alert so you can edit it.
        </p>
      </DocSection>

      <DocSection title="Abuse limits and server logs">
        <p>
          To stop abuse, we count sign-ups, log-ins, password resets, area checks, draft requests, service requests and
          replies. We count by IP address, email or account, and we store only a keyed hash, a scrambled code made from that
          value with a secret key, never the value itself. These counters are deleted after about two days.
        </p>
        <p>
          Our hosts, Vercel and Supabase, keep standard server logs, which include IP address, the page asked for, browser
          type and time, and we use them to fix problems and stop attacks. The hosts keep them for a limited time under their
          own rules.
        </p>
      </DocSection>

      <DocSection title="Cookies">
        <p>
          Holler sets cookies only to keep you signed in: our sign-in provider sets them when you sign up or log in, and they
          refresh when you open your account pages. Logging out removes them from that browser. Our city and trade pages
          never read or set cookies.
        </p>
        <p>
          There are no advertising cookies, analytics tools or tracking pixels on Holler, and when you pay you are on
          Stripe&apos;s checkout page, where Stripe&apos;s own cookies and privacy policy apply.
        </p>
      </DocSection>

      <DocSection title="Public records">
        <p>
          Most of what Holler shows is government open data. That includes weather alerts, storm reports, disaster
          declarations, earthquakes, airport delays, federal awards, and city permits, 311 requests, inspections, code
          violations, new business licenses and permitted events. A record can show a street block and business names.
          A filter removes phone numbers, email addresses and personal names from free text. We keep records for about
          120 days, then delete them.
        </p>
        <p>
          <strong>Named in a record?</strong> Write to <Support support={support} /> with the link to the page. We will
          review it and remove or fix it where that is fair. The agency keeps its own copy. Ask the agency to change that
          one.
        </p>
      </DocSection>

      <DocSection title="Who handles data for us">
        <ul>
          <li>Supabase hosts our database and sign-in.</li>
          <li>Vercel hosts the site and runs the AI Gateway.</li>
          <li>Stripe processes payments.</li>
          <li>Resend delivers our email.</li>
          <li>Anthropic&apos;s AI model writes reply drafts when you ask for one.</li>
        </ul>
        <p>
          Each works for us under its own terms and privacy policy. We do not sell personal information. We do not share it
          for cross-context behavioral advertising, which means ads aimed at you based on what you do on other sites.
        </p>
      </DocSection>

      <DocSection title="When we disclose information">
        <ul>
          <li>To follow the law, a court order, a subpoena or a valid government request.</li>
          <li>To protect the rights, property or safety of Holler, our users or the public, such as to stop fraud or abuse.</li>
          <li>If Holler or {COMPANY.legalName} is merged, sold or reorganized. The new owner must follow this policy.</li>
          <li>When you ask us to, such as when you send a reply to a resident.</li>
        </ul>
      </DocSection>

      <DocSection title="How long we keep it">
        <ul>
          <li>Business profile and billing numbers: until you delete your account.</li>
          <li>Matched alerts and drafts: until the record they belong to is deleted, about 120 days, or until you delete your account.</li>
          <li>Public records: about 120 days.</li>
          <li>
            Requests: the public record goes when the request ends. Email addresses and descriptions go as described above.
            The trade, ZIP code, city and dates stay.
          </li>
          <li>Records of which business replied to which request: until the business deletes its account.</li>
          <li>Abuse counters: about two days.</li>
          <li>
            Your sign-in and the trial notes: they stay after you delete Holler, because the sign-in is shared and the notes
            stop a second free trial. Ask us and we will delete the sign-in too.
          </li>
          <li>Stripe, Resend and our hosts keep their own records for as long as their rules and the law require.</li>
        </ul>
      </DocSection>

      <DocSection title="Your choices and rights">
        <ul>
          <li>Change your business details any time in Settings.</li>
          <li>Turn off alert emails in Settings, or with the link in any alert email. We still send emails your account needs, such as password resets.</li>
          <li>
            Delete your account in Settings. That cancels your Holler subscription right away, deletes your profile, your
            matched alerts, your drafts and the record of which requests you replied to, and removes Holler from your sign-in. It keeps the shared sign-in, the trial
            notes and Stripe&apos;s records.
          </li>
          <li>
            Ask for a copy of your data, a correction, or full deletion, including your sign-in. Write to{' '}
            <Support support={support} /> from the email on your account. We may ask you to confirm it is you.
          </li>
        </ul>
        <p>
          We answer within 30 days. People in some states, such as California, have extra privacy rights by law, and we honor
          these requests from anyone, whatever state you live in. You may use an agent you authorize. If we say no, you can
          ask us to reconsider by replying. We will never treat you differently for using these rights.
        </p>
      </DocSection>

      <DocSection title="Security">
        <p>
          All traffic uses HTTPS (TLS). Our database uses row-level security, so each account can read only its own private
          rows. Passwords are stored as hashes. Payment pages are run by Stripe. No system is perfect, though. If a breach
          affects you, we will tell you as the law requires.
        </p>
      </DocSection>

      <DocSection title="Children">
        <p>
          Holler is not for anyone under 18. We do not knowingly collect their information. If you tell us we have some, we
          will delete it.
        </p>
      </DocSection>

      <DocSection title="United States only">
        <p>Holler is a US service, built for people and businesses in the United States.</p>
      </DocSection>

      <DocSection title="Changes">
        <p>
          The date at the top shows the current version, and if we change this policy in a way that matters, we will email
          account holders first.
        </p>
      </DocSection>

      <DocSection title="Contact">
        <p>
          Email: <Support support={support} />.
        </p>
        <address className="not-italic">
          {COMPANY.legalName}
          {COMPANY.addressLines.map((l) => (
            <span key={l}>
              <br />
              {l}
            </span>
          ))}
        </address>
      </DocSection>
    </DocPage>
  );
}
