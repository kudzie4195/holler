import type { Guide } from './types';

export const licenses: Guide = {
  slug: 'new-business-licenses-as-a-lead-source',
  title: 'New business licenses as a lead source',
  metaTitle: 'New Business Licenses as a B2B Lead Source | Holler',
  description:
    'A new business license is a public sign that a company is opening. Learn how cleaners, sign makers, IT firms and bookkeepers can use them to find new clients.',
  directAnswer:
    'A new business license is a public sign that a company is opening or moving. A new company often needs cleaning, signs, IT help or bookkeeping in its first weeks. Some cities publish licenses as open data. Find the new ones, write before the doors open and offer one specific service.',
  sections: [
    {
      heading: 'Why does a new business license mean new work?',
      paragraphs: [
        'Because every new company has a to-do list and a deadline. Somebody has to clean the space, hang the sign, set up the network, keep the books and lock the door.',
        'Many of these buyers are shopping in the same few weeks, and some have never hired a local vendor before. That is rare. An established business already has a cleaner and an IT person. A new one has neither.',
        'The license record is the earliest public trace. It usually appears before the first customer walks in, which means you can be the first vendor to write, not the fifth.',
      ],
    },
    {
      heading: 'Who has to get a license, and from whom?',
      paragraphs: [
        'It depends on the work and the place. The SBA explains on its [licenses and permits page](https://www.sba.gov/business-guide/launch-your-business/apply-licenses-permits) that business activities regulated by a federal agency need a federal license or permit, that most small businesses need a mix of federal and state ones, and that you may also need licenses from your county or city.',
        'That mix is why local records matter for lead finding. The city or county license is the one that names a place and a type of business, and it is often the one that is open to the public.',
        'Not every business needs one. A remote consultant working from home may never appear in the data. Expect to see storefronts, restaurants, salons, shops and contractors, which is a lot of the clients you want.',
      ],
    },
    {
      heading: 'Where can you see new business licenses, and how many are there?',
      paragraphs: [
        'On your city open data portal, if it publishes them. Chicago lists [Business Licenses - Current Active](https://data.cityofchicago.org/Community-Economic-Development/Business-Licenses-Current-Active/uupf-x98q). San Francisco lists [Registered Business Locations](https://data.sf.gov/Economy-and-Community/Registered-Business-Locations-San-Francisco/g8m3-pdis) on DataSF. Many cities publish nothing here, and a call to the clerk may turn up a weekly list.',
        'Read the columns before you rely on a table. Look for a business name, an address, a license type and a start or issue date. Some tables list every active license, so you must sort by date to find the new ones. Others hold only new records. Check which kind you have, or you will mistake a long-standing shop for a fresh opening.',
        'For a national feel, the Census Bureau\'s [Business Formation Statistics](https://www.census.gov/econ/bfs/about_the_data.html) cover Employer Identification Number applications made in the United States, with monthly data released about 11 to 12 days after the end of the month. That counts applications for an employer number, not licenses, so it shows the national trend and not your block. For your own town, count new licenses by month for a year.',
      ],
    },
    {
      heading: 'How do you pitch a brand-new business?',
      paragraphs: [
        'Be specific and brief. Name the business, say what you do and offer one useful first step. "Congratulations on the new space on Oak Street. We clean offices in this neighborhood and can do a move-in cleaning before you open. Want a quote?"',
        'Send it early. After the first month the owner has usually picked vendors for the basics.',
        'If you email, follow the rules. The FTC [CAN-SPAM guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business) says the law makes no exception for business-to-business email. Include your valid physical postal address and a clear way to opt out, and honor opt-outs within 10 business days. This is general information, not legal advice.',
        'A visit with a card often works better than any message. Owners are on site anyway.',
      ],
    },
    {
      heading: 'Which trades benefit most?',
      paragraphs: [
        'Anyone who sells to small businesses. Commercial cleaners and janitorial crews are the clearest fit, because every new space needs a cleaning contract. Sign makers and printers come next, because a new business needs a sign and menus or cards.',
        'IT support, bookkeepers, insurance agents and security installers all sell something a new owner must buy soon. So do locksmiths, pest control firms and handymen.',
        'Pick one offer for each kind of business, and test it on three owners before you send it to thirty. A salon needs different help than a restaurant. A generic list of services reads like a flyer. Flyers get thrown away.',
      ],
    },
  ],
  howHolerHelps:
    'Holler reads new business license records from the cities that publish them, including Chicago, San Francisco, Los Angeles, New York City and Orlando, and matches them to trades such as cleaning, signs, IT and bookkeeping. You get a short alert with a link to the record. Most cities are not connected. Try the [free checker](/check) to see what it would watch near you.',
  faq: [
    {
      q: 'Are business licenses public records?',
      a: 'Often, yes. Chicago and San Francisco both list business license data on their open data portals. Whether your city does depends on the city.',
    },
    {
      q: 'What is the best time to contact a new business?',
      a: 'Early, before it opens or in its first weeks. After the first month most owners have chosen vendors for cleaning, signs and basic services.',
    },
    {
      q: 'Does CAN-SPAM apply to business email?',
      a: 'Yes. The FTC says the law makes no exception for business-to-business email. Include your physical address and a way to opt out.',
    },
  ],
  related: [
    { href: '/for/janitorial-commercial', label: 'Alerts for commercial cleaners' },
    { href: '/for/signs-printing', label: 'Alerts for sign makers' },
    { href: '/for/business-services', label: 'Alerts for IT and bookkeeping' },
    { href: '/check', label: 'Check your area' },
  ],
  lastReviewed: '2026-11-17',
};
