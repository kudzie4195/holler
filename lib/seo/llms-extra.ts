import { GUIDES, guidePath } from './guides';

/**
 * Parts of /llms.txt added by the guides, FAQ, numbers and pricing work. llmsText (public-copy.ts) holds the rest and is not changed:
 * this module replaces its one-line Pricing section with both plans and adds the new sections before "## Pages".
 */

function firstSentence(s: string): string {
  const m = s.match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : s).trim();
}

export function pricingSection(url: (p: string) => string): string[] {
  return [
    '## Pricing',
    '',
    `- Starter: $5 per month or $48 per year. 1 service area and up to 5 trades.`,
    `- Pro: $9.99 per month or $96 per year. Up to 3 service areas, up to 15 trades and up to 5 keyword watches.`,
    '- Both plans: alerts by email, the feed, and replies to resident requests.',
    '- Every account starts with a 7-day free trial. No card is needed to start. The trial has Starter limits.',
    `- Details: ${url('/pricing')}`,
    '',
  ];
}

export function newSections(url: (p: string) => string): string[] {
  return [
    '## Guides',
    '',
    `Plain-language guides, each starting with a short direct answer, citing official sources and showing a last reviewed date. Index: ${url('/guides')}`,
    '',
    ...GUIDES.map((g) => `- [${g.title}](${url(guidePath(g.slug))}): ${firstSentence(g.directAnswer)}`),
    '',
    '## FAQ and numbers',
    '',
    `- [FAQ](${url('/faq')}): answers on what Holler is, data and coverage, pricing and trial, and resident requests.`,
    `- [Local public records in numbers](${url('/data')}): original counts computed from the public records Holler has read, refreshed about every hour, with the time of the newest record. The counts show what Holler read, not how much demand exists.`,
    '',
    '## Resident requests',
    '',
    `A member of the public can post what they need at ${url('/request')}. It is free. After the person confirms it by email, a public page shows only the service and the city. Matching businesses see the description, with contact details removed, in their Holler feed and email, and reply through Holler. A business never sees the resident's email address unless the resident replies to that business, and no page shows it. A request stays open for 14 days and can be closed at any time.`,
    '',
  ];
}

/** Put both plans in the pricing section and the new sections before "## Pages" (or at the end if that heading is gone). */
export function withPublicPages(base: string, url: (p: string) => string): string {
  let text = base;
  const pricing = pricingSection(url).join('\n');
  if (/## Pricing\n\n[^\n]*\n\n?/.test(text)) text = text.replace(/## Pricing\n\n[^\n]*\n\n?/, `${pricing}\n`);
  else text = `${text.replace(/\n*$/, '\n')}\n${pricing}\n`;
  const extra = newSections(url).join('\n');
  if (text.includes('\n## Pages\n')) return text.replace('\n## Pages\n', `\n${extra}\n## Pages\n`);
  return `${text.replace(/\n*$/, '\n')}\n${extra}\n`;
}
