import type { Guide } from './types';

export const federal: Guide = {
  slug: 'federal-contracts-for-small-local-businesses',
  title: 'Federal contracts for small local businesses',
  metaTitle: 'Federal Contracts for Small Local Businesses | Holler',
  description:
    'USAspending.gov shows federal contract awards that agencies have already made. Learn what the data shows and how a small local firm can use it to find work.',
  directAnswer:
    'USAspending.gov publishes federal contract awards that agencies have already made. For a small local firm it shows who buys what near you, from whom and for how much. Use it to pick targets and to find prime contractors who may need subcontractors. It does not list open bids. To bid, you usually need an active SAM registration.',
  sections: [
    {
      heading: 'What does USAspending actually show?',
      paragraphs: [
        'It shows spending that federal agencies have reported. The site says agencies are required to report spending data to it under the DATA Act.',
        'Contract data come from the Federal Procurement Data System, where contracting officials submit transaction-level data for contracts. Each award can have more than one record, because a later change is a new transaction on the same award.',
        'Read the [about-the-data document](https://www.usaspending.gov/data/about-the-data-download.pdf) once. It explains the files, the delays and the known gaps. It is long. The first pages answer most questions a small firm will have, and the section on data quality will save you from a few wrong assumptions about what a record means.',
      ],
    },
    {
      heading: 'How old is the data?',
      paragraphs: [
        'Newer than you might guess, with some exceptions. The same document says an award is usually published about a week after it is made. For example, a Thursday award would normally appear the following Thursday.',
        'The exceptions matter. Contracts from the Department of Defense and the Army Corps of Engineers are published with a 90 day delay. If your best buyer is a base or a district office, you are reading old news.',
        'This is still award data. The money has been committed and the winner is chosen. Use the data to learn the buyer, not to race for the same job.',
      ],
    },
    {
      heading: 'Which awards matter to a small local firm?',
      paragraphs: [
        'Look for work like yours near you. Filter by what was bought and where the work happens, then sort by size. Small awards are the useful ones. A firm with a crew of ten has little hope on a billion dollar contract, but a repeat order for roof repair, paving or janitorial service at a nearby office is within reach.',
        'Check who keeps winning. A repeat winner is a competitor, and also a possible partner. Many awards need a local crew that the prime contractor does not employ.',
        'Note which agencies buy often. A buyer that placed three small orders last year will probably place more.',
      ],
    },
    {
      heading: 'What do you need before you can bid, and what are set-asides?',
      paragraphs: [
        'A registration in SAM. The General Services Administration says in its [guide to registering](https://www.gsa.gov/small-business/find-opportunities/register-your-business) that in most cases offerors or quoters are required to have an active federal government contracts registration in SAM, and that it must stay active for the life of the contract. You do not need to pay a third party to complete it, and it can take up to several days, so start early.',
        'USAspending shows what was awarded. SAM is where registration and bid notices live.',
        'Some contracts are reserved for small businesses. Under [FAR 19.502-2](https://www.acquisition.gov/far/19.502-2), acquisitions above the micro-purchase threshold, up to the simplified acquisition threshold, are generally set aside for small business. Above that threshold, a contracting officer sets an acquisition aside when there is a reasonable expectation of offers from at least two responsible small businesses at fair prices.',
        'Whether you count as small depends on the work. The SBA explains on its [size standards page](https://www.sba.gov/federal-contracting/contracting-guide/size-standards) that each NAICS code has a standard, based generally on the number of employees or the amount of annual receipts.',
      ],
    },
    {
      heading: 'Where else can small firms find federal work, and where does the data fall short?',
      paragraphs: [
        'Through larger contractors. The SBA lists several steps in its [guide to winning contracts](https://www.sba.gov/counseling/how-to-win-contracts/). It suggests using the Federal Procurement Data System and USAspending.gov to see which agencies buy what, contacting agency small business offices and searching SAM.gov, where agencies must advertise contracts over $25,000. The same guide points to SUBNet, where large contractors post subcontracting opportunities that want small business partners.',
        'Reach out with a short capability note. Name your trade, your area, your insurance and one relevant job. Then follow up once.',
        'Award data is only as good as what agencies entered. The about-the-data document warns that descriptions are often long or technical, use codes in place of words, or lack meaningful information altogether. It also says some awards that appear in only one government system lack fields such as recipient or location, so a missing location does not mean the work is far away.',
        'Do not read an award as a sign that local demand is rising. It tells you how one agency spent money, nothing more.',
      ],
    },
  ],
  howHolerHelps:
    'Holler reads new federal contract awards from USAspending.gov every 12 hours, tags each to the place it names and matches it to trades by industry code. You get a short alert with a link to the award. Holler cannot register you or place a bid. [Check your area](/check) to see what it would watch.',
  faq: [
    {
      q: 'What is USAspending.gov?',
      a: 'A federal site that publishes spending data that agencies are required to report under the DATA Act, including contract awards.',
    },
    {
      q: 'Do I need to register to bid on federal contracts?',
      a: 'In most cases, yes. The GSA says offerors or quoters generally need an active registration in SAM, and that you do not need to pay a third party to complete it.',
    },
    {
      q: 'How old are USAspending contract records?',
      a: 'An award is usually published about a week after it is made. Defense Department and Army Corps of Engineers contracts are published with a 90 day delay.',
    },
  ],
  related: [
    { href: '/check', label: 'Check your area' },
    { href: '/local', label: 'City pages' },
    { href: '/guides/free-public-data-sources-for-local-leads', label: 'Free public data sources for local leads' },
  ],
  lastReviewed: '2026-11-17',
};
