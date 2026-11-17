import type { Metadata } from 'next';
import Link from 'next/link';
import { DocPage, DocSection } from '@/components/doc-page';
import { env } from '@/lib/env';
import { COMPANY } from '@/lib/legal/company';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'The plain-language agreement for using Holler: plans and renewal, rules, resident requests, public records and disputes.',
  alternates: { canonical: '/terms' },
};

/** Where to write to us: SUPPORT_EMAIL when set, otherwise the contact link in our emails (same fallback as before). */
function Support({ support }: { support: string | undefined }) {
  return support ? <a href={`mailto:${support}`}>{support}</a> : <>the contact link in any Holler email</>;
}

export default function TermsPage() {
  const support = env.SUPPORT_EMAIL?.trim() || undefined;
  return (
    <DocPage
      title="Terms"
      intro="This is the agreement between you and the company that runs Holler. It is written to be read. Using Holler means you accept it."
      updated="November 17, 2026"
    >
      <DocSection title="Who we are">
        <p>
          Holler is run by {COMPANY.legalName}, {COMPANY.entity}. Our mailing address is {COMPANY.addressLine}. In these
          terms, &quot;we&quot; and &quot;us&quot; mean {COMPANY.legalName}. &quot;You&quot; means the person or business
          using Holler.
        </p>
      </DocSection>

      <DocSection title="Who can use Holler">
        <ul>
          <li>You must be 18 or older.</li>
          <li>Holler is for people and businesses in the United States.</li>
          <li>
            You may use it to find work for a business you own or work for. You may also use it to post a request for work
            at your own home or property.
          </li>
          <li>If you sign up for a business, you confirm that you are allowed to accept these terms for it.</li>
        </ul>
      </DocSection>

      <DocSection title="Your account">
        <ul>
          <li>Use a real email address and keep it up to date. We send account and billing notices there.</li>
          <li>Keep your password private. You are responsible for what happens under your account.</li>
          <li>One account per business. Do not share your login.</li>
          <li>Tell us right away if you think someone else got into your account.</li>
        </ul>
      </DocSection>

      <DocSection title="What Holler is, and what it is not">
        <p>
          Holler reads public records and sends you a short alert when something matches your trades and your area. It
          also passes on service requests that residents post. You decide what to do with each one.
        </p>
        <ul>
          <li>Holler does not promise you any job, customer or income.</li>
          <li>
            Holler does not post anywhere for you. It sends a reply to a resident only when you write that reply and send
            it.
          </li>
          <li>
            <strong>Holler is not an emergency or weather-safety service.</strong> Alerts can be late, wrong or missing.
            Never use Holler to decide if you or anyone else is safe. Follow official warnings from the National Weather
            Service and local officials. In an emergency, call 911.
          </li>
          <li>Nothing on Holler is legal, tax, insurance, safety or other professional advice.</li>
          <li>Reply drafts written by AI are only suggestions. Read and fix a draft before you send it. What you send is up to you.</li>
        </ul>
      </DocSection>

      <DocSection title="Plans and prices">
        <p>Holler has two paid plans. Prices are in US dollars.</p>
        <ul>
          <li>Starter: $5 a month, or $48 a year.</li>
          <li>Pro: $9.99 a month, or $96 a year.</li>
        </ul>
        <p>
          Pro covers more service areas and more trades, and adds keyword watches. The <Link href="/pricing">pricing page</Link>{' '}
          lists what each plan includes.
        </p>
      </DocSection>

      <DocSection title="Free trial">
        <ul>
          <li>A new account gets a 7-day free trial. No card is needed to start.</li>
          <li>The trial has the same limits as Starter.</li>
          <li>Each person gets one free trial. Deleting an account and signing up again does not start a new one.</li>
          <li>When the trial ends, your feed locks unless you subscribe. We never charge you just because a trial ended.</li>
          <li>If you subscribe during your trial, your first charge comes when the trial ends.</li>
        </ul>
      </DocSection>

      <DocSection title="Automatic renewal">
        <p>
          <strong>Your plan renews automatically until you cancel.</strong> When you subscribe, you allow us to charge the
          card you gave Stripe, our payment company, at the start of each billing period. That is every month on a monthly
          plan and every year on a yearly plan. Each charge is the plan price at that time.
        </p>
        <p>
          <strong>How to cancel.</strong> Go to Settings and choose Manage billing. That opens Stripe&apos;s billing page,
          where you can cancel online. Cancelling stops the next charge. Your plan stays on until the end of the period you
          already paid for.
        </p>
        <p>
          <strong>Price changes.</strong> If we change a price, we will email you at least 30 days before the new price
          applies to you. You can cancel before then. If you do not cancel, the new price starts at your next renewal.
        </p>
        <p>
          <strong>Failed payments.</strong> If a charge fails, Stripe may try again. Alerts can stop until a payment goes
          through.
        </p>
      </DocSection>

      <DocSection title="Changing plans">
        <p>
          You can switch between Starter and Pro in Settings. Stripe prorates the change. That means the price difference counts
          only for the rest of your current billing period. Moving up to Pro, you pay that difference right away. If the payment
          fails, your plan does not change. Moving down to Starter, the difference becomes a credit on your next bill. Your billing
          period stays monthly or yearly, as it was.
        </p>
        <p>
          Moving from Pro to Starter? Your extra service areas, any trades beyond 5 and your keyword watches stop being used. They
          stay saved. Move back to Pro and they work again.
        </p>
      </DocSection>

      <DocSection title="Refunds">
        <p>
          Payments are final. We do not refund or credit part of a month or year, except where the law requires it or a
          plan change is prorated. If you delete your account, we cancel your subscription at once and do not refund the
          rest of that period. Think you were charged by mistake? Write to <Support support={support} /> and we will look
          into it.
        </p>
      </DocSection>

      <DocSection title="Rules for businesses">
        <ul>
          <li>Be honest about who you are. Use your real business name. Never pretend to be a customer, a neighbor or an official.</li>
          <li>
            Follow the law every time you contact anyone. That includes anti-spam law (CAN-SPAM), the Telephone Consumer
            Protection Act, the National Do Not Call Registry, state do-not-call and telemarketing laws, and local rules
            for door-to-door sales.
          </li>
          <li>Hold every license, permit, registration and insurance policy your work requires.</li>
          <li>Do not harass, threaten or pressure anyone. If someone asks you to stop contacting them, stop.</li>
          <li>
            Do not scrape, crawl, copy in bulk, resell or export Holler&apos;s pages, alerts or data. Do not build a list
            or database from them.
          </li>
          <li>Do not try to break, overload or get around Holler&apos;s limits or security, or copy its code.</li>
          <li>Do not post or send anything unlawful, false or harmful.</li>
        </ul>
        <p>
          <strong>Not for credit, insurance, jobs or housing.</strong> Holler is not a consumer reporting agency under the
          Fair Credit Reporting Act, and nothing on Holler is a consumer report. Do not use Holler to decide whether anyone
          is eligible for credit, insurance, employment, housing or any similar purpose.
        </p>
      </DocSection>

      <DocSection title="Resident service requests">
        <p>
          Anyone 18 or older can ask local businesses for help at <Link href="/request">the request page</Link>. Here is
          what happens.
        </p>
        <ul>
          <li>
            You give us the trade, your ZIP code, a short description and your email address, and you tick a box to agree.
            We email you a link. Open it and press the button to confirm. Nothing is public before that.
          </li>
          <li>A request you never confirm is deleted after 7 days.</li>
          <li>
            Once you confirm, public Holler pages show only the trade and your city. Your description is never on a public
            page.
          </li>
          <li>
            We send the trade, your city and up to 140 characters of your description to businesses near you that do that
            work. They see it in their Holler feed and alert email.
          </li>
          <li>
            Before businesses see the description, a filter removes phone numbers, email addresses, links, street addresses
            and names. The filter is automatic and can miss things. Leave them out yourself.
          </li>
          <li>We email a copy of each confirmed request to our support inbox, so we can remove one that breaks these rules.</li>
          <li>
            We never show your email address to a business or on a page. Businesses reply through Holler, and their replies
            reach you by email with the business name, its city and its reply. If you answer a business, you are writing to
            them directly. They see your address and what you write, and nothing else.
          </li>
          <li>Up to 5 businesses can reply. A request stays open for 14 days.</li>
          <li>
            You can close your request any time. Open the close link in the email we send when it goes live, or in any reply
            we forward, and press the button.
          </li>
          <li>
            When a request ends, because you closed it, we removed it or 14 days passed, it leaves public pages within about 15
            minutes.
          </li>
        </ul>
        <p>Do not post:</p>
        <ul>
          <li>Other people&apos;s personal information, such as a neighbor&apos;s name, address or phone number.</li>
          <li>Anything unlawful, false, hateful or abusive.</li>
          <li>
            Emergencies. If anyone is in danger, or there is a fire, a gas leak or flooding, call 911 or your utility now.
          </li>
          <li>Ads, or requests made up by a business to find work.</li>
        </ul>
        <p>
          You still own your request. You give us a free, worldwide license to store it, show its trade and city on our
          pages, send it to businesses, and edit it to remove personal details or fit our format. This license lasts until
          the request ends, plus any time we need to keep copies to meet the law. Our Privacy Policy says when we delete your
          email address and description. After that we keep only the trade, ZIP code, city and dates.
        </p>
        <p>
          <strong>We do not check businesses.</strong> Holler does not vet, license-check, insure, recommend or guarantee
          any business. Before you hire anyone, check their license, insurance and references yourself, and get a written
          quote.
        </p>
        <p>
          Holler is not a party to any deal between a resident and a business, and takes no fee from any job. Prices,
          payment, work quality and warranties are between you and the business. We may remove any request or reply at any
          time.
        </p>
      </DocSection>

      <DocSection title="Public records on Holler">
        <p>
          Most of what Holler shows comes from government open data. That includes weather alerts, storm reports, disaster
          declarations, earthquakes, airport delays and federal awards. It also includes city permits, 311 requests,
          inspections, code violations, new business licenses and permitted events.
        </p>
        <ul>
          <li>The agency that publishes a record is its source. Records can be late, incomplete or wrong.</li>
          <li>Holler is not affiliated with or endorsed by any government agency.</li>
          <li>
            Records can show a street block and business names, as the agency published them. A filter removes phone
            numbers, email addresses and personal names from free text. It can miss things.
          </li>
        </ul>
        <p>
          <strong>Corrections and removal.</strong> If a record on Holler is about you and is wrong, or you want it taken
          down, write to <Support support={support} /> with the link to the page. We will review it and fix or remove it
          where that is fair. We cannot change the agency&apos;s own record. For that, contact the agency.
        </p>
      </DocSection>

      <DocSection title="What you give us">
        <p>
          You own what you give us, such as your business details, your replies and your requests. You give us permission
          to store, copy, process and show it as needed to run Holler, as these terms and our{' '}
          <Link href="/privacy">Privacy Policy</Link> describe. You promise that you have the right to share it and that it
          breaks no law. If you send us ideas or feedback, we may use them without paying you.
        </p>
      </DocSection>

      <DocSection title="Our content and trademarks">
        <p>
          Holler&apos;s software, design and text, and the way we gather and present records, belong to us or the people
          who license them to us. The name Holler and our logo are our trademarks. While your account is in good standing,
          you may use Holler for its normal purpose. You may link to our public pages. You may not copy them in bulk.
        </p>
      </DocSection>

      <DocSection title="Other companies' services">
        <p>
          Holler runs on services from other companies: Stripe for payments, Supabase for accounts and data, Vercel for
          hosting, Resend for email, and an AI model provider for draft replies. Their terms can also apply to you. For
          example, Stripe&apos;s terms apply when you pay. Links to agency sites and other sites are for your convenience.
          We do not control those sites.
        </p>
      </DocSection>

      <DocSection title="Copyright complaints">
        <p>
          If you believe something on Holler infringes your copyright, send a notice to <Support support={support} />, or
          by mail to {COMPANY.legalName}, Attn: Copyright, {COMPANY.addressLine}. Please include:
        </p>
        <ul>
          <li>Your name, address, phone number and email.</li>
          <li>The work you believe was copied.</li>
          <li>The link to the material on Holler.</li>
          <li>A statement that you believe in good faith the use is not allowed by the owner, its agent or the law.</li>
          <li>
            A statement, under penalty of perjury, that your notice is accurate and that you own the copyright or may act for
            the owner.
          </li>
          <li>Your physical or electronic signature.</li>
        </ul>
        <p>We may remove the material. We close the accounts of repeat infringers.</p>
      </DocSection>

      <DocSection title="Suspension and ending your account">
        <ul>
          <li>You can stop using Holler any time. Delete your account in Settings. That also cancels your subscription at once.</li>
          <li>
            We may suspend or close an account, or remove content, if you break these terms or the law, put others at
            risk, or do not pay. Where the law allows and it is safe, we will tell you why.
          </li>
          <li>If we close your account when you did nothing wrong, we will refund the unused part of any period you paid for.</li>
          <li>Parts of these terms that by nature should last after an account ends will keep applying. Examples are payment, disclaimers, limits of liability and disputes.</li>
        </ul>
      </DocSection>

      <DocSection title="Disclaimers">
        <p>
          <strong>Holler is provided &quot;as is&quot; and &quot;as available.&quot;</strong> To the fullest extent the
          law allows, we make no warranties of any kind, express or implied. That includes any implied warranty of
          merchantability, fitness for a particular purpose, title and non-infringement.
        </p>
        <p>
          We do not promise that Holler or its records will be accurate, complete, on time, secure or always available. We
          do not promise that alerts will reach you, or that you will get work. We are not responsible for what any business
          or resident does, says or fails to do. That includes any job between them.
        </p>
      </DocSection>

      <DocSection title="Limit of liability">
        <p>
          <strong>To the fullest extent the law allows, we are not liable for indirect, incidental, special, consequential,
          exemplary or punitive damages.</strong> That includes lost profits, lost income, lost jobs and lost data, even if
          we were told they might happen.
        </p>
        <p>
          <strong>
            Our total liability for all claims about Holler or these terms is capped at the greater of what you paid Holler
            in the 12 months before the claim, or $100.
          </strong>
        </p>
        <p>
          Some states do not allow some of these limits, so some may not apply to you. Nothing in these terms limits
          liability that the law does not let us limit.
        </p>
      </DocSection>

      <DocSection title="You cover costs caused by your misuse">
        <p>
          This applies if you use Holler for a business. You will defend us, and pay the claims, losses, fines and
          reasonable legal fees that others bring against us, our officers, staff and contractors, when they come from your
          misuse of Holler. That covers your contact with any person, your work, your content, and any breach of these
          terms or the law. We will tell you about such a claim. We may join the defense with our own lawyer.
        </p>
      </DocSection>

      <DocSection title="Disputes">
        <ul>
          <li>
            <strong>Talk to us first.</strong> Before you file a claim, write to <Support support={support} />. Say what
            went wrong and what you want. Give us 30 days to fix it. We will do the same before we bring a claim against
            you.
          </li>
          <li>
            <strong>Governing law.</strong> These terms are governed by the laws of the State of {COMPANY.governingLaw},
            without its rules on choosing another state&apos;s law, and by US federal law where it applies.
          </li>
          <li>
            <strong>Where disputes go.</strong> Any lawsuit about Holler or these terms must be brought only in the state
            courts for Cobb County, Georgia, or in the federal court for that area (the US District Court for the Northern
            District of Georgia). You and we agree to those courts. Either of us may use small claims court instead if the
            claim qualifies.
          </li>
          <li>
            <strong>One person at a time.</strong> Where the law allows, claims are brought individually. They are not
            brought as a class action or any other group or representative action.
          </li>
          <li>
            <strong>One year to file.</strong> Where the law allows, a claim must be filed within one year after it arose.
            After that, it is barred.
          </li>
        </ul>
      </DocSection>

      <DocSection title="Changes to these terms">
        <p>
          We may update these terms. The date at the top shows the current version. If a change is material, we will
          email account holders before it takes effect. If you keep using Holler after that, you accept the new terms. If
          you do not agree, stop using Holler and delete your account. A change never applies to a dispute that started
          before it.
        </p>
      </DocSection>

      <DocSection title="The rest of the agreement">
        <ul>
          <li>These terms and our Privacy Policy are the whole agreement between you and us about Holler.</li>
          <li>If a court finds part of these terms cannot be enforced, the rest still applies. That part is enforced as far as the law allows.</li>
          <li>If we do not enforce a right right away, we have not given it up.</li>
          <li>
            You may not transfer your account or these terms without our written OK. We may transfer them in a merger, sale
            or reorganization.
          </li>
          <li>We send notices to your account email. Send yours to the email or mailing address below.</li>
        </ul>
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
