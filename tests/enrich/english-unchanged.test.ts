// Reviewer probe 06 (r18 LOOKUP, criterion 8), kept as a regression test. Renders the digest email (html + text, en + es), the outreach plan
// and the card for records with a named contact and NO listing. The plan, card and contact-line hashes are still the reviewer's from the
// base 8bee203 (logs/REV-LOOKUP-english-unchanged.txt): with no listing those outputs are byte for byte what they were.
//
// The four `mail` hashes per language were rebaselined in round 23, when the alert digest itself was rebuilt (one address, one reason,
// one action per card). They still pin the digest: a later change to it has to be deliberate.
//
// Round 24 (CAN-SPAM, FIXLIST row 17): the eight `text=` hashes moved once more, because the plain-text part now carries the "You get this
// because ..." reason line the HTML part always had. Subject and html hashes are unchanged. Checked before rebaselining: removing that one
// line from each new text gives back exactly the round 23 text hash, in both languages.
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
  "en mail 0 subject=37e660a5de35f3b4 html=3fc3d6ab672fa0f1 text=d6c3d391f2fee0c5",
  "en plan 1 27e5a776cd16b65c",
  "en card 1 d86710a8fc20b54d",
  "en contact 1 {\"name\":\"Summit Roofing LLC\",\"role\":\"Named on this permit\"}",
  "en mail 1 subject=1cdf5b5143b43d59 html=5eb9aaaff66b3c8f text=d2ad176fc5aab73f",
  "en plan 2 c8756d4cff68cd50",
  "en card 2 b5ce4ac61b93724a",
  "en contact 2 {\"name\":\"Lakeview Bakery LLC\",\"role\":\"The business that opened\"}",
  "en mail 2 subject=5464508f82b48054 html=c2e5faa9ba0286e1 text=8814eba49acd16e6",
  "en plan 3 29d19a031d5f238f",
  "en card 3 4c6b583e2d014131",
  "en contact 3 {\"name\":\"Lone Star Paving Inc\",\"role\":\"The company that won this award\"}",
  "en mail 3 subject=f4976a7d7b4ea84c html=cea198b2e31eddb8 text=89735721f906caed",
  "es plan 0 585cc0b05a2f8d57",
  "es card 0 f95d6c28bdd70171",
  "es contact 0 {\"name\":\"Peachtree Roofing LLC\",\"role\":\"Aparece en este permiso\"}",
  "es mail 0 subject=6ed0010ba223ef93 html=1ab001b10325cb44 text=200bcfd90a18d0ee",
  "es plan 1 b77e724355a115aa",
  "es card 1 2047d05bc9b90f5b",
  "es contact 1 {\"name\":\"Summit Roofing LLC\",\"role\":\"Aparece en este permiso\"}",
  "es mail 1 subject=24fb969c65ecd82c html=ab07245116c5082d text=bbcd4104927b9ce8",
  "es plan 2 28738503e0458b41",
  "es card 2 577572deafc46525",
  "es contact 2 {\"name\":\"Lakeview Bakery LLC\",\"role\":\"El negocio que abri\u00f3\"}",
  "es mail 2 subject=d5ae902845dd1e48 html=f826411d03ba59b6 text=63d579643eea61ad",
  "es plan 3 320ec2e1b40f3ecf",
  "es card 3 05e38c6050d7e543",
  "es contact 3 {\"name\":\"Lone Star Paving Inc\",\"role\":\"La empresa que gan\u00f3 esta adjudicaci\u00f3n\"}",
  "es mail 3 subject=dfe59671e7bffa25 html=9e75116e2ba21ab0 text=79c0c424b9803d2e",
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
