import type { Guide } from './types';

export const storms: Guide = {
  slug: 'storm-damage-leads-from-weather-alerts-and-storm-reports',
  title: 'Storm work from weather alerts and storm reports',
  metaTitle: 'Storm Work From Weather Alerts and Reports | Holler',
  description:
    'Free federal feeds show where a storm hit: NWS warnings, preliminary storm reports and FEMA declarations. The thresholds, timing and contact rules for each.',
  directAnswer:
    'Three free federal feeds point to storm work. National Weather Service warnings show where a storm is hitting now, and the Storm Prediction Center lists preliminary reports afterward. A storm counts as severe at 58 mph winds or 1 inch hail. Check the reports near you and reach out the same day, in the ways the law allows.',
  sections: [
    {
      heading: 'What is the difference between a watch and a warning?',
      paragraphs: [
        'A watch says a storm could form. A warning says it is here or about to be.',
        'The National Weather Service spells this out on its [warning definitions page](https://www.weather.gov/lwx/warningsdefined): a Severe Thunderstorm Watch is issued when severe thunderstorms are possible in and near the watch area, and a Severe Thunderstorm Warning when they are occurring or imminent in the warning area. A Tornado Warning is issued when a tornado is imminent.',
        'For a contractor the warning is the useful one, because it says the storm is already there. Compare the area in each warning with the towns you actually serve. Then get the truck ready. Neither product proves that anything was damaged. Damage shows up in what the storm did on the ground, which is what the reports in the next sections record.',
      ],
    },
    {
      heading: 'How big does hail or wind have to be to count as severe?',
      paragraphs: [
        'The same NWS page sets two lines. That is the whole test. A thunderstorm is severe if it produces winds of 58 mph or higher, or hail 1 inch in diameter or larger.',
        'The hail line has been the national standard since January 5, 2010, when an [NWS service change notice](https://www.weather.gov/media/notification/pdfs/scn09-52_1_inch_hail_oper.pdf) made 1 inch the minimum size for severe thunderstorm warnings. Smaller hail still shows up in local reports, so a report under 1 inch is not proof that nothing happened. Use the two numbers as a filter, not a verdict. Reports at or above them are where an inspection offer makes sense first. A tornado report is a different case. Drive the area before you write to anyone.',
      ],
    },
    {
      heading: 'Where do storm reports come from, and how fresh are they?',
      paragraphs: [
        'They start as a Preliminary Local Storm Report. The NWS describes it on its [storm report help page](https://www.weather.gov/bgm/helpLocalStormReports) as a text product built from information normally received from outside sources, such as weather spotters, local officials, media and the public.',
        'The NOAA Storm Prediction Center gathers each day\'s reports on its [today\'s storm reports page](https://www.spc.noaa.gov/climo/reports/today.html). The page labels every report preliminary. Expect changes. A report day runs from 1200 UTC to 1159 UTC the next day, which is 6 a.m. to 5:59 a.m. in Central Standard Time. Each report type has its own CSV file, so you can open the hail list on its own.',
        'Mind the cutoff, because it is easy to look at the wrong day. A report from 11 p.m. in the Central zone still sits on that day\'s page, since the report day runs until the next morning.',
      ],
    },
    {
      heading: 'How can you pull live alerts for your state yourself?',
      paragraphs: [
        'The NWS says its [web API](https://www.weather.gov/documentation/services-web-api) is open data, free to use for any purpose. Reading it for your own state takes four steps, and the first one needs nothing more than a browser.',
      ],
      ordered: true,
      bullets: [
        'Open api.weather.gov/alerts/active?area=KS in a browser, with your own two-letter state code in place of KS.',
        'If you script it, send a User-Agent that names your business, which the API requires.',
        'Keep the warning types that match your trade, such as Severe Thunderstorm Warning, and drop the rest.',
        'Remember the /alerts endpoint only reaches back seven days, so save what you need. Reload the active list while a storm runs, so you see warnings issued since you last looked.',
      ],
    },
    {
      heading: 'Where does a FEMA declaration fit in?',
      paragraphs: [
        'Last. In FEMA\'s [declaration process timelines](https://www.fema.gov/sites/default/files/documents/declaration-process-timelines.pdf), the request for an emergency or a major disaster declaration comes from a governor or a tribal chief executive. Each kind has its own clock. An emergency request should go in within 5 days after the need for help becomes apparent, and no later than 30 days after the incident. A major disaster request is due within 30 days of the incident or the end of the incident period, whichever is later.',
        'FEMA lists every declaration in its [Disaster Declarations Summaries](https://www.fema.gov/about/openfema/disaster-declarations-summaries) dataset, which it describes as covering all federally declared disasters.',
        'So a declaration arrives days or weeks after the hail. That is slow. It matters most to restoration firms, adjusters and general contractors planning months of recovery work in the named counties. A roofer learns little from it that the storm reports did not show first.',
      ],
    },
    {
      heading: 'What rules apply when you contact people after a storm?',
      paragraphs: [
        'Some states restrict how contractors may solicit roof work after a storm. Florida is one. Under [Florida Statute 489.147](https://www.flsenate.gov/Laws/Statutes/2026/489.147), a contractor may not offer a gift, cash, a deductible waiver or anything else of value in exchange for a roof inspection or an insurance claim, and an ad that steers a homeowner toward a roof insurance claim must carry set disclosures. The fine is up to $10,000 per violation, and what a paid employee does counts as the contractor\'s own act.',
        'Phone calls have federal rules too. The FTC\'s [Do Not Call Q&A](https://www.ftc.gov/business-guidance/resources/qa-telemarketers-sellers-about-dnc-provisions-tsr-0) says it is against the law to call a number on the national registry unless you have an established business relationship or written agreement. Text messages fall under separate rules that this guide does not cover.',
        'In a note, name the storm and the street. Never claim damage you have not seen, and offer one time to look. This is general information, not legal advice. Check your own state before you send anything.',
      ],
    },
  ],
  howHolerHelps:
    'Holler reads National Weather Service alerts every 15 minutes and NOAA storm reports every 30 minutes, and sends an alert with the source link when one lands near your service area. It cannot tell you whose roof was hit. The [free checker](/check) shows what it would watch near your ZIP code.',
  faq: [
    {
      q: 'What is a severe thunderstorm according to the National Weather Service?',
      a: 'One that produces winds of 58 mph or higher, hail 1 inch in diameter or larger, or both. The 1 inch hail line has been the national standard since January 5, 2010.',
    },
    {
      q: 'Are storm reports confirmed damage?',
      a: 'No. The Storm Prediction Center labels every report preliminary and reports can change, and a report shows only that someone saw severe weather near a spot, not that a particular home was damaged.',
    },
    {
      q: 'Who can ask for a FEMA disaster declaration?',
      a: 'In FEMA\'s process, a governor or a tribal chief executive submits the request for an emergency or major disaster declaration. A major disaster request is due within 30 days of the incident or the end of the incident period, whichever is later.',
    },
    {
      q: 'Can I contact homeowners after a storm?',
      a: 'Often, but the rules differ by state. Florida, for one, fines contractors up to $10,000 per violation of its roof solicitation law, and federal Do Not Call rules cover phone calls. This is general information, not legal advice.',
    },
  ],
  related: [
    { href: '/for/roofing', label: 'Storm alerts for roofers' },
    { href: '/check', label: 'Check your area' },
    { href: '/guides/how-to-respond-to-a-local-lead-fast', label: 'How to respond fast when local work comes up' },
  ],
  lastReviewed: '2026-11-17',
};
