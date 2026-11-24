// Reviewer probe 06 (r18 LOOKUP, criterion 8), kept as a regression test. Renders the digest email (html + text, en + es), the outreach plan
// and the card for records with a named contact and NO listing. The plan, card and contact-line hashes are still the reviewer's from the
// base 8bee203 (logs/REV-LOOKUP-english-unchanged.txt): with no listing those outputs are byte for byte what they were.
//
// The four `mail` hashes per language were rebaselined in round 23, when the alert digest itself was rebuilt (one address, one reason,
// one action per card). They still pin the digest: a later change to it has to be deliberate.
//
// Round 24 FIXMAIL: the eight mail lines moved once more, by design (gates/r24/FIXMAIL-report.md, "Baselines"): the subject says "in" a
// city, not "at" (review P2-7); a permit with no address and a business or award card open their own card instead of the door hanger
// (P1-1); the business and award cards carry their own uncertainty line again and the closing line has one sentence per kind present
// (P1-4); the cards are a role="list" with the button padding on the cell and the dark-mode hooks (P2-6, P2-9). Every plan, card and
// contact line is unchanged. Before/after texts: gates/r24/out/fixmail/eu-mails-{base,head}.json.
// Round 24 (CAN-SPAM, FIXLIST row 17): the eight `text=` hashes moved once more, because the plain-text part now carries the "You get this
// because ..." reason line the HTML part always had. Subject and html hashes are unchanged. Checked before rebaselining: removing that one
// line from each new text gives back exactly the round 23 text hash, in both languages.
// Round 24 INT2 (copy pass): six mail lines moved (html and text only; every subject, plan, card and contact line is unchanged). Checked
// on the rendered text before rebaselining: the button reads "See all your matches" instead of "Open your feed" (EN, all four), and the
// closing permit sentence says "A permit does not tell you whether the owner has hired anyone." / "Un permiso no dice si el dueño ya
// contrató a alguien." (EN and ES, mails 0 and 1). Nothing else differs (gates/r24/INT2-report.md, "Baselines").
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('server-only', () => ({}));
import { emailContact, outreachPlan } from '@/lib/outreach/plan';
import { renderDigest } from '@/lib/email/templates';
import { WhoToContact } from '@/components/feed/who-to-contact';

const NOW = new Date('2026-11-22T12:00:00Z');
const BASE_8BEE203 = [ // mail lines: round 23 baseline; every other line is the 8bee203 one
  "en plan 0 a962c071593ae8ce",
  "en card 0 7136039f67d7109f",
  "en contact 0 {\"name\":\"Peachtree Roofing LLC\",\"role\":\"Named on this permit\"}",
  "en mail 0 subject=04ad7ff5bbcecca5 html=cb1b9ffe18c81dba text=c1d2d0cc88eb563e",
  "en plan 1 27e5a776cd16b65c",
  "en card 1 d86710a8fc20b54d",
  "en contact 1 {\"name\":\"Summit Roofing LLC\",\"role\":\"Named on this permit\"}",
  "en mail 1 subject=0ab9ba1e07bc95fc html=6e11322bf82bd929 text=c44d524d9b491b3e",
  "en plan 2 c8756d4cff68cd50",
  "en card 2 b5ce4ac61b93724a",
  "en contact 2 {\"name\":\"Lakeview Bakery LLC\",\"role\":\"The business that opened\"}",
  "en mail 2 subject=02c2f1e2de8249db html=d76bcb4fbba5c013 text=6b07fff17985ca54",
  "en plan 3 29d19a031d5f238f",
  "en card 3 4c6b583e2d014131",
  "en contact 3 {\"name\":\"Lone Star Paving Inc\",\"role\":\"The company that won this award\"}",
  "en mail 3 subject=290493337e37fe95 html=ebf61fefcc0af8db text=638e0c1f5896b58b",
  "es plan 0 585cc0b05a2f8d57",
  "es card 0 f95d6c28bdd70171",
  "es contact 0 {\"name\":\"Peachtree Roofing LLC\",\"role\":\"Aparece en este permiso\"}",
  "es mail 0 subject=6ed0010ba223ef93 html=5688f1397c68459d text=ca87c2245e385854",
  "es plan 1 b77e724355a115aa",
  "es card 1 2047d05bc9b90f5b",
  "es contact 1 {\"name\":\"Summit Roofing LLC\",\"role\":\"Aparece en este permiso\"}",
  "es mail 1 subject=24fb969c65ecd82c html=57adcb3bba556c49 text=664ec91e136d7866",
  "es plan 2 28738503e0458b41",
  "es card 2 577572deafc46525",
  "es contact 2 {\"name\":\"Lakeview Bakery LLC\",\"role\":\"El negocio que abri\u00f3\"}",
  "es mail 2 subject=d5ae902845dd1e48 html=d47eafbf309f3f84 text=76810a62fcd6c097",
  "es plan 3 320ec2e1b40f3ecf",
  "es card 3 05e38c6050d7e543",
  "es contact 3 {\"name\":\"Lone Star Paving Inc\",\"role\":\"La empresa que gan\u00f3 esta adjudicaci\u00f3n\"}",
  "es mail 3 subject=dfe59671e7bffa25 html=84ccdca330cd14ce text=cecb7e471c5aacaa",
];

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
it('no listing: card, plan, contact line and email are identical to the base 8bee203', () => {
  const lines: string[] = [];
  const records = [
    { signal: { source: 'socrata-atlanta-permits', kind: 'permit', city: 'Atlanta', state: 'GA' }, contacts: [{ role: 'contractor' as const, name: 'Peachtree Roofing LLC' }, { role: 'site' as const, name: '', address: '100 MAIN ST', city: 'Atlanta', state: 'GA' }] },
    { signal: { source: 'socrata-chicago-permits', kind: 'permit', city: 'Chicago', state: 'IL' }, contacts: [{ role: 'contractor' as const, name: 'Summit Roofing LLC', phone: '312-555-0100', license: 'TGC123456' }] },
    { signal: { source: 'socrata-chicago-business', kind: 'business_license', city: 'Chicago', state: 'IL' }, contacts: [{ role: 'business' as const, name: 'Lakeview Bakery LLC', address: '200 W ADDISON ST', city: 'Chicago', state: 'IL', zip: '60613' }] },
    { signal: { source: 'usaspending', kind: 'award', city: 'Austin', state: 'TX' }, contacts: [{ role: 'awardee' as const, name: 'Lone Star Paving Inc' }] },
  ];
  for (const lang of ['en', 'es'] as const) {
    for (const [i, r] of records.entries()) {
      const plan = outreachPlan(r.signal, r.contacts, lang);
      const planNoListing = JSON.parse(JSON.stringify(plan, (k, v) => (k === 'listing' ? undefined : v)));
      lines.push(`${lang} plan ${i} ${sha(JSON.stringify(planNoListing))}`);
      lines.push(`${lang} card ${i} ${sha(renderToStaticMarkup(createElement(WhoToContact, { item: r.signal, contacts: r.contacts, lang })))}`);
      const contact = emailContact(r.signal, r.contacts, lang);
      lines.push(`${lang} contact ${i} ${JSON.stringify(contact)}`);
      const mail = renderDigest({ businessName: 'Acme', items: [{ kind: r.signal.kind, source: r.signal.source, title: 'Record', place: `${r.signal.city}, ${r.signal.state}`, occurredAt: NOW.toISOString(), contact }], appUrl: 'https://x.test/app', unsubscribeUrl: 'https://x.test/u', now: NOW, lang });
      lines.push(`${lang} mail ${i} subject=${sha(mail.subject)} html=${sha(mail.html)} text=${sha(mail.text)}`);
    }
  }
  expect(lines).toEqual(BASE_8BEE203);
});
