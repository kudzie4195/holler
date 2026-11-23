import type { Metadata } from 'next';
import { DocPage, DocSection } from '@/components/doc-page';

export function generateMetadata(): Metadata {
  return {
    title: 'Holler crawler',
    description: 'What the Holler crawler reads, how often, and how to ask us to stop.',
    alternates: { canonical: '/bot' },
  };
}

/**
 * The page the Holler user agent points to (lib/user-agent.ts): "Holler/1.0 (+https://localholler.com/bot)". English only (round 20
 * review). Static: no data, no form.
 */
export default function BotPage() {
  return (
    <DocPage title="The Holler crawler" intro="Requests with the user agent Holler/1.0 (+https://localholler.com/bot) come from Holler.">
      <DocSection title="What it reads">
        <p>
          Holler reads public records that governments publish: open-data portals, weather and storm reports, and public lists of open bids
          and solicitations on agency websites. It reads the list page only. It does not log in, fill in forms, download bid documents or
          read pages behind a login.
        </p>
      </DocSection>
      <DocSection title="How often">
        <p>
          A bid or solicitation list page is read at most once a day, usually as one request for the page and one for your robots.txt. Open-data
          portals are read every few hours through their public APIs.
        </p>
      </DocSection>
      <DocSection title="robots.txt">
        <p>
          The crawler reads robots.txt before it reads a page and follows it. It answers to the product token <code>Holler</code>. It honours
          Disallow, Allow and Crawl-delay. If robots.txt cannot be read (for example it answers 401, 403, 429 or an error), the page is not read
          that day.
        </p>
        <p>
          To stop the crawler, add <code>User-agent: Holler</code> and <code>Disallow: /</code> to your robots.txt, or write to us.
        </p>
      </DocSection>
      <DocSection title="Contact">
        <p>
          Questions, or a request to stop reading a page: <a href="mailto:support@localholler.com">support@localholler.com</a>. When you ask, we stop reading
          that page.
        </p>
      </DocSection>
    </DocPage>
  );
}
