import type { Guide } from './types';

export const permits: Guide = {
  slug: 'how-contractors-find-work-from-building-permits',
  title: 'How contractors find work from building permits',
  metaTitle: 'Find Contractor Work From Building Permits | Holler',
  description:
    'A building permit is a public record that someone plans to spend money on a property. Learn where to read new permits for free and how to act on them quickly.',
  directAnswer:
    'A building permit is a public record that someone is about to spend money on a property. Many cities publish new permits as open data. Read them by address, type and date, and you can reach owners and builders before the work starts. A permit shows intent, not a signed job, so move fast.',
  sections: [
    {
      heading: 'What does a building permit tell a contractor?',
      paragraphs: [
        'It tells you that someone asked the city for permission to build, change or repair something. That is a strong sign of money about to move.',
        'A typical record carries an address, a permit type, a filing or issue date and a short description of the work. Some also list the applicant or the contractor on file. Others hide names on purpose. The details differ from city to city, so read a few records before you build a routine around them.',
        'The scale is real. The Census Bureau runs a [Building Permits Survey](https://www.census.gov/econ/overview/co0200.html) that reports the number and valuation of new privately owned housing units authorized by building permits. Its data are available monthly and annually since 1959. That is national housing only, and it comes from individual permit offices, most of them municipalities. Your own town is a much smaller and more useful slice.',
      ],
    },
    {
      heading: 'Where can you read permits for free?',
      paragraphs: [
        'Start with your city or county website and search for the words open data and permits together. Many places post a table you can sort and download.',
        'Chicago lists a dataset called [Building Permits](https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu) on its data portal. Austin lists [Issued Construction Permits](https://data.austintexas.gov/Building-and-Development/Issued-Construction-Permits/3syk-w9eu/about_data) on its own. Both are free to open. Check how fresh the newest row is before you rely on either one.',
        'Some towns only offer a lookup box where you type an address. That still works for a short list of streets you already serve. It does not work for finding new work across a whole county. If your city has no open table, call the permit counter and ask whether weekly lists exist.',
      ],
    },
    {
      heading: 'Which permits match which trades?',
      paragraphs: [
        'Match the permit type to what your crew does. These pairings are common, but always read the description on each record before you write to anyone, because a permit type is a broad label and the real job may be smaller, larger or a different trade than you expect.',
        'Here is a short guide to start from.',
      ],
      bullets: [
        'A reroof or roof repair permit points to roofers and gutter crews.',
        'An electrical or panel permit points to electricians.',
        'A new pool permit points to pool builders and fence companies.',
        'A demolition permit points to junk haulers and concrete crews.',
        'A commercial build-out permit points to commercial cleaners, sign makers and security installers.',
        'A new house permit points to nearly everyone, over many months. Flooring, painting and landscaping crews come last, so there is time to introduce yourself to the builder.',
      ],
    },
    {
      heading: 'How fast should you act on a new permit?',
      paragraphs: [
        'Quickly, but not blindly. A permit often means the owner has already picked a contractor. That is common for big jobs. It is less common for small repairs, where the permit may be a formality that the owner never thought about.',
        'Cities post on their own schedules, so a record can show up a day or more after the permit was issued. The older the record, the likelier the job is already spoken for. Aim to read new records every morning and answer the best three the same day.',
        'Skip permits where the filer is a large builder with its own crews. Spend your hour on records with a plain description, a street address and no contractor listed. Those owners are still deciding. A short, specific note about the exact work on their permit gets read more often than a generic flyer.',
      ],
    },
    {
      heading: 'What should you say to someone who just filed a permit?',
      paragraphs: [
        'Name the work and the address. Offer one next step. Keep it under three sentences.',
        'For example: "I saw the permit for the roof on Maple Street. I replace roofs in this part of town and can look at it Thursday. Reply here and I will send times." That is honest and easy to answer.',
        'Be careful with calls. The FTC says in its [Do Not Call Q&A](https://www.ftc.gov/business-guidance/resources/qa-telemarketers-sellers-about-dnc-provisions-tsr-0) that it is against the law to call numbers on the National Do Not Call Registry unless an established business relationship or written agreement exists. An inquiry creates a relationship for three months, and a purchase for 18. A permit is neither. A letter or a visit is usually the safer first touch. Check your local rules for door-to-door work. This is general information, not legal advice.',
      ],
    },
    {
      heading: 'What are the limits of permit data?',
      paragraphs: [
        'Permits miss a lot. Plenty of small jobs never need one, and some owners skip the process. You will only see work that was filed.',
        'Coverage depends on where you work. A big city may publish daily while the next county over publishes nothing. Descriptions are short and sometimes use codes. A permit can also be withdrawn or never picked up.',
        'Treat each record as a lead to check, not a fact about demand. Read the source row before you write to anyone.',
        'Keep your own note of what you sent and when. After a month that list tells you which kinds of permits turned into paid work for your shop and which ones only filled your inbox, and that is worth more than any rule of thumb in a guide.',
      ],
    },
  ],
  howHolerHelps:
    'Holler reads new permits from the cities that publish them, matches each one to the trades it fits and sends a short alert that links to the source record. Chicago, New York City, Austin and San Francisco are connected, along with some other places. Most towns are not yet. [Check your area](/check) first to see what it would watch near your ZIP code.',
  faq: [
    {
      q: 'Are building permits public records?',
      a: 'In most places, yes. Cities and counties keep permit files open to the public, and many post them online as open data. What each record shows varies, and some cities hide personal names.',
    },
    {
      q: 'Can I get building permit leads for free?',
      a: 'Yes, if your city publishes an open permit table. You can sort it by date and type yourself. It takes time every day, which is the main cost.',
    },
    {
      q: 'How old is too old for a permit lead?',
      a: 'There is no fixed rule. Records from the last few days are worth a message. After a few weeks the owner has usually chosen someone, except on large projects that need many trades.',
    },
  ],
  related: [
    { href: '/check', label: 'Check your area' },
    { href: '/for/general-contractor', label: 'Alerts for general contractors' },
    { href: '/guides/how-to-respond-to-a-local-lead-fast', label: 'How to respond to a local lead fast' },
  ],
  lastReviewed: '2026-11-17',
};
