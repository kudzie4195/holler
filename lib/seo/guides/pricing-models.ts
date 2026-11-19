import type { Guide } from './types';

export const payPerLead: Guide = {
  slug: 'pay-per-lead-vs-flat-fee-alerts',
  title: 'Pay-per-lead vs flat-fee alerts',
  metaTitle: 'Pay-Per-Lead vs Flat-Fee Lead Alerts | Holler',
  description:
    'Pay-per-lead charges for each lead. Flat-fee alerts charge one price. A side-by-side table, a worked cost-per-job example and the questions to ask any seller.',
  directAnswer:
    'Pay-per-lead charges you each time a lead is delivered, whether or not you win the job. A flat-fee alert service charges one price and leaves the outreach to you. Compare them by cost per job won: everything a source cost you in a month, your time included, divided by the jobs it produced.',
  sections: [
    {
      heading: 'How do the two models differ, side by side?',
      paragraphs: [
        'The biggest difference is who reached out first. With a bought lead, a person usually asked to be contacted, while with an alert nobody did: you see a public record and decide whether it is worth a letter or a visit.',
      ],
      table: {
        caption: 'Pay-per-lead and flat-fee alerts compared',
        head: ['', 'Pay-per-lead', 'Flat-fee alerts'],
        rows: [
          ['You pay for', 'Each lead delivered', 'A month or a year of alerts'],
          ['Who asked first', 'The person, if the seller is honest about it', 'Nobody; you choose whom to contact'],
          ['Who else gets it', 'Whoever else the seller sells it to', 'Anyone who reads the same public record'],
          ['Cost in a busy month', 'Grows with every lead', 'Stays the same'],
          ['Main risk', 'Paying for leads that go nowhere', 'Records that never turn into work'],
        ],
      },
    },
    {
      heading: 'How do you work out cost per job won?',
      paragraphs: [
        'Do the math. Add up everything a source cost you in a month, then divide by the jobs you won from it. Count your own time, because a cheap source that eats an hour a day is not cheap.',
        'The example below uses made-up round numbers, not survey data. Swap in your own.',
      ],
      example: {
        title: 'Worked example: one month, two sources',
        lines: [
          'Pay-per-lead: 20 leads at $30 each is $600, and 3 jobs won makes $200 per job.',
          'Flat fee: a $10 plan plus 15 minutes a day of reading is about 7.5 hours a month.',
          'At $40 an hour, that time is worth $300, so the month really cost $310.',
          'One job won from it makes $310 per job. Two make $155.',
          'Now compare each figure with the profit on a typical job of yours.',
        ],
      },
    },
    {
      heading: 'What should you ask a lead seller before you pay?',
      paragraphs: [
        'Ask in writing. Keep the answers. Skip any seller that will not say where its leads come from.',
      ],
      bullets: [
        'Is the lead mine alone, or sold to several businesses? If shared, how many?',
        'What counts as a valid lead, and is a wrong number or an out-of-area request refunded?',
        'How did the person agree to be contacted by businesses?',
        'How old can a lead be when it reaches me?',
        'Is there a minimum spend, a contract term or a cancellation fee?',
        'Can I see the source of each lead so I can check it myself?',
      ],
    },
    {
      heading: 'Do call and email rules still apply to a lead you paid for?',
      paragraphs: [
        'Yes. The rules follow you, not the seller. The FTC\'s [Do Not Call Q&A](https://www.ftc.gov/business-guidance/resources/qa-telemarketers-sellers-about-dnc-provisions-tsr-0) says it is against the law to call a number on the national registry unless you have an established business relationship or written agreement. An inquiry creates that relationship for three months, and a purchase for up to 18. If you make sales calls, you must also check your list against the registry at least every 31 days.',
        'On a sales call, the FTC\'s [Telemarketing Sales Rule guide](https://www.ftc.gov/business-guidance/resources/complying-telemarketing-sales-rule) says the caller must promptly disclose, before any pitch, who the seller is and that the call is to sell.',
        'Email has its own law. The FTC\'s [CAN-SPAM guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business) says you cannot contract away your responsibility by hiring someone else to send, and each email in violation can cost up to $53,088. This is general information, not legal advice.',
      ],
    },
    {
      heading: 'Which model fits which business?',
      paragraphs: [
        'A crew with a high price per job can afford warm leads, because one won job covers many lost ones. A solo operator who answers every message by hand may do better with a small flat fee and a few good records a week.',
        'Mixing works too, as long as you track each source on its own and never let one hide behind the other. Use alerts for steady, low-cost signals and buy leads only in weeks with open slots. Judge both by cost per job won over the same three months, and drop whichever does not pay. The first week of any source proves little. Whichever you choose, the reply habits are the same: answer quickly and name the job, then offer a time. Keep a log of what each source produced, so the numbers in the example above come from your own work and not from a guess.',
      ],
    },
  ],
  howHolerHelps:
    'Holler is a flat-fee alert service: it sends records from public data, not people who asked for a quote. The one exception is the free resident request page, where people post what they need and businesses reply through Holler. The [pricing page](/pricing) lists both plans.',
  faq: [
    {
      q: 'What is pay-per-lead?',
      a: 'A model where you pay each time a seller delivers a lead, whether or not you win the job. The seller decides what counts as a lead, so read that definition before you sign anything.',
    },
    {
      q: 'What is a flat-fee lead alert?',
      a: 'A fixed price for a month or a year, for which the service sends records from public data, such as permits or storm reports, and you decide whether and how to reach out to anyone.',
    },
    {
      q: 'Can I call every lead I buy?',
      a: 'No. The FTC says it is against the law to call numbers on the National Do Not Call Registry unless you have an established business relationship or the person\'s written agreement. Sales callers must also check the registry at least every 31 days.',
    },
  ],
  related: [
    { href: '/pricing', label: 'Holler pricing' },
    { href: '/guides/how-to-respond-to-a-local-lead-fast', label: 'How to respond to a local lead fast' },
    { href: '/request', label: 'Post a request' },
  ],
  lastReviewed: '2026-11-17',
};
