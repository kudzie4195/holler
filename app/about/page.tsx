import type { Metadata } from 'next';
import Link from 'next/link';
import { DocPage, DocSection } from '@/components/doc-page';
import { ButtonLink } from '@/components/button';
import { CADENCE_LONG } from '@/lib/seo/cadence';

export const metadata: Metadata = {
  title: 'About',
  description:
    'Holler turns public data into short alerts for local businesses. See where the data comes from and what we never do.',
  alternates: { canonical: '/about' },
};

/**
 * Source homepages are the publishers' public sites (SOURCED from general knowledge of each publisher, not from the adapters).
 * ASSUMED: the adapters in lib/signals use these publishers. Update this list if an adapter is added or dropped.
 */
const sources: { name: string; href: string; what: string }[] = [
  { name: 'National Weather Service', href: 'https://www.weather.gov', what: 'Weather warnings, watches and advisories.' },
  { name: 'NOAA Storm Prediction Center', href: 'https://www.spc.noaa.gov', what: 'Local storm reports: hail, wind and tornadoes.' },
  { name: 'FEMA OpenFEMA', href: 'https://www.fema.gov/about/openfema', what: 'Disaster declarations.' },
  { name: 'USGS Earthquake Hazards Program', href: 'https://earthquake.usgs.gov', what: 'Earthquake reports.' },
  { name: 'FAA National Airspace System Status', href: 'https://nasstatus.faa.gov', what: 'Airport delays and ground stops.' },
  { name: 'City open data portals (Socrata)', href: 'https://dev.socrata.com', what: 'Building permits, 311 requests and health inspections, where a city publishes them.' },
  { name: 'USAspending.gov', href: 'https://www.usaspending.gov', what: 'Federal contract awards.' },
  { name: 'SAM.gov', href: 'https://sam.gov', what: 'Federal contract opportunities.' },
  { name: 'Ticketmaster Discovery API', href: 'https://developer.ticketmaster.com', what: 'Large public events.' },
  { name: 'Bluesky public posts', href: 'https://bsky.app', what: 'People asking for recommendations.' },
  { name: 'Licensed web search APIs', href: 'https://brave.com/search/api/', what: 'Public posts where people ask for local help.' },
];

export default function AboutPage() {
  return (
    <DocPage
      title="About Holler"
      intro="Holler tells local businesses when their area needs them."
    >
      <DocSection title="What it is">
        <p>
          A storm rolls through, and the roofers who hear about it first get the calls. A health inspection fails and a
          cleaning crew could help. When a neighbor posts &quot;anyone recommend a plumber?&quot; the first useful reply
          often wins the job.
        </p>
        <p>
          Holler watches for moments like these in public data. You tell us what you do and where you work, and when
          something nearby matches, you get a short alert with a link to the source. That is the whole product.
        </p>
        <p>
          It costs $5 a month after a 7-day free trial. No card needed to start.
        </p>
      </DocSection>

      <DocSection title="Where the data comes from">
        <p>Everything comes from official APIs, open data and licensed search APIs, and each alert links to the page or dataset it came from.</p>
        <ul>
          {sources.map((s) => (
            <li key={s.name}>
              <a href={s.href} target="_blank" rel="noopener noreferrer">
                {s.name}
              </a>
              . {s.what}
            </li>
          ))}
        </ul>
        <p>
          Coverage is uneven. Weather, disasters and federal contracts cover the whole US, and airport status covers 40
          major airports. Permits, 311 and inspections come only from the cities we have connected so far, such as Chicago,
          New York and Austin. Some sources can be late, and a few will be wrong. Check the source before you act.
        </p>
        <p>{CADENCE_LONG}</p>
      </DocSection>

      <DocSection title="What we never do">
        <ul>
          <li>We never post, comment or message anyone for you.</li>
          <li>We never log in to, or connect to, your social accounts.</li>
          <li>We never sell upvotes, fake reviews or bought accounts.</li>
          <li>We never use data from LinkedIn, Facebook, Nextdoor or Craigslist, and we do not scrape sites that forbid it.</li>
          <li>We never sell your email or business details.</li>
        </ul>
        <p>
          When we find a public post where someone is asking for help, we keep only the title, a short snippet and the
          link. If you ask for a draft reply, you get text to edit and post yourself.
        </p>
      </DocSection>

      <DocSection title="City pages">
        <p>
          Every city also has a free public page built from the same data, with each item cited. Start at{' '}
          <Link href="/local">City pages</Link>.
        </p>
      </DocSection>

      <div>
        <ButtonLink href="/signup" size="lg">
          Start free for 7 days
        </ButtonLink>
      </div>
    </DocPage>
  );
}
