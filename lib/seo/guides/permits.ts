import type { Guide } from './types';

export const permits: Guide = {
  slug: 'how-contractors-find-work-from-building-permits',
  title: 'How contractors find work from building permits',
  metaTitle: 'Find Contractor Work From Building Permits | Holler',
  description:
    'Many cities publish building permits as free open data. See which columns to filter, what 30 days of Chicago permits held and what to do the morning one posts.',
  directAnswer:
    'Many cities publish the building permits they issue as free open data, so you can see planned work near you as the city approves it. Chicago listed 2,525 permits issued from October 18 to November 17, 2026, and 152 of them were for reroofing. A permit shows planned work. It is not a signed job.',
  sections: [
    {
      heading: 'Which permit columns should a contractor filter on?',
      paragraphs: [
        'Filter on the issue date first and the kind of work second. In Chicago\'s [Building Permits](https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu) dataset those columns are called issue_date, permit_type, work_type and work_description, and the city says the set covers permits from 2006 to the present, leaving out any that were voided or revoked after issuance.',
        'Read work_description on every row you keep, because permit types are broad labels and the real job can be smaller or bigger than the label suggests. Skip this and you will write to the wrong people.',
        'Each row also carries a reported_cost column and slots for up to 15 contacts, from contact_1_type to contact_15_zipcode. Look at contact_1_type before you write to anyone: in the 30 days we counted, 1,703 rows listed Owner as the first contact, and others already named a general or electrical contractor. Other cities use other column names for the same ideas, and Austin publishes its own [Issued Construction Permits](https://data.austintexas.gov/Building-and-Development/Issued-Construction-Permits/3syk-w9eu/about_data) table, so open a few rows in your city before you build a routine on it.',
      ],
    },
    {
      heading: 'What did 30 days of Chicago permits look like?',
      paragraphs: [
        'We counted permits issued from October 18 to November 17, 2026, through the city\'s open data API on November 17. The totals can move a little as late rows arrive.',
        'Of the 2,525 permits, 1,599 came through the Express Permit Program, and only those rows had work_type filled in. The table shows the largest groups. Renovation or alteration was the biggest of the other permit types, with 465 permits. Sign permits came next at 140, then new construction at 128.',
        'Small, quick jobs dominate. That suits a one-truck shop that can answer in a day, and it means an electrician had 397 fresh records in one month in this one city alone, and a sign maker 140.',
      ],
      table: {
        caption: 'Chicago Express Permit Program permits by work_type, issued October 18 to November 17, 2026',
        head: ['Work type', 'Permits'],
        rows: [
          ['Electrical Work', '397'],
          ['Masonry Work', '188'],
          ['Reroofing', '152'],
          ['Fire Alarm System', '97'],
          ['Small-Scale Solar PV System', '73'],
          ['Fence or Trash Enclosure', '67'],
          ['Plumbing Work', '58'],
        ],
      },
    },
    {
      heading: 'What should you do the morning a new permit posts?',
      paragraphs: [
        'Work the list in the same order every day, and keep it to about 20 minutes so it survives a busy week.',
      ],
      ordered: true,
      bullets: [
        'Filter your city\'s table to issue dates from the last three days.',
        'Drop rows that already list a contractor in your trade as a contact.',
        'Set aside administrative changes and maintenance permits unless you know what they cover in your city.',
        'Read the description on what is left and pick the best three.',
        'Send each owner a short note that names the work and the street, the same day.',
        'Log what you sent. After a month, compare which work types turned into paid jobs and drop the ones that never do.',
      ],
    },
    {
      heading: 'What should a first note to a permit holder say?',
      paragraphs: [
        'Name the work and the street, then offer one next step. "I saw the reroofing permit for your building on Maple Street. I replace roofs in this part of town and can look at it Thursday. Call the number below if that helps." Three sentences is enough.',
        'A letter or a visit is the safer first touch. The FTC\'s [Do Not Call Q&A](https://www.ftc.gov/business-guidance/resources/qa-telemarketers-sellers-about-dnc-provisions-tsr-0) says it is against the law to call a number on the national registry unless you have an established business relationship with that person or their written agreement to be called. A permit record gives you neither. Check your city\'s rules on door-to-door selling before you knock. This is general information, not legal advice.',
      ],
    },
    {
      heading: 'What will permit data never show you?',
      paragraphs: [
        'Work done without a permit. Plenty of small repairs never need one, and some owners skip the process, so a quiet permit table does not mean a quiet street.',
        'Coverage is uneven. A big city may publish every weekday while the county next door publishes nothing, and descriptions can be short or full of codes. A permit can also be withdrawn after it posts.',
        'National numbers will not fill the gap. The Census Bureau\'s [Building Permits Survey](https://www.census.gov/econ/overview/co0200.html) reports the number and value of new privately owned housing units authorized by permits. Its monthly and annual figures go back to 1959 and come from individual permit offices. It counts new homes only, so it says nothing about a reroof or a fence in your ZIP code.',
      ],
    },
  ],
  howHolerHelps:
    'Holler reads new permits from the cities that publish them, including Chicago, New York City, Austin and San Francisco, and sends a short alert that links to the source record. Most towns are not connected yet, so [check your area](/check) to see what it would watch near your ZIP code before you pay for anything.',
  faq: [
    {
      q: 'Are building permits public records?',
      a: 'Many are, and many cities post issued permits online as open data. Chicago and Austin both do. What a record shows, such as whether owner names appear, depends on local rules, so check your own portal or permit office.',
    },
    {
      q: 'How old is too old for a permit lead?',
      a: 'There is no fixed rule. A record from the last few days is worth a note. Projects that need many trades run for months, so a new construction permit can still be worth a letter to the builder long after it posts.',
    },
    {
      q: 'Can I get building permit leads for free?',
      a: 'Yes, if your city publishes an open permit table. You can filter it by issue date and type of work yourself. The cost is your time each morning, plus the work of learning each city\'s column names.',
    },
  ],
  related: [
    { href: '/check', label: 'Check your area' },
    { href: '/for/general-contractor', label: 'Alerts for general contractors' },
    { href: '/guides/how-to-respond-to-a-local-lead-fast', label: 'How to respond to a local lead fast' },
  ],
  lastReviewed: '2026-11-17',
};
