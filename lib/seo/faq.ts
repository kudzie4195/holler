import { TIER_NAMES, type Tier } from '@/lib/plan/limits';
import { priceLabel } from '@/lib/stripe/plans';
import { TRIAL_DAYS, TRIAL_PHRASE } from '@/lib/plan/price-copy';
import { faqAskCopy, type Has } from './public-copy';

/**
 * The /faq page. Plain text only, so the visible answer and the FAQPage JSON-LD answer are the same string.
 * Pricing and request facts follow the fixed contracts in the round 3 brief and the wording on /pricing (lib/plan/pricing-page.ts)
 * and /request (app/request/page.tsx): change them there first, then here.
 */
// Prices and plan names come from lib/stripe/plans.ts and lib/plan/limits.ts (pure modules), never typed here.
const SOLO = TIER_NAMES.starter;
const PRO = TIER_NAMES.pro;
const m = (t: Tier) => priceLabel(t, 'monthly');
const y = (t: Tier) => priceLabel(t, 'annual');

export interface FaqGroup {
  id: string;
  title: string;
  items: { q: string; a: string }[];
}

/**
 * The groups for the keys that are set. Two answers gain one sentence each when a key for public posts is set (faqAskCopy in
 * lib/seo/public-copy.ts, which holds every key-gated sentence); with no optional key the text is exactly the fixed copy below.
 * `has` is for tests; production code never passes it.
 */
export function faqGroups(has?: Has): FaqGroup[] {
  const ask = faqAskCopy(has);
  return [
    {
      id: 'what-holler-is',
      title: 'What Holler is',
      items: [
        {
          q: 'What is Holler?',
          a: 'An alert service that reads public records, such as weather warnings and building permits, and emails a local business when one near it fits its trade. Each alert links to the public source it came from, so you can check it yourself and decide whether it is worth reaching out about at all. You pick the trades and the area. Holler does the daily reading.',
        },
        {
          q: 'Who is Holler for?',
          a: 'Owners and small crews who drive to the job: roofers and plumbers through to cleaners and sign makers. Each trade has its own public page that lists the kinds of records that matter to it, and you can read that page before you sign up or give anyone an email address. It suits the one-truck shop.',
        },
        {
          q: 'Does Holler post or message people for me?',
          a: `Only when you write a reply to a resident request and press send, and then the message goes to that one resident and nobody else. Holler never posts anywhere for you and never touches your social accounts, so there is nothing for a platform to flag or ban.${ask.drafts ? ` ${ask.drafts}` : ''} Nothing else goes out.`,
        },
        {
          q: 'Is Holler an established company?',
          a: 'Not yet. Holler is new, it has no customer numbers or reviews to show, and this site does not invent any to look bigger than it is. What it can show is the source behind every record, so you can judge the work before you pay anything, during a trial that needs no card. Judge it on the records.',
        },
      ],
    },
    {
      id: 'data-and-coverage',
      title: 'Data and coverage',
      items: [
        {
          q: 'Where does the data come from?',
          a: `From official public sources: National Weather Service alerts, NOAA Storm Prediction Center storm reports, FEMA disaster declarations, USGS earthquakes, FAA airport status, USAspending federal contract awards and the open data portals of cities. Each record links to the page it came from, so you can always open the original and see exactly what the agency published. ${ask.sources ?? 'Nothing is bought.'}`,
        },
        {
          q: 'How often is the data checked?',
          a: 'Every 15 minutes for weather alerts and airport status, every 30 minutes for storm reports and earthquakes, and a few times a day for city records and federal contracts. Cities publish on their own schedules, though, so a record can reach Holler days after the event it describes, and no checking schedule can fix a delay that starts at the source. Some feeds lag.',
        },
        {
          q: 'Does Holler work in my town?',
          a: 'In part, wherever you are in the US, because national records such as weather warnings and federal contracts cover the whole country. Permits, 311 requests, inspections and business licenses come only from cities Holler has connected, such as Chicago, New York City, Austin and San Francisco, and the free checker shows what it would watch around your ZIP code before you sign up. Try it first.',
        },
        {
          q: 'How accurate are the alerts?',
          a: 'As accurate as the source, and no better. Storm reports are preliminary, city tables can lag behind the counter or hold typing errors, and a record shows only that something happened near a place, not that someone there wants to hire you. Open the source link and check it before you act on any alert. Always.',
        },
      ],
    },
    {
      id: 'pricing-and-trial',
      title: 'Pricing and trial',
      items: [
        {
          q: 'How much does Holler cost?',
          a: `${SOLO} is ${m('starter')} a month or ${y('starter')} a year, and ${PRO} is ${m('pro')} a month or ${y('pro')} a year. Both plans include alerts by email, the feed and replies to resident requests. Both start with a ${TRIAL_PHRASE} that needs no card, and there are no fees per alert and no contract after it. Cancel any time.`,
        },
        {
          q: 'What does the free trial include?',
          a: `${TRIAL_DAYS} days of alerts on ${SOLO} limits, which means one service area and up to five trades. No card is needed to start. When the trial ends without a subscription, your feed locks and your account stays as it is. You are never charged just because a trial ended or because you forgot to cancel something. Nothing is billed.`,
        },
        {
          q: `What is the difference between ${SOLO} and ${PRO}?`,
          a: `Coverage. ${SOLO} watches one service area and up to five trades, while ${PRO} watches three service areas and up to 15 trades. ${PRO} also adds up to five keyword watches. Each one sends you any record in your areas whose title or summary has a phrase you pick, even when it falls outside your trades. Pick ${PRO} if you work in several ZIP codes.`,
        },
        {
          q: 'Can I cancel any time?',
          a: 'Yes, in Settings under Manage billing, where cancelling stops the next charge and your plan stays on until the end of the period you already paid for. Settings also lets you delete your account, which removes your Holler profile along with your alerts and billing in one step if you decide the service is not for you. Nothing locks you in.',
        },
      ],
    },
    {
      id: 'resident-requests',
      title: 'Resident requests and privacy',
      items: [
        {
          q: 'What is a resident request?',
          a: 'A short post from someone who needs a job done, which they describe on the request page and confirm by email. After that, a public page shows only the service and the city. Matching businesses get the description in their feed and email, after a filter removes phone numbers, emails, links, street addresses and names that it finds. It is a small, new feature.',
        },
        {
          q: 'Does it cost anything to post a request?',
          a: 'Nothing at all, because posting is free for residents and businesses pay for Holler. Businesses on a trial or a paid plan get matching requests in their feed and email, and up to five of them can reply through Holler to one request, so you will not be flooded with messages from strangers. Some areas have no replies yet.',
        },
        {
          q: 'Will businesses see my email address?',
          a: 'Not unless you reply to that business. Businesses answer through Holler, so your address stays hidden from them and from every page on the site. If you reply to a business by email, that business sees your address and what you wrote back, and nothing else about you or your request history. You decide whether to answer.',
        },
        {
          q: 'How long does a request stay open?',
          a: 'For 14 days, unless you close it sooner with the link in your email, for example once you have already found someone for the job. Then it closes on its own. A closed request leaves Holler\'s pages within about 15 minutes. While it is open, a public page shows the service and the city, and the description goes only to matching businesses that work in your area.',
        },
      ],
    },
  ];
}

export function faqItems(has?: Has): { q: string; a: string }[] {
  return faqGroups(has).flatMap((g) => g.items);
}

/** What /faq renders and its FAQPage JSON-LD uses: the groups for the keys set in this environment. */
export const FAQ_GROUPS: FaqGroup[] = faqGroups();
export const FAQ_ITEMS: { q: string; a: string }[] = faqItems();
