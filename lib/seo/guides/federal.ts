import type { Guide } from './types';

export const federal: Guide = {
  slug: 'federal-contracts-for-small-local-businesses',
  title: 'Federal contracts for small local businesses',
  metaTitle: 'Federal Contracts for Small Local Businesses | Holler',
  description:
    'USAspending.gov shows federal awards already made near you. The dollar lines for small business set-asides, how old the data is and the steps to a first bid.',
  directAnswer:
    'USAspending.gov shows federal contract awards agencies have already made, usually about a week after the award. Use it to see who buys work like yours near you. Purchases between the micro-purchase line (usually $15,000, lower for some service and construction work) and $350,000 are generally set aside for small business. To bid, you usually need an active SAM registration.',
  sections: [
    {
      heading: 'What does USAspending actually show?',
      paragraphs: [
        'Money already committed. Not open bids. The [about-the-data document](https://www.usaspending.gov/data/about-the-data-download.pdf) says federal agencies are required to report spending data to the site under the DATA Act, and that contract data come from the Federal Procurement Data System, where contracting officials submit transaction-level data.',
        'That last part matters. The same document says data appear within five days of an award or a modification, so open the full award record and read its history before you judge the size of a job.',
        'Read the document once. It is long, but its sections on timing and data quality answer most questions a small firm will have.',
      ],
    },
    {
      heading: 'How old is the award data?',
      paragraphs: [
        'Newer than most people expect. The same document says contract data are generally available within five days of an award or modification, and gives the example of a Thursday award appearing the following Thursday.',
        'Defense is the exception. Department of Defense and Army Corps of Engineers data are delayed 90 days, so if your best buyer is a base or a district office, you are reading last season. Either way, the winner is already chosen. Use the data to learn who buys and how often, not to race for the same job.',
      ],
    },
    {
      heading: 'Which awards should a small local firm study?',
      paragraphs: [
        'Filter by where the work happens and by industry code, then sort by amount, smallest first. A crew of ten has little hope on a billion-dollar contract, but a repeat order for roof repair, paving or janitorial work at a nearby federal building is within reach.',
        'Then look at who keeps winning. A repeat winner is a competitor and also a possible customer, since some primes hire small local firms as subcontractors. Note which agencies place small orders often. A buyer that placed three last year is worth a capability note this year.',
      ],
    },
    {
      heading: 'Which purchases are set aside for small business?',
      paragraphs: [
        'Two dollar lines decide it. Under [FAR 2.101](https://www.acquisition.gov/far/2.101), the micro-purchase threshold is $15,000 in general, but $2,500 for services subject to the Service Contract Labor Standards and $2,000 for construction subject to the Wage Rate Requirements. The simplified acquisition threshold is $350,000. [FAR 19.502-2](https://www.acquisition.gov/far/19.502-2) says a purchase above the first and up to the second shall be set aside for small business, unless the contracting officer does not expect offers from two or more responsible small businesses. Above $350,000, a set-aside needs a reasonable expectation of offers from at least two of them at fair market prices.',
        'Whether you count as small depends on your work. The SBA assigns a [size standard](https://www.sba.gov/federal-contracting/contracting-guide/size-standards) to each NAICS code, generally based on employees or annual receipts.',
      ],
      example: {
        title: 'Worked example: a $40,000 janitorial order',
        lines: [
          'It is above every micro-purchase line ($15,000, $2,500 or $2,000) and below $350,000, so it is generally set aside for small business.',
          'It is over $25,000, so the agency has to advertise it on SAM.gov, according to the SBA.',
          'Your firm qualifies only if it meets the size standard for the janitorial NAICS code.',
        ],
      },
    },
    {
      heading: 'What are the steps to a first bid?',
      paragraphs: [
        'The SBA\'s [guide to winning contracts](https://www.sba.gov/counseling/how-to-win-contracts/) lays out most of this path. In order:',
      ],
      ordered: true,
      bullets: [
        'Look up the size standard for your main NAICS code. The SBA\'s [size standards page](https://www.sba.gov/federal-contracting/contracting-guide/size-standards) points to its Size Standards Tool for this.',
        'Register in SAM. The GSA\'s [registration guide](https://www.gsa.gov/small-business/find-opportunities/register-your-business) says registration can take up to several days, and you do not need to pay a third party to complete it.',
        'Search SAM.gov for notices in your trade and area.',
        'Contact the small business office of the agencies that buy near you.',
        'Check SUBNet, where large contractors post subcontracting opportunities.',
        'Send each buyer a short capability note: your trade, your area, your insurance and one relevant job.',
      ],
    },
    {
      heading: 'Where does award data fall short?',
      paragraphs: [
        'It is only as good as what agencies entered. The about-the-data document warns that some descriptions are overly lengthy or technical, use administrative codes instead of words, or lack meaningful information altogether.',
        'Some awards appear in agency financial systems but not in the government-wide award systems, and those lack recipient, location and industry. A missing location does not mean the work is far away.',
        'An award also says nothing about whether local demand is rising. It tells you how one agency spent money once. Treat a blank location as a reason to open the award record and read it, not as a reason to skip it.',
      ],
    },
  ],
  howHolerHelps:
    'Holler reads new federal contract awards from USAspending.gov every 12 hours, tags each to the place it names and matches it to trades by industry code. It cannot register you or place a bid. [Check your area](/check) to see what it would watch near you.',
  faq: [
    {
      q: 'What is USAspending.gov?',
      a: 'A federal site that publishes the spending data agencies are required to report under the DATA Act, including contract awards. Its contract data come from the Federal Procurement Data System.',
    },
    {
      q: 'Do I need to register to bid on federal contracts?',
      a: 'In most cases, yes. The GSA says offerors or quoters need an active registration in SAM, kept active for the life of the contract, and that you do not need to pay a third party to complete it.',
    },
    {
      q: 'What is the simplified acquisition threshold?',
      a: 'It is $350,000 under FAR 2.101. Federal purchases above the micro-purchase threshold ($15,000 in general, lower for some services and construction) and up to that amount are generally set aside for small business under FAR 19.502-2.',
    },
  ],
  related: [
    { href: '/check', label: 'Check your area' },
    { href: '/local', label: 'City pages' },
    { href: '/guides/free-public-data-sources-for-local-leads', label: 'Free public data sources for local leads' },
  ],
  lastReviewed: '2026-11-17',
};
