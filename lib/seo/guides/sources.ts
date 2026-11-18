import { priceLabel } from '@/lib/stripe/plans';
import type { Guide } from './types';

export const dataSources: Guide = {
  slug: 'free-public-data-sources-for-local-leads',
  title: 'Free public data sources for local leads',
  metaTitle: 'Free Public Data Sources for Local Leads | Holler',
  description:
    'A reference table of free government data that points to local work: who publishes each source, how fresh it is, which trades it suits and where to open it.',
  directAnswer:
    'Seven kinds of free government data point to local work: National Weather Service alerts, NOAA storm reports, FEMA disaster declarations, USGS earthquakes, FAA airport status, USAspending federal awards and city open data portals. None charges to read, and the table below says how fresh each one is, with a link to open it yourself.',
  sections: [
    {
      heading: 'Which free sources are there, and how fresh is each one?',
      paragraphs: [
        'The timing column quotes each publisher\'s own page, and the last column says how often our alerts check that source. Start there.',
      ],
      table: {
        caption: 'Free public sources, how fresh each publisher says it is, and how often our alerts check it',
        head: ['Source', 'What the publisher says about timing', 'Holler checks'],
        rows: [
          ['[NWS alerts API](https://www.weather.gov/documentation/services-web-api)', 'The alerts endpoint holds the past seven days', 'Every 15 minutes'],
          ['[NOAA storm reports](https://www.spc.noaa.gov/climo/reports/today.html)', 'All reports preliminary; a report day runs 1200 to 1159 UTC', 'Every 30 minutes'],
          ['[FEMA declarations](https://www.fema.gov/about/openfema/disaster-declarations-summaries)', 'The dataset page lists an update frequency of R/PT20M, every 20 minutes', 'Every 6 hours'],
          ['[USGS earthquake feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/atom.php)', 'Updated every minute', 'Every 30 minutes'],
          ['[FAA airport status](https://nasstatus.faa.gov/)', 'A live dashboard of the National Airspace System', 'Every 15 minutes, 40 major airports'],
          ['[USAspending awards](https://www.usaspending.gov/data/about-the-data-download.pdf)', 'Most contracts appear about a week after award; Defense and Army Corps contracts 90 days late', 'Every 12 hours'],
          ['City open data portals', 'Each city sets its own schedule', '311 about every 3 hours, permits about every 6'],
        ],
      },
    },
    {
      heading: 'Which source suits which trade?',
      paragraphs: [
        'Weather alerts and storm reports are national, so every town gets them, and they are the base layer for any trade that fixes what weather breaks. The rest are narrower.',
      ],
      bullets: [
        'Roofers and tree crews, and glass shops too: NWS warnings while a storm runs, then the storm reports once it has passed.',
        'Restoration firms and adjusters planning long recovery jobs: FEMA declarations, whose declaredCountyArea field names each county included in a declaration.',
        'Contractors in areas that get earthquakes: the USGS feeds, which you can filter by magnitude.',
        'Drivers and shuttle operators: FAA delays and ground stops. Skip it otherwise.',
        'Firms that sell to government: USAspending awards, which show who buys what near you. Our [federal contracts guide](/guides/federal-contracts-for-small-local-businesses) explains how a small firm can use them.',
        'Almost every trade: the city records in the next section, wherever your city publishes them.',
      ],
    },
    {
      heading: 'How do you read a city data portal for the first time?',
      paragraphs: [
        'Search the portal for the record type you want, then open the table rather than the map. Six kinds are worth looking for: building permits, 311 requests, health inspections, code violations, new business licenses and permitted events.',
        'Next, find the date column, sort it newest first and look at the top row, because the newest row tells you how far behind the city runs, which matters more than how many rows there are. [Chicago\'s permit table](https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu) is a good one to practice on.',
        'Last, check what a row means, because the same word can cover very different things from one portal to the next. Some tables list every active license, so an old shop looks like a new one until you filter on the date it was issued. Others hold only new records. Coverage is uneven too: a big city may publish all six kinds while the next county publishes none.',
      ],
    },
    {
      heading: 'What can none of these sources tell you?',
      paragraphs: [
        'Who wants to hire you. No record can. A record shows that something happened near a place, such as a hail report or a permit, and nothing about whether anyone there is looking for help.',
        'Every source can be late, and a few will be wrong. Plan for that. Storm reports are preliminary and change. City tables run on each city\'s own schedule, so check the newest row. Federal award data trails by about a week, and Defense awards by 90 days.',
        'An empty table is not proof of an empty market, either, because your town may simply not publish that kind of record, or may publish it somewhere a portal search does not reach. Each Holler alert links to its source page, so you can check the record yourself before you act.',
      ],
    },
  ],
  howHolerHelps:
    `You can open every source above yourself for free. Holler does the daily reading and emails an alert that links back to the source, for ${priceLabel('starter', 'monthly')} a month on Starter or ${priceLabel('pro', 'monthly')} a month on Pro, after a 7-day free trial with no card. The [free checker](/check) shows what it would watch near your ZIP code.`,
  faq: [
    {
      q: 'Are these data sources free?',
      a: 'Yes. Each one is published by a government body as open data or as a public page, and none charges to read. The National Weather Service says its API is open data, free to use for any purpose.',
    },
    {
      q: 'Which source updates the fastest?',
      a: 'The USGS marks its earthquake feeds as updated every minute. National Weather Service warnings are also fast, because a warning is issued while severe weather is happening or about to.',
    },
    {
      q: 'Where do the federal contract records come from?',
      a: 'From USAspending.gov, which takes contract data from the Federal Procurement Data System. These are awards agencies have already made, so they show who buys what near you rather than open bids.',
    },
  ],
  related: [
    { href: '/check', label: 'Check your area' },
    { href: '/local', label: 'City pages' },
    { href: '/data', label: 'Local public records in numbers' },
  ],
  lastReviewed: '2026-11-17',
};
