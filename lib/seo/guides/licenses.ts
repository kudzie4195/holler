import type { Guide } from './types';

export const licenses: Guide = {
  slug: 'new-business-licenses-as-a-lead-source',
  title: 'New business licenses as a lead source',
  metaTitle: 'New Business Licenses as a B2B Lead Source | Holler',
  description:
    'New business licenses show who is opening near you. How to separate new licenses from renewals in city data, what a month in Chicago held and how to pitch.',
  directAnswer:
    'A new business license is a public sign that a company is opening, and a new company often needs cleaning, signs, IT help or bookkeeping in its first weeks. Chicago issued 586 new licenses from October 18 to November 17, 2026, next to 1,784 renewals. Filter out the renewals, then write before the doors open.',
  sections: [
    {
      heading: 'Why does a new license point to new work?',
      paragraphs: [
        'A new company has a to-do list and a deadline, because somebody has to clean the space, hang the sign, set up the network and keep the books, and an owner opening a first location may have no vendors at all yet.',
        'Licenses come from several levels of government. The SBA explains on its [licenses and permits page](https://www.sba.gov/business-guide/launch-your-business/apply-licenses-permits) that business activities regulated by a federal agency need a federal license, that most small businesses need a mix of federal and state licenses, and that you may also need licenses from your county or city. The city or county record is the useful one for finding customers, because it names a place and a kind of business.',
        'Not every business shows up, and a consultant working from home may never appear in any table you can search.',
      ],
    },
    {
      heading: 'How do you tell new licenses from renewals?',
      paragraphs: [
        'Find the column that says why the row exists. Chicago\'s [Business Licenses - Current Active](https://data.cityofchicago.org/Community-Economic-Development/Business-Licenses-Current-Active/uupf-x98q) table holds every license with a future expiration date, so most rows are old shops. Its application_type column separates them: when we counted on November 17, 2026, the whole table held 41,160 RENEW rows and 10,493 ISSUE rows. Filter on ISSUE and sort by date_issued, newest first.',
        'Other cities name their tables differently. San Francisco publishes [Registered Business Locations](https://data.sf.gov/Economy-and-Community/Registered-Business-Locations-San-Francisco/g8m3-pdis), so read its column names before you trust a count. Where your city publishes nothing, a call to the clerk may turn up a weekly list.',
      ],
      example: {
        title: 'Chicago, new licenses (ISSUE) dated October 18 to November 17, 2026',
        lines: [
          '586 new licenses in all.',
          'Limited Business License: 135.',
          'Retail Food Establishment: 92.',
          'Pop-Up Retail User: 86, and Pharmaceutical Representative: 31. Neither describes a new storefront, so drop both.',
        ],
      },
    },
    {
      heading: 'How do you pitch a business that has not opened yet?',
      paragraphs: [
        'Briefly, and with one offer. "Congratulations on the new space on Oak Street. We clean offices in this neighborhood and can do a move-in clean before you open. Want a quote?" A visit with a card works too, if someone is on site.',
        'Email has rules even between businesses. The FTC\'s [CAN-SPAM guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business) says the law makes no exception for business-to-business email: include your valid physical postal address and a clear way to opt out, and honor opt-outs within 10 business days. Calls are looser. The FTC\'s [Telemarketing Sales Rule guide](https://www.ftc.gov/business-guidance/resources/complying-telemarketing-sales-rule) says most calls between a telemarketer and a business are exempt from that rule, but not calls selling nondurable office or cleaning supplies. This is general information, not legal advice.',
      ],
    },
    {
      heading: 'Which trades get the most from new licenses?',
      paragraphs: [
        'Anyone who sells to small businesses. Commercial cleaners are the clearest fit, because every new space needs cleaning. Sign makers and printers come next. IT support firms and bookkeepers follow, along with insurance agents and security installers. Locksmiths and pest control firms can sell to the same owners.',
        'Match the offer to the license type, since a Retail Food Establishment needs a different first service than a salon or an office, and one generic list of services reads like a flyer.',
        'Test before you scale. Send one offer to three new owners and see who answers, and only after that send it to thirty. For the national trend, the Census Bureau\'s [Business Formation Statistics](https://www.census.gov/econ/bfs/about_the_data.html) count applications for an Employer Identification Number, with monthly data released about 11 to 12 days after each month ends. That shows direction, not your block.',
      ],
    },
  ],
  howHolerHelps:
    'Holler reads new business license records from cities that publish them, including Chicago, San Francisco, Los Angeles, New York City and Orlando, and matches them to trades such as cleaning and signs. Most cities are not connected yet, so try the [free checker](/check) to see what it would watch near you.',
  faq: [
    {
      q: 'Are business licenses public records?',
      a: 'Often, yes. Chicago and San Francisco both publish business license or registration data on their open data portals. Whether your city does depends on the city, and a call to the city clerk can tell you.',
    },
    {
      q: 'What is the best time to contact a new business?',
      a: 'Early: before it opens or in its first weeks, while the owner is still choosing vendors. In Chicago\'s data, filter application_type to ISSUE and sort by date_issued to find licenses from the last few weeks.',
    },
    {
      q: 'Does CAN-SPAM apply to business email?',
      a: 'Yes. The FTC says the law makes no exception for business-to-business email. Include your physical postal address and a clear way to opt out, and honor opt-outs within 10 business days.',
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
