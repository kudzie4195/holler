// Reviewer probe 06 (r18 LOOKUP, criterion 8), kept as a regression test. Renders the digest email (html + text, en + es), the outreach plan
// and the card for records with a named contact and NO listing. The expected lines are the reviewer's hashes from the base 8bee203
// (logs/REV-LOOKUP-english-unchanged.txt): with no listing, every output is byte for byte what it was before this unit.
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('server-only', () => ({}));
import { emailContact, outreachPlan } from '@/lib/outreach/plan';
import { renderDigest } from '@/lib/email/templates';
import { WhoToContact } from '@/components/feed/who-to-contact';

const NOW = new Date('2026-11-22T12:00:00Z');
const BASE_8BEE203 = [
  "en plan 0 a962c071593ae8ce",
  "en card 0 7136039f67d7109f",
  "en contact 0 {\"name\":\"Peachtree Roofing LLC\",\"role\":\"Named on this permit\"}",
  "en mail 0 subject=d60ec2669ec98bf6 html=c2f00228413ca3a9 text=33b8e28ad4ddc275",
  "en plan 1 27e5a776cd16b65c",
  "en card 1 d86710a8fc20b54d",
  "en contact 1 {\"name\":\"Summit Roofing LLC\",\"role\":\"Named on this permit\"}",
  "en mail 1 subject=d60ec2669ec98bf6 html=1d39550e7425fb57 text=a4247c3700ed6f5c",
  "en plan 2 c8756d4cff68cd50",
  "en card 2 b5ce4ac61b93724a",
  "en contact 2 {\"name\":\"Lakeview Bakery LLC\",\"role\":\"The business that opened\"}",
  "en mail 2 subject=d60ec2669ec98bf6 html=130230a74c6162d9 text=d991998ba07e5654",
  "en plan 3 29d19a031d5f238f",
  "en card 3 4c6b583e2d014131",
  "en contact 3 {\"name\":\"Lone Star Paving Inc\",\"role\":\"The company that won this award\"}",
  "en mail 3 subject=d60ec2669ec98bf6 html=2c58fdcde9be9c86 text=39e0ba2657bc0756",
  "es plan 0 585cc0b05a2f8d57",
  "es card 0 f95d6c28bdd70171",
  "es contact 0 {\"name\":\"Peachtree Roofing LLC\",\"role\":\"Aparece en este permiso\"}",
  "es mail 0 subject=cf17105cb0765ef2 html=7c8ac7c31eed86bc text=c6f4cd2b361cf388",
  "es plan 1 b77e724355a115aa",
  "es card 1 2047d05bc9b90f5b",
  "es contact 1 {\"name\":\"Summit Roofing LLC\",\"role\":\"Aparece en este permiso\"}",
  "es mail 1 subject=cf17105cb0765ef2 html=36f30c554a4be641 text=3085cac5b62fb5fa",
  "es plan 2 28738503e0458b41",
  "es card 2 577572deafc46525",
  "es contact 2 {\"name\":\"Lakeview Bakery LLC\",\"role\":\"El negocio que abri\u00f3\"}",
  "es mail 2 subject=cf17105cb0765ef2 html=22e48ae2d199479f text=d2cd64907d058a8f",
  "es plan 3 320ec2e1b40f3ecf",
  "es card 3 05e38c6050d7e543",
  "es contact 3 {\"name\":\"Lone Star Paving Inc\",\"role\":\"La empresa que gan\u00f3 esta adjudicaci\u00f3n\"}",
  "es mail 3 subject=cf17105cb0765ef2 html=d617bc7e9f36565c text=d0381d25107484a2",
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
