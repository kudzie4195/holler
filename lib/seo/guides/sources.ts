import { priceLabel } from '@/lib/stripe/plans';
import type { Guide } from './types';

export const dataSources: Guide = {
  slug: 'free-public-data-sources-for-local-leads',
  title: 'Free public data sources for local leads',
  metaTitle: 'Free Public Data Sources for Local Leads | Holler',
  description:
    'A reference list of the free public sources Holler reads: who publishes each one, what it holds, how often it changes and where to open it yourself.',
  directAnswer:
    'Holler reads seven kinds of free public source: National Weather Service alerts, NOAA storm reports, FEMA disaster declarations, USGS earthquakes, FAA airport status, USAspending federal awards and city open data portals. This list says who publishes each one, what it holds, how often it changes and where to open it yourself.',
  sections: [
    {
      heading: 'Which free sources cover weather and storms?',
      paragraphs: ['Two sources cover most storm work. Holler checks each on its own schedule.'],
      bullets: [
        'National Weather Service alerts. The NWS publishes warnings, watches and advisories. Its [alerts API](https://www.weather.gov/documentation/services-web-api) is open data and holds alerts issued over the past seven days. Holler checks every 15 minutes.',
        'NOAA Storm Prediction Center storm reports. The center posts each day\'s reports of hail, wind and tornadoes on its [storm reports page](https://www.spc.noaa.gov/climo/reports/) and labels all of them preliminary. Holler checks every 30 minutes.',
        'Both are national. Every town gets them. That makes them the base layer for roofers, tree crews, glass shops and restoration firms, and the first thing a new member of the team should learn to read.',
      ],
    },
    {
      heading: 'Which sources cover disasters, earthquakes and airports?',
      paragraphs: [
        'FEMA publishes a [disaster declarations dataset](https://www.fema.gov/about/openfema/disaster-declarations-summaries) that it describes as a summarized list of all federally declared disasters. It moves slowly, because a governor has to ask for a declaration first. Holler checks it every six hours. Declarations help restoration firms, adjusters and general contractors plan long recovery work in the named counties.',
        'The U.S. Geological Survey runs the earthquake feed. Its [earthquake feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/atom.php) are marked as updated every minute, in windows from the past hour to the past 30 days, at several magnitude levels. Holler checks every 30 minutes.',
        'The FAA publishes its National Airspace System dashboard at [nasstatus.faa.gov](https://nasstatus.faa.gov/). Holler reads airport delays and ground stops from it for 40 major airports and checks every 15 minutes. The signal is narrow. It suits drivers, shuttle operators and delivery firms. If you do not touch air travel, skip it.',
      ],
    },
    {
      heading: 'What do USAspending federal awards contain?',
      paragraphs: [
        'USAspending.gov publishes spending data that federal agencies must report. Its [about-the-data document](https://www.usaspending.gov/data/about-the-data-download.pdf) says contract data come from the Federal Procurement Data System. A contract award usually shows up about a week after it is made. Defense and Army Corps of Engineers contracts are published with a 90 day delay.',
        'Holler checks USAspending every 12 hours and tags awards to the places they name. Each one links to the record on the site. These are awards that were already made. They show who buys what near you, not open bids. Our [federal contracts guide](/guides/federal-contracts-for-small-local-businesses) explains how a small firm can use them.',
      ],
    },
    {
      heading: 'Which city open data feeds does Holler read?',
      paragraphs: [
        'Cities and counties publish their own tables, usually on a portal. Holler reads six kinds where a city offers them: building permits, 311 requests, health inspections, code violations, new business licenses and permitted events.',
        'Each city sets its own schedule. Look at [Chicago permits](https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu) or [Austin 311](https://data.austintexas.gov/Utilities-and-City-Services/Austin-311-Public-Data/xwdj-i9he) to see what a portal looks like. Holler checks 311 about every three hours, permits about every six hours and inspections about every twelve.',
        'Coverage is uneven. A big city may publish all six kinds while the next county publishes none. Holler has connected only some cities so far, so a town it has not connected gets the national feeds but not its own records.',
      ],
    },
    {
      heading: 'What are the limits of all these sources?',
      paragraphs: [
        'Every source can be late, and a few will be wrong. Preliminary reports change. City tables lag the counter by a day or more. Federal award data trails by a week or longer.',
        'Records show that something happened, not that someone wants to hire you. Use them to decide where to look first, then check the source before you write to anyone. Each Holler alert links to its source page, so you can always check the record yourself.',
        'Coverage is the other limit. A source that has nothing for your town may simply not publish it, so an empty page is not proof of an empty market.',
      ],
    },
  ],
  howHolerHelps:
    `You can open every source above yourself for free. Holler does the daily reading, matches each record to your trades and area, and emails a short alert that links back to the source. Starter costs ${priceLabel('starter', 'monthly')} a month or ${priceLabel('starter', 'annual')} a year, and Pro costs ${priceLabel('pro', 'monthly')} a month or ${priceLabel('pro', 'annual')} a year. Both start with a 7-day free trial and no card. Start with the [free checker](/check) to see what it would watch near your ZIP code.`,
  faq: [
    {
      q: 'Are these data sources free?',
      a: 'Yes. Each one is published by a government body as open data or as a public page, and none requires payment to read.',
    },
    {
      q: 'Which source updates the fastest?',
      a: 'The USGS marks its earthquake feeds as updated every minute. National Weather Service alerts are also fast, and Holler checks them every 15 minutes.',
    },
    {
      q: 'Where do the federal contract records come from?',
      a: 'From USAspending.gov. These are awards that agencies have already made, so they show who buys what near you rather than open bids.',
    },
  ],
  related: [
    { href: '/check', label: 'Check your area' },
    { href: '/local', label: 'City pages' },
    { href: '/data', label: 'Local public records in numbers' },
  ],
  lastReviewed: '2026-11-17',
};
