import type { Metadata } from 'next';
import Link from 'next/link';
import { DocPage, DocSection } from '@/components/doc-page';
import { COMPANY } from '@/lib/legal/company';
import { APP_DELETE_WORD, PRIVACY_UPDATED, Support, supportAddress } from '@/lib/legal/pages';
import { PUBLIC_PRICES } from '@/lib/plan/public-prices';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What Holler collects on the web and in the app, why, who else handles it, how long we keep it, and how to delete it.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  const support = supportAddress();
  const solo = PUBLIC_PRICES.plans.solo.name;
  const pro = PUBLIC_PRICES.plans.pro.name;
  return (
    <DocPage
      title="Privacy"
      intro="Short version: we keep what we need to run Holler, we do not sell it, and you can delete your account yourself."
      updated={PRIVACY_UPDATED}
    >
      <DocSection title="The short version">
        <ul>
          <li>We collect your email, your business details and your billing status. For a service request, we collect the request and your email.</li>
          <li>We do not sell personal information. We do not share it for ads.</li>
          <li>There are no advertising trackers and no outside analytics scripts on Holler. We count visits ourselves, with two cookies.</li>
          <li>Card numbers go to Stripe, Apple or Google. We never see them.</li>
          <li>
            An AI model sorts public records by trade. That sorting step never sees your account. Reply drafts, which you ask
            for, send your business name, trades and city.
          </li>
          <li>You can delete your account in Settings, on the web or in the app. A resident can close a request from the email we send when it goes live.</li>
        </ul>
      </DocSection>

      <DocSection title="Who we are">
        <p>
          Holler is run by {COMPANY.legalName}, {COMPANY.entity}, at {COMPANY.addressLine}. This policy covers{' '}
          {COMPANY.site}, the Holler app for iPhone and Android, and the emails Holler sends. &quot;We&quot; means{' '}
          {COMPANY.legalName}.
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
          In the app you can also sign in with Apple, or with Google where the app offers it. Then we get your email address
          and an ID that Apple or Google uses for you. Apple or Google may also share your name. Our sign-in provider keeps
          these with your sign-in. Holler does not show your name or use it.
        </p>
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
          <li>How far from your ZIP you want alerts, and whether email alerts and push alerts are on.</li>
          <li>On {pro}, your extra service areas and keyword watches.</li>
          <li>The alerts we matched to you, what you did with each one (saved, done or dismissed), and any reply drafts.</li>
        </ul>
        <p>We use this to match records to you and send your alerts. Your profile is never shown on a public page.</p>
      </DocSection>

      <DocSection title="The Holler app">
        <p>
          The app keeps your sign-in session in its own storage on your phone, with a backup copy so a short outage on the
          sign-in service does not sign you out. That keeps you signed in. Signing out removes both. For each account that signs in, the app also keeps three small notes there, labeled with the account number:
          the phone&apos;s push token, whether it already asked about notifications, and whether you turned pushes on.
          Signing out removes the token. Turning pushes off removes the token and the pushes note. The note about asking stays
          until you remove the app. The app never reads your location, contacts or photos.
        </p>
        <p>
          If you allow notifications, your phone gets a push token. We store that token with your account, the kind of phone
          and the app version, so alerts can reach that phone. Google&apos;s Firebase Cloud Messaging delivers each push, on
          iPhone and on Android. A push shows the city and the title of a public record, and it can appear on your lock
          screen.
        </p>
        <p>
          Turn pushes off with the switch in the app&apos;s Settings, or in your phone&apos;s settings. Signing out removes
          that phone&apos;s token. Deleting your account deletes all of them.
        </p>
        <p>
          The RevenueCat and Firebase tools inside the app keep their own small records on the phone to do their jobs. There
          are no ad tools in the app.
        </p>
      </DocSection>

      <DocSection title="Billing">
        <p>
          On the website, Stripe handles payment. When you subscribe, we give Stripe your email, your business name and your
          Holler account number, and you type your card on Stripe&apos;s own checkout page. We never see or store card numbers.
        </p>
        <p>
          In the app, Apple or Google handles payment, under its own terms. RevenueCat records the purchase for us. We give
          RevenueCat your Holler account number. We do not give it your name or email. From RevenueCat we keep the store, the
          product, the price, and the purchase and renewal dates. We never see your card.
        </p>
        <p>
          We store your Stripe customer number, your subscription number, your subscription status, your trial end date and
          your plan ({solo} or {pro}). Stripe, Apple and Google keep their own payment records under their own policies and the
          law.
        </p>
        <p>
          If you move from {pro} to {solo}, your extra service areas and keyword watches stay saved but are not used. They are
          deleted with your account.
        </p>
      </DocSection>

      <DocSection title="Your answers about alerts">
        <p>
          Each alert has buttons to say it was useful, not relevant, or led to work. If it led to work, you can add the job
          amount. That part is up to you. A week or more after you mark an alert useful, we may ask once if it led to work. We ask in
          your feed, or by email if email alerts are on.
        </p>
        <p>
          We also keep a short log of the alerts we send you. Each line holds the record type, its source and severity, the
          trade, a distance band, your plan and when we emailed it. It holds no title, text or address.
        </p>
        <p>
          We use your answers and this log to learn which kinds of alerts are worth sending. We also add them up, with no names
          or account numbers, to describe which kinds of records turn into work. We never sell your answers with your name or
          account attached.
        </p>
        {/* Round 23: the opt-in box at sign-up (components/auth-forms.tsx, lib/auth/stats-consent.ts). Word for word as the owner
            settled it; the box itself is the short form of the same promise, and Settings turns it off. */}
        <p>
          If you tick the box, we add your taps (useful, not relevant, led to work) and any job amount you enter to combined
          statistics by trade, record type, area and week. They contain no name, business, email, phone or street address, and we
          do not publish a group smaller than 10 members. We may publish, share, license or sell these combined statistics. We
          never sell or share your answers on their own. Untick the box in Settings and we stop adding your answers from that day.
        </p>
        <p>
          The box is unticked when you sign up, and nothing on your plan or your alerts depends on it. We store which wording you
          agreed to and when, so we can always show you what you said yes to.
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
          <li>We never send your description or your email to an AI model.</li>
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
        <ul>
          <li>Alert emails, when email alerts are on. Every alert email has a link to turn alerts off.</li>
          <li>
            Up to three emails about your free trial: about a day after you sign up, about three days before the trial ends,
            and about a day after it ends. If we extend your trial, the last two can come again for the new end date. Each has a link to stop them that needs no login, and your mail app&apos;s unsubscribe
            button works too. Stopping them does not stop your alerts.
          </li>
          <li>
            A follow-up that asks if an alert led to work. It comes at most once a week, and only while email alerts are on.
            Turning alerts off stops it.
          </li>
          <li>Account emails, such as confirm your email and reset your password, and notices about your account or price changes.</li>
        </ul>
        <p>
          Each email shows our mailing address. Resend delivers our email and keeps its own delivery records. On our side, we
          record when we last sent you alerts and which ones we already sent, so you do not get repeats. We also record which
          trial emails went out, and if you stopped them.
        </p>
      </DocSection>

      <DocSection title="AI on Holler">
        <p>
          We use an AI model from Anthropic, through Vercel&apos;s AI Gateway, to sort new public records by trade and to
          write a short note on why a record may matter.
        </p>
        <p>
          The model sees only parts of the public record: its title, a short summary, its type and source, the city and state,
          and the trades our keyword rules already picked. Weather alerts, storm reports, disaster declarations, earthquakes
          and airport delays are not sent at all. Resident requests are not sent either. Nothing from a request reaches the
          model.
        </p>
        <p>
          This step never gets your account, your profile, your email, the contact details on a record, or anything you type.
          It runs on a schedule, not when you open a page. Its sorting can be wrong. So can its notes.
        </p>
        <p>
          Reply drafts work differently. When you ask for a draft reply, we send the alert&apos;s title and text, your business
          name, your trades and your city to an AI model from Anthropic, through the same gateway. Drafts are not offered for
          resident requests, and they need an active trial or plan. We do not send your email or anyone else&apos;s. When the
          AI is switched off, you get a fixed template and nothing is sent. If the AI call fails or its draft breaks our rules,
          you get the same template, but the details above may already have been sent. Drafts count toward a monthly AI
          budget. When it runs out, drafts pause until the next month. Each draft is saved with its alert so you can edit it.
        </p>
      </DocSection>

      <DocSection title="Abuse limits and server logs">
        <p>
          To stop abuse, we count sign-ups, log-ins, password resets, area checks, draft requests, plan changes, feed fills,
          service requests, replies, feature picks and visit counts. We count by IP address, email or account, and we store
          only a hash, a scrambled code made from that value, never the value itself. With the server secret set, as the launch
          steps require, it is a keyed hash made with that secret. These counters are deleted after about two days.
        </p>
        <p>
          Our hosts, Vercel and Supabase, keep standard server logs, which include IP address, the page asked for, browser
          type and time, and we use them to fix problems and stop attacks. The hosts keep them for a limited time under their
          own rules.
        </p>
      </DocSection>

      <DocSection title="Cookies and visit counts">
        <p>
          Holler sets cookies to keep you signed in: our sign-in provider sets them when you sign up or log in, and they
          refresh when you open your account pages. Logging out removes them from that browser. Our city, trade and storm
          pages never read cookies on our servers.
        </p>
        <p>
          Your browser also gets a cookie, holler_lang, that holds only en or es and remembers the language of your account pages in
          this browser for one year; it is not used for tracking, and logging out or deleting your account removes it.
        </p>
        <p>
          The Coming next list on the pricing page and in your feed lets you press I want this on a feature we may build. We save
          the pick: with your account if you are signed in, and with no name or ID if you are not. Your browser also gets a cookie,
          holler_picked, that remembers which features you picked, for 180 days. It holds only feature names.
        </p>
        <p>
          If you check a ZIP code Holler does not cover yet, the Coming to your area card lets you leave your email. We save your
          email, that ZIP code, the rough center of that ZIP code, the trade you picked and which version of the card&apos;s wording
          you saw, with no account and no name. We send one email with a link to confirm the address; you are on the list only once
          you press it. We use the email only to confirm it and to tell you when we cover that area. We do not set a cookie for it,
          and we do not share the email or use it for ads. Pressing the button again with the same email and ZIP saves nothing new,
          and once the address is confirmed it sends nothing new either.
        </p>
        <p>
          Holler counts visits and a few steps itself. It uses no outside tracker. To count, a small script sets two first
          party cookies, each kept for 30 days. The first, holler_sid, holds a random ID and the date of your last counted
          visit. The second, holler_src, holds where you came from. It is set only when your link carried a source tag, such as
          utm_source or ref=ig. The first source we see is kept.
        </p>
        <p>
          We count one visit a day for each browser. We also count an area check. For members we count four account steps:
          signup, trial start, first alert email and first payment. Each count holds the step, the page path, the random ID,
          the source tag and the time. It never holds your IP address. It never holds your browser or device details, or the
          page that sent you. Only the four account steps also hold your account number. Other counts never do. That lets us
          see which steps one account took. Your signup step carries the same random ID as that browser&apos;s visits, so while you have an
          account the two can be lined up.
        </p>
        <p>
          If your browser sends Global Privacy Control or Do Not Track, we set neither cookie. We count none of your visits.
          We also remove the two cookies if they are there. Account steps are still recorded, because they are part of running
          your account.
        </p>
        <p>
          There are no advertising cookies or tracking pixels on Holler, and no outside analytics tools. When you pay on the
          website you are on Stripe&apos;s checkout page, where Stripe&apos;s own cookies and privacy policy apply.
        </p>
      </DocSection>

      <DocSection title="Public records">
        <p>
          Most of what Holler shows is government open data. That includes weather alerts, storm reports, disaster
          declarations, earthquakes, airport delays, federal awards, and city permits, 311 requests, inspections, code
          violations, new business licenses and permitted events. The rule on addresses, everywhere on Holler: an exact street
          address only for a building permit, which is where the work itself is; a street block only for a code violation, a 311
          request or a home sale; never a private person&apos;s name. Permit and event records therefore show a street address, and
          inspection and code violation records show only the block. No public page prints a business name from inspection or federal
          award records.
          A filter removes phone numbers, email addresses and personal names from free text. We keep full records for about
          120 days, then delete them.
        </p>
        <p>
          Before we delete a record, we keep a small copy for trend counts. It holds only the source, the record type and
          subtype, the trades, the ZIP code, county, city and state, the date and a severity level. It holds no title, no
          text, no link, no street address and no map point. Resident requests are never kept this way.
        </p>
        <p>
          Signed-in members with an active trial or plan, including a plan whose payment is being retried, see more for an alert
          matched to them. That is the organization the
          record names (a business, a company on a permit, or a company that won a public award), the address the record is
          about, and that organization&apos;s own address and phone number when the record itself publishes them. The organization name and the phone
          number are never on public pages. A permit&apos;s street address already is. For members, we
          keep the organization name only when it reads as a business or a public body, and we drop names that look like a private
          person. This filter is automatic and can miss. One example is a sole owner who trades under a company name. Anyone can
          ask us to remove a record at <Support support={support} />.
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
          <li>An AI model from Anthropic sorts public records and writes reply drafts, through that gateway.</li>
          <li>Resend delivers our email.</li>
          <li>Stripe processes payments on the website.</li>
          <li>Apple handles App Store purchases and Sign in with Apple.</li>
          <li>Google handles Google Play purchases, Google sign-in, and push delivery through Firebase Cloud Messaging.</li>
          <li>RevenueCat records app subscriptions for us.</li>
          <li>DataForSEO gives us search data for planning our public pages. We send it no personal information.</li>
          <li>
            When their keys are set, we also use Brave Search, Serper, Bluesky and Ticketmaster to find public posts and events,
            and IndexNow to tell search engines about new pages, and we send none of them any member data.
          </li>
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
          <li>Public records: about 120 days in full. The small trend copy described above has no set end date.</li>
          <li>Your answers about alerts: until the record is deleted or you delete your account. The alert log: until you delete your account.</li>
          <li>
            Requests: the public record goes when the request ends. Email addresses and descriptions go as described above.
            The trade, ZIP code, city and dates stay.
          </li>
          <li>Records of which business replied to which request: until the business deletes its account.</li>
          <li>Feature picks: until you delete your account. A pick made while signed out has no name on it, so we keep it.</li>
          <li>
            Coming to your area emails: until we tell you the area is covered, or until you ask us to delete it. It is not tied to an
            account, so deleting your account does not remove it. Write to us and we will delete it.
          </li>
          <li>Account steps: about 13 months, and deleted with your account.</li>
          <li>
            Visit and area check counts: about 13 months. They hold no account number, so deleting your account does not
            remove them.
          </li>
          <li>Your source tag: until you delete your account.</li>
          <li>Push tokens: until you sign out on that phone or delete your account.</li>
          <li>Abuse counters: about two days.</li>
          <li>
            App store billing events: kept as billing records. When you delete your account, we remove your account number from
            them.
          </li>
          <li>
            Your sign-in and the trial notes: they stay after you delete Holler, because the sign-in is shared and the notes
            stop a second free trial. Ask us and we will delete the sign-in too.
          </li>
          <li>Stripe, Apple, Google, RevenueCat, Resend and our hosts keep their own records for as long as their rules and the law require.</li>
        </ul>
      </DocSection>

      <DocSection title="Your choices and rights">
        <ul>
          <li>Change your business details any time in Settings.</li>
          <li>Turn off alert emails in Settings, or with the link in any alert email. We still send emails your account needs, such as password resets.</li>
          <li>Turn off push alerts in the app&apos;s Settings or in your phone&apos;s settings.</li>
          <li>
            Delete your account in Settings, on the website or in the app. In the app, type {APP_DELETE_WORD} to confirm. The
            steps are on our <Link href="/delete-account">delete account page</Link>.
          </li>
          <li>
            Deleting your account cancels a plan you bought on our website right away. It deletes your profile, your matched
            alerts, your drafts and the record of which requests you replied to. It also deletes your feature picks, your
            feedback and answers, your alert log, your account steps, your source tag, your trial email record and your push
            tokens. Then it removes Holler from your sign-in. It keeps the shared sign-in, the trial notes and Stripe&apos;s
            records. Visit counts stay until they age out, about 13 months after the visit. They hold only a random ID, and
            deleting your signup step breaks its link to your account.
          </li>
          <li>
            We cannot cancel a plan you bought in the app. Cancel it in your Apple ID or Google Play subscription settings.
            Apple or Google handles any refund.
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
          All traffic uses HTTPS (TLS), from the website and from the app. Our database uses row-level security, so each
          account can read only its own private rows. Passwords are stored as hashes. Payment pages are run by Stripe, Apple
          or Google. No system is perfect, though. If a breach affects you, we will tell you as the law requires.
        </p>
      </DocSection>

      <DocSection title="Children">
        <p>
          Holler is not for anyone under 18, and it is not directed to children under 13. We do not knowingly collect their
          information. If you tell us we have some, we will delete it.
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
