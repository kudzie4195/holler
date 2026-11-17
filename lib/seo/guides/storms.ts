import type { Guide } from './types';

export const storms: Guide = {
  slug: 'storm-damage-leads-from-weather-alerts-and-storm-reports',
  title: 'Storm damage leads from weather alerts and storm reports',
  metaTitle: 'Storm Damage Leads From Weather Alerts | Holler',
  description:
    'Three free public feeds point to storm damage: National Weather Service warnings, preliminary storm reports and FEMA declarations. Here is how to use each one.',
  directAnswer:
    'Storm leads start with three public feeds. The National Weather Service issues warnings while a storm is happening. The Storm Prediction Center lists preliminary reports of hail, wind and tornadoes afterward. FEMA declarations come later, after a governor asks for one. Use the first two to reach out the same day, in the ways the law allows.',
  sections: [
    {
      heading: 'What is the difference between a watch and a warning?',
      paragraphs: [
        'A watch means conditions could produce a storm. A warning means one is happening or about to.',
        'The National Weather Service puts it this way on its [watch, warning and advisory definitions](https://www.weather.gov/lwx/warningsdefined) page. A Severe Thunderstorm Watch is issued when severe thunderstorms are possible in and near the watch area. A Severe Thunderstorm Warning is issued when severe thunderstorms are occurring or imminent in the warning area.',
        'For a contractor the warning matters more. A watch tells you to get the truck ready. A warning tells you which towns are about to take a hit. Read the text of each warning for the place names and compare them with the towns you actually serve, because a warning for the next county over is not your job today. Neither one proves that anything was damaged. Damage comes from what the storm actually did on the ground, and that is what the reports below record.',
      ],
    },
    {
      heading: 'What counts as a severe storm?',
      paragraphs: [
        'The same NWS page gives two thresholds. A thunderstorm is severe if it produces winds of 58 mph or higher, hail of 1 inch or more in diameter, or both.',
        'Hail that size is often where roof and windshield damage starts. Smaller hail can still dent soft metal and strip leaves off a tree, but 1 inch is the line the weather service uses. Think of it as the point where roof inspections start to make sense. Wind at 58 mph or more tends to keep tree crews and fence builders busy.',
        'Tornadoes are separate. The same page says a Tornado Warning is issued when a tornado is imminent. Tornado damage is often narrow and heavy, so the jobs are fewer and larger: roofs, siding, structural repair and cleanup.',
      ],
    },
    {
      heading: 'Where do storm reports come from, and how fresh are they?',
      paragraphs: [
        'After the warning comes the report. The NWS describes a [Preliminary Local Storm Report](https://www.weather.gov/bgm/helpLocalStormReports) as a text product that relays information from spotters, officials, media and the public about specific weather events. Its forecast offices issue them.',
        'The NOAA Storm Prediction Center posts each day\'s reports of hail, wind and tornadoes on its [storm reports page](https://www.spc.noaa.gov/climo/reports/). The page labels every report preliminary, so a report may change. A report day runs from 1200 UTC to 1159 UTC the next day.',
        'You can also read alerts directly. The NWS says its [alerts API](https://www.weather.gov/documentation/services-web-api) is open data, free to use for any purpose, and that the alerts endpoint holds alerts issued over the past seven days. It also asks every client to send a User-Agent that identifies the application.',
      ],
    },
    {
      heading: 'Where does a FEMA declaration fit in?',
      paragraphs: [
        'It comes last, and only after a governor asks. FEMA publishes a dataset that it describes as a summarized list of all federally declared disasters, on its [OpenFEMA page](https://www.fema.gov/about/openfema/disaster-declarations-summaries).',
        'Under its [declaration process timelines](https://www.fema.gov/sites/default/files/documents/declaration-process-timelines.pdf) document, only a governor, or a tribal chief executive, can request one. There are two types, an emergency declaration and a major disaster declaration. A request for a major disaster is due within 30 days of the incident or of the end of the incident period, whichever is later.',
        'So a declaration is a slow signal that tells a restoration firm, an adjuster or a general contractor that recovery work will run for weeks or months in the named counties, while it tells a roofer very little that a hail report did not already say a month earlier.',
      ],
    },
    {
      heading: 'How do you turn a storm into booked jobs?',
      paragraphs: [
        'Watch the warnings for your service area, and when a storm passes, check the storm reports for hail and wind inside your drive time so you know which neighborhoods to visit first. Then act. Same day.',
        'Write to people who live where the report is. Do not claim damage you have not seen. Say that hail was reported near their street today and that you can look at the roof for free if they want. Keep it short. Offer a time. Hold the sales pitch until the owner answers.',
        'Be honest about what a report proves. It shows that something was seen near a spot, not that your customer has a leak. Ask before you assume. Door knockers who invent damage hurt every contractor in town, and homeowners remember them. A calm, specific note that names the storm and the street stands out.',
      ],
    },
    {
      heading: 'What rules apply when you contact people after a storm?',
      paragraphs: [
        'Some states restrict how contractors may solicit roof work after a storm. Florida is one example. Under [Florida Statute 489.147](https://www.flsenate.gov/Laws/Statutes/2025/489.147), a contractor may not offer a rebate, a gift or anything else of value in return for a roof inspection or for filing an insurance claim. The same section bars an advertisement that encourages a homeowner to contact a contractor about a roof-damage insurance claim unless it carries the required disclosures. Look up your own state before you send anything.',
        'Do Not Call and texting rules apply too. The FTC says in its [Do Not Call Q&A](https://www.ftc.gov/business-guidance/resources/qa-telemarketers-sellers-about-dnc-provisions-tsr-0) that it is against the law to call numbers on the National Do Not Call Registry unless an established business relationship or written agreement exists. Texts carry separate consent rules.',
        'This is general information, not legal advice. If you are unsure, ask a lawyer or your state licensing board.',
      ],
    },
  ],
  howHolerHelps:
    'Holler reads National Weather Service alerts every 15 minutes and NOAA storm reports every 30 minutes. When one lands near your service area and fits your trade, you get a short alert with the source link. It does not tell you who was damaged. The [free checker](/check) shows what it would watch near your ZIP code.',
  faq: [
    {
      q: 'What is a severe thunderstorm according to the National Weather Service?',
      a: 'A thunderstorm is severe when it produces winds of 58 mph or higher, hail of 1 inch or more in diameter, or both.',
    },
    {
      q: 'Are storm reports confirmed damage?',
      a: 'No. Storm Prediction Center reports are preliminary and can change. They show that something was seen, not that a specific home was hurt.',
    },
    {
      q: 'Who can ask for a FEMA disaster declaration?',
      a: 'Only a governor or a tribal chief executive can request one. A request for a major disaster is due within 30 days of the incident or the end of the incident period.',
    },
    {
      q: 'Can I contact homeowners after a storm?',
      a: 'Often yes, but the rules differ by state. Some states, such as Florida, restrict how contractors may solicit roof work after a storm, and Do Not Call and texting rules apply. This is general information, not legal advice.',
    },
  ],
  related: [
    { href: '/for/roofing', label: 'Storm alerts for roofers' },
    { href: '/check', label: 'Check your area' },
    { href: '/guides/how-to-respond-to-a-local-lead-fast', label: 'How to respond to a local lead fast' },
  ],
  lastReviewed: '2026-11-17',
};
