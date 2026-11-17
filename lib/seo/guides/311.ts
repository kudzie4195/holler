import type { Guide } from './types';

export const requests311: Guide = {
  slug: 'what-311-requests-tell-local-service-businesses',
  title: 'What 311 requests tell local service businesses',
  metaTitle: 'What 311 Requests Tell Local Service Businesses | Holler',
  description:
    '311 is a city line for non-emergency problems. Many cities publish those requests as open data. See what they show a local business and where they mislead.',
  directAnswer:
    '311 is a city line for non-emergency problems, such as a fallen tree, dumped trash or a broken sidewalk. Many cities publish those requests as open data. For a local business they show which blocks have a problem right now. Most requests go to city crews, so read them as signs of demand, not as sales leads.',
  sections: [
    {
      heading: 'What is 311?',
      paragraphs: [
        'It is the number people call when something is wrong but nobody is in danger.',
        'New York City states the purpose plainly on its [contact page](https://www.nyc.gov/main/your-government/contact-nyc-government): contact 311 to get information about city government or to report problems that are not emergencies. The city says residents can reach it by phone, online or by text message, at any hour, with interpretation for most languages.',
        'Other cities run their own versions with different names, apps and rules. The idea is the same everywhere. A resident reports a problem, the city logs it with a type, a place and a date, and a crew or a department picks it up, sometimes within hours and sometimes after weeks of waiting in a queue. That log is the raw material for everything in this guide.',
      ],
    },
    {
      heading: 'Where can you see 311 requests, and what do the types point to?',
      paragraphs: [
        'Look on your city open data portal. Chicago lists a dataset called [311 Service Requests](https://data.cityofchicago.org/Service-Requests/311-Service-Requests/v6vf-nfxy), and Austin lists [Austin 311 Public Data](https://data.austintexas.gov/Utilities-and-City-Services/Austin-311-Public-Data/xwdj-i9he). Both are free to open and sort. Some cities publish only a map or an address lookup, which is fine for a quick look and useless for counting anything over time.',
        'Expect a type, a place, a date and a status on most rows. Type names differ from city to city, so learn the local list first. Read each row before you act, because the note under a type often says more than the type does. These pairings are common:',
      ],
      bullets: [
        'Fallen limbs and hazardous trees point to tree crews.',
        'Illegal dumping and bulky items point to junk haulers.',
        'Graffiti points to painters and pressure washing crews.',
        'Rodent and pest complaints point to pest control firms.',
        'Vacant or overgrown property points to lawn care and cleanout crews.',
        'Sidewalk and driveway damage points to concrete contractors.',
        'Water and sewer complaints point to plumbers, though the city usually fixes the main line itself.',
      ],
    },
    {
      heading: 'Is a 311 request really a lead?',
      paragraphs: [
        'Sometimes. Mostly no. A person who reports a pothole wants the city to fix it, and the city will. No private business gets that job.',
        'The value is in the pattern. Ten rodent complaints on three blocks tell a pest control firm where to knock or mail this month. A run of tree reports after a windy night tells a crew which neighborhoods to drive. A cluster of vacant property reports shows where owners may soon get a notice and need help.',
        'A single request is weak. A trend is useful. Count requests by type and by area over a few weeks, then compare to the weeks before. When a number jumps, spend your time there. When it stays flat, you have learned the area is quiet for that kind of work, which is also worth knowing.',
      ],
    },
    {
      heading: 'How do you use 311 data without crossing a line?',
      paragraphs: [
        'Do not chase the person who made the report. They asked the city for help, not you.',
        'Treat the data as a map. Write to property owners or neighbors in the area, not to the individual who called. Say what you noticed in general terms, such as many dumping reports on your street, and offer a clear service. Never imply that the city sent you.',
        'Keep in mind that a record can be wrong, closed already or a duplicate of another. Status columns help. If a request shows as closed, the problem may be fixed. Check the date and status before you spend a stamp.',
      ],
    },
  ],
  howHolerHelps:
    'Holler reads 311 requests from the cities that publish them, such as Chicago, New York City, San Francisco and Austin, and matches the types that fit a trade. You get a short alert with a link to the source record. Most cities are not connected yet. The [free checker](/check) shows what it would watch near you.',
  faq: [
    {
      q: 'What does the 311 line handle?',
      a: 'City information and problems that are not emergencies. New York City describes 311 as the place to report those problems, by phone, online or by text.',
    },
    {
      q: 'Are 311 requests public?',
      a: 'In many cities, yes. Chicago and Austin both list 311 datasets on their open data portals. Whether your city does depends on the city.',
    },
    {
      q: 'Is a 311 complaint a sales lead?',
      a: 'Rarely on its own. Most go to city crews. A cluster of the same complaint in one area is a better sign of demand for a private business.',
    },
  ],
  related: [
    { href: '/check', label: 'Check your area' },
    { href: '/for/junk-removal', label: 'Alerts for junk removal' },
    { href: '/local', label: 'City pages' },
  ],
  lastReviewed: '2026-11-17',
};
