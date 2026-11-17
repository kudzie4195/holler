/**
 * The /faq page. Plain text only, so the visible answer and the FAQPage JSON-LD answer are the same string.
 * Pricing and request facts follow the fixed contracts in the round 3 brief: change them there first, then here.
 */
export interface FaqGroup {
  id: string;
  title: string;
  items: { q: string; a: string }[];
}

export const FAQ_GROUPS: FaqGroup[] = [
  {
    id: 'what-holler-is',
    title: 'What Holler is',
    items: [
      {
        q: 'What is Holler?',
        a: 'Holler is an alert service for local businesses. It reads public data, such as weather alerts, storm reports, building permits and 311 requests. When something nearby fits what you do, it sends a short email with a link to the source, so you can check the record yourself and decide whether to reach out. You pick your trades and a service area. Holler does the watching.',
      },
      {
        q: 'Who is Holler for?',
        a: 'People who drive to the job. Roofers, plumbers, cleaners, movers, tree crews and sign makers each have a page that lists the records that matter to their trade, and you can open it before you sign up. You pick the trades and a service area. Holler watches. Solo owners and small crews are who it is built for.',
      },
      {
        q: 'Does Holler post or message people for me?',
        a: 'No. Holler never posts for you. It never touches your social accounts, so there is nothing for a platform to ban. It sends a message only when you write a reply to a resident request and press send, and that message goes to the resident who asked. Nothing else goes out under your name.',
      },
      {
        q: 'Is Holler an established company?',
        a: 'No. Holler is new. It has no customer numbers or reviews to show yet, and this site does not make any up. What it does have is a source link on every record, so you can check the work yourself before you pay anything. The trial needs no card. Judge it on the records.',
      },
    ],
  },
  {
    id: 'data-and-coverage',
    title: 'Data and coverage',
    items: [
      {
        q: 'Where does the data come from?',
        a: 'From official public sources. Those are National Weather Service alerts, NOAA Storm Prediction Center storm reports, FEMA disaster declarations, USGS earthquakes, FAA airport status, USAspending federal contract awards and the open data portals of cities. Each record links to the page it came from. We do not scrape sites that forbid it.',
      },
      {
        q: 'How often is the data checked?',
        a: 'It depends on the source. Weather alerts and airport status are checked every 15 minutes. Storm and earthquake reports are checked every 30 minutes. City records and federal contracts are checked a few times a day. Some cities publish permits a day or more after they are issued, so a record can arrive late, and Holler cannot fix a delay at the source.',
      },
      {
        q: 'Does Holler work in my town?',
        a: 'Probably in part. Weather, storm, disaster and federal contract records cover the whole country. Permits, 311 requests, inspections and business licenses come only from cities Holler has connected, such as Chicago, New York City, Austin and San Francisco. The free checker shows what Holler would watch around your ZIP code. Try it first.',
      },
      {
        q: 'How accurate are the alerts?',
        a: 'As accurate as the source, and no better. Storm reports are preliminary. City tables can lag or hold errors. A record shows that something happened, not that someone wants to hire you, so open the source link and check it before you act. Every alert says where it came from.',
      },
    ],
  },
  {
    id: 'pricing-and-trial',
    title: 'Pricing and trial',
    items: [
      {
        q: 'How much does Holler cost?',
        a: 'Starter is $5 a month or $48 a year. Pro is $9.99 a month or $96 a year. Both include alerts by email, the feed and replies to resident requests, and both start with a 7-day free trial that needs no card. There are no per-lead fees. Cancel any time.',
      },
      {
        q: 'What does the free trial include?',
        a: 'Seven days of alerts with Starter limits: one service area and up to five trades. No card is needed to start. When the trial ends without a subscription, your feed locks and your account stays put until you decide what to do with it, and we never charge you just because a trial ended.',
      },
      {
        q: 'What is the difference between Starter and Pro?',
        a: 'Pro covers more ground. Starter covers one service area and up to five trades. Pro covers up to three service areas and up to 15 trades, and it adds up to five keyword watches. Pick Pro if you work in more than one area or run several kinds of work. Otherwise Starter is enough.',
      },
      {
        q: 'Can I cancel any time?',
        a: 'Yes. Cancel from Settings whenever you like. You can also delete your account there, which removes your profile and your matches. Nothing locks you in. If you only want to stop paying, cancel and keep the account until you are ready to decide what to do with it.',
      },
    ],
  },
  {
    id: 'resident-requests',
    title: 'Resident requests and privacy',
    items: [
      {
        q: 'What is a resident request?',
        a: 'A short post from a person who needs a job done. They describe what they need at the request page and confirm by email. After that, a public page shows only the service and the city. Matching businesses get the description in their feed and email, with the phone numbers, emails, links and names we find taken out. It is a small feature on a new site. Do not expect a flood.',
      },
      {
        q: 'Does it cost anything to post a request?',
        a: 'No. Posting a request is free for residents, and you never pay to ask for help. Businesses on a trial or a paid plan get your request in their feed and email, and they can reply through Holler. Replying is part of both plans.',
      },
      {
        q: 'Will businesses see my email address?',
        a: 'Not unless you reply to that business. Businesses answer through Holler, so your address stays hidden from them and from every page. If you reply to a business by email, that business sees your address. You decide whether to answer. You can close the request whenever you like.',
      },
      {
        q: 'How long does a request stay open?',
        a: 'For 14 days. You can close it sooner, for example when you have already found someone. A public page shows the service and the city. The description goes only to matching businesses. After 14 days the request closes on its own, so an old request never keeps collecting replies.',
      },
    ],
  },
];

export const FAQ_ITEMS: { q: string; a: string }[] = FAQ_GROUPS.flatMap((g) => g.items);
