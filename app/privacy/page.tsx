import type { Metadata } from 'next';
import { DocPage, DocSection } from '@/components/doc-page';
import { env } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What Holler stores, who else touches it, and how to delete it.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  const support = env.SUPPORT_EMAIL?.trim();
  return (
    <DocPage
      title="Privacy"
      intro="Short version: we keep what we need to send you alerts, we do not sell it, and you can delete it yourself."
      updated="November 16, 2026"
    >
      <DocSection title="What we store about you">
        <ul>
          <li>Your email address and a password (stored as a hash by our sign-in provider, never in plain text).</li>
          <li>Your business name and the trades you picked.</li>
          <li>Your ZIP code, plus the approximate coordinates and city we look up from it.</li>
          <li>The alerts we matched to you, what you did with them (saved, done, dismissed), and any draft replies you asked for.</li>
          <li>Your subscription status and trial end date.</li>
        </ul>
        <p>Neither your public city page nor our data sources ever show any of this.</p>
      </DocSection>

      <DocSection title="Where the alert data comes from">
        <p>
          Alerts are built from public data: government feeds, city open data, public event listings and public posts
          found through licensed search APIs. For public posts we keep the title, a short snippet and the link. Alerts
          stay for about 120 days. Then they are deleted.
        </p>
      </DocSection>

      <DocSection title="Who else handles it">
        <ul>
          <li>Supabase hosts our database and sign-in.</li>
          <li>Vercel hosts the site.</li>
          <li>Stripe processes payment. Your card details go to Stripe. We never see or store card numbers.</li>
          <li>Resend delivers our emails.</li>
          <li>
            An AI model provider, reached through Vercel&apos;s AI Gateway, writes draft replies. When you ask for a draft,
            we send it the text of that one alert, your business name, your trades and your city. Nothing else.
          </li>
        </ul>
        <p>We do not sell your data, and we do not run advertising trackers.</p>
      </DocSection>

      <DocSection title="Cookies">
        <p>We use cookies to keep you signed in. That is all.</p>
      </DocSection>

      <DocSection title="Your choices">
        <ul>
          <li>Change your business name, trades, ZIP and radius any time in Settings.</li>
          <li>Turn email alerts off in Settings, or with the unsubscribe link in any alert email.</li>
          <li>
            Delete your account in Settings. That removes your profile, matches and drafts right away and cancels your
            subscription. Stripe may keep payment records for as long as the law requires.
          </li>
        </ul>
        <p>
          If you have a question about your data,{' '}
          {support ? (
            <>
              write to <a href={`mailto:${support}`}>{support}</a>.
            </>
          ) : (
            'use the contact link in any Holler email.'
          )}
        </p>
      </DocSection>

      <DocSection title="Changes">
        <p>If we change this page in a way that matters, we will say so by email, and the date at the top shows the latest version.</p>
      </DocSection>
    </DocPage>
  );
}
