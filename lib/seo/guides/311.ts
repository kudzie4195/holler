import type { Guide } from './types';

export const requests311: Guide = {
  slug: 'what-311-requests-tell-local-service-businesses',
  title: 'What 311 requests tell local service businesses',
  metaTitle: 'What 311 Requests Tell Local Service Businesses | Holler',
  description:
    '311 requests are public in many cities. A month of Chicago data shows which request types matter to a trade, how many are already closed and how to count them.',
  directAnswer:
    '311 is a city line for problems that are not emergencies, and many cities publish the requests as open data. Chicago logged 1,665 fly dumping complaints from October 18 to November 17, 2026, and 1,088 were already marked Completed. Most requests go to city crews, so read them as a map of problems, not a list of customers.',
  sections: [
    {
      heading: 'What is 311, and where are the records kept?',
      paragraphs: [
        'It is the number people use when something is wrong but nobody is in danger. New York City\'s [contact page](https://www.nyc.gov/main/your-government/contact-nyc-government) says to contact 311 to get information about city government or to report problems that are not emergencies, by phone, online or by text. Phone and text are open around the clock.',
        'Many cities post the log as open data: Chicago publishes [311 Service Requests](https://data.cityofchicago.org/Service-Requests/311-Service-Requests/v6vf-nfxy), and Austin publishes [Austin 311 Public Data](https://data.austintexas.gov/Utilities-and-City-Services/Austin-311-Public-Data/xwdj-i9he). In Chicago\'s table the columns that matter are sr_type for the kind of request, created_date, status, duplicate and zip_code, though other cities name them differently.',
        'Some places publish only a map or an address lookup, which is fine for a quick look at one street and useless for counting anything over time. Ask for the table.',
      ],
    },
    {
      heading: 'What did a month of Chicago 311 requests show?',
      paragraphs: [
        'We counted requests created from October 18 to November 17, 2026, through the city\'s open data API, leaving out information-only calls. The biggest type by far was aircraft noise, at 43,874 requests, which helps no trade at all, so the useful rows sit further down the list.',
        'One tree type carried the words NO LONGER BEING ACCEPTED in its name, which is a good reason to read the type list before you count anything. Then count.',
      ],
      table: {
        caption: 'Selected Chicago 311 request types created October 18 to November 17, 2026',
        head: ['Request type (sr_type)', 'Requests', 'Trade it may fit'],
        rows: [
          ['Graffiti Removal Request', '8,806', 'Painters, pressure washing'],
          ['Rodent Baiting/Rat Complaint', '4,446', 'Pest control'],
          ['Tree Debris Clean-Up Request', '1,768', 'Tree crews'],
          ['Fly Dumping Complaint', '1,665', 'Junk removal'],
          ['Tree Emergency', '822', 'Tree crews'],
        ],
      },
      example: {
        title: 'Fly Dumping Complaint, same 30 days, by status',
        lines: [
          '1,665 requests filed in 30 days, which is more than 50 a day for this one type in one city.',
          '1,088 already marked Completed and 11 Canceled.',
          '566 still Open.',
          '88 flagged as duplicates of another request.',
        ],
      },
    },
    {
      heading: 'How do you turn 311 rows into a list of streets worth working?',
      paragraphs: [
        'A single request is weak, because the person asked the city for help, not a business. A pattern is useful. Ten rodent complaints on three blocks tell a pest control firm where to mail this month. One complaint tells it nothing.',
      ],
      ordered: true,
      bullets: [
        'Pick the two or three request types that fit your trade.',
        'Drop rows marked as duplicates, and set aside Completed and Canceled ones.',
        'Count what is left by ZIP code for each of the last four weeks.',
        'Put your mail or door-knocking time into the ZIP codes where the count jumped.',
        'Repeat the count every week. A flat number tells you an area is quiet for your kind of work, which is worth knowing too.',
      ],
    },
    {
      heading: 'Where is the line when you use 311 data?',
      paragraphs: [
        'Do not chase the person who made the report. They asked the city, not you. Write to the area instead: owners and neighbors on the blocks where the requests cluster, saying what you noticed in general terms, such as several dumping reports on the street this month, and offer one clear service. Never imply that the city sent you or that you are working with it.',
        'Expect gaps. Chicago notes that some of its rows come from an older system and are marked in a legacy_record column, and a request marked Completed is one the city has already closed. Check the date and the status before you spend a stamp.',
      ],
    },
  ],
  howHolerHelps:
    'Holler reads 311 requests from cities that publish them, such as Chicago, New York City, San Francisco and Austin, and matches the request types that fit a trade. Most cities are not connected yet, so the [free checker](/check) is the quickest way to see what it would watch near you.',
  faq: [
    {
      q: 'What does the 311 line handle?',
      a: 'City information and problems that are not emergencies. New York City says its 311 line takes calls and texts around the clock and also takes reports online, with interpretation for most languages on calls.',
    },
    {
      q: 'Are 311 requests public?',
      a: 'In many cities, yes: Chicago and Austin both publish 311 datasets on their open data portals, listing each request\'s type and status on every row. Whether your city does depends on the city.',
    },
    {
      q: 'Is a 311 complaint a sales lead?',
      a: 'Rarely on its own. Most go to city crews, and in Chicago 1,088 of 1,665 fly dumping complaints from one month were already marked Completed. A cluster of the same complaint in one area says more.',
    },
  ],
  related: [
    { href: '/check', label: 'Check your area' },
    { href: '/for/junk-removal', label: 'Alerts for junk removal' },
    { href: '/local', label: 'City pages' },
  ],
  lastReviewed: '2026-11-17',
};
