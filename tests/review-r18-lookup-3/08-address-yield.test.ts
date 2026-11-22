// Round 18 integration: review 3 probe (logs/REV3-LOOKUP-probe-tests) kept as a permanent regression test. Findings fixed at integration
// (P2-1 health line, P3-1 outage stop, P3-2/P3-3 closed listings, P3-5 address forms, P3-6 address before ambiguity, P3-7 tie order) now assert
// the fixed behaviour; every other assertion is the reviewer's as written.
import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { chooseListing, parseListingResult, parseStreet, resolvePlace, sameStreet } from '@/lib/enrich/business-lookup';
import { item, listingsBody } from '../enrich/helpers';
it('trial: ordinals, Saint, and the address before the ambiguity rule', () => {
  for (const [a, b] of [['100 5th St', '100 Fifth St'], ['100 E 53 St', '100 E 53rd St'], ['100 1st Ave', '100 First Ave'], ['100 St Charles Ave', '100 Saint Charles Ave'], ['100 W 111 St', '100 West 111th Street'], ['100 E 2 Ave', '100 E 2nd Ave'], ['100 3 AVENUE', '100 3rd Ave'], ['100 W 22 PL', '100 W 22nd Pl']]) expect(sameStreet(a, b), `${a} / ${b}`).toBe(true);
  for (const [a, b] of [['1200 Hwy 120', '1200 Hwy 20'], ['100 5th St', '100 15th St'], ['100 5th St', '100 5th Ave'], ['100 E 53 St', '100 E 54th St'], ['1200 Hwy 5', '1200 Hwy 5th'], ['100 E 5th St', '100 W Fifth St'], ['100 12 Hwy', '100 12th Hwy']]) expect(sameStreet(a, b), `${a} / ${b}`).toBe(false);
  // Round 18 integration: the commander's list adds highways written three ways and a unit with no unit word (see 03-address r4-r6, r16-r18).
  expect(parseStreet('1200 GA-120')).toEqual({ number: '1200', street: 'hwy 120' });
  for (const [a, b] of [['1200 Hwy 120', '1200 Highway 120'], ['1200 Hwy 120', '1200 GA-120'], ['1200 Highway 120', '1200 GA 120'], ['1200 SR 120', '1200 State Route 120'], ['100 Main St', '100 Main St 5'], ['3714 S HALSTED ST 1ST', '3714 S Halsted St'], ['200 W Addison St B', '200 W Addison St Unit B'], ['100 Peachtree St NE 400', '100 Peachtree St NE']]) expect(sameStreet(a, b), `${a} / ${b}`).toBe(true);
  for (const [a, b] of [['1200 GA-120', '1200 GA-20'], ['1200 US 41', '1200 Hwy 41'], ['1200 I-75', '1200 Hwy 75'], ['1234 County Road 12', '1234 County Road 14'], ['1234 FM 1960 Rd', '1234 FM 1961 Rd'], ['100 E Ave B', '100 E Ave C'], ['100 Hwy 92 N', '100 Hwy 92 S'], ['100 Main St 5', '100 Main Ave 5'], ['100 Main St NE 5', '100 Main St NW 5']]) expect(sameStreet(a, b), `${a} / ${b}`).toBe(false);
  expect(parseStreet('100 5 Points Plz')).toEqual({ number: '100', street: '5 points plz' });
  const place = resolvePlace('Chicago', 'IL', '60613', { strict: true, street: '200 W Addison St' })!;
  const at = (street: string, zip: string, phone: string) => item({ title: 'Lakeview Bakery', phone, url: null, domain: null, latitude: 41.9543, longitude: -87.6575, address: `${street}, Chicago, IL ${zip}` }, { address: street, city: 'Chicago', zip });
  const run = (list: unknown[]) => { const p = parseListingResult(listingsBody(list).tasks[0] as never); const r = chooseListing('Lakeview Bakery LLC', place, p.items, p.totalCount); return r.choice ? r.choice.listing.phone : r.reason; };
  expect(run([at('200 W Addison St', '60613', '+17735550201'), at('3100 N Broadway', '60657', '+17735550202')])).toBe('773-555-0201');
  expect(run([at('3100 N Broadway', '60657', '+17735550202')])).toBe('address_mismatch');
  expect(run([at('200 W Addison St Ste 1', '60613', '+17735550201'), at('200 W Addison St Ste 9', '60613', '+17735550202')])).toBe('ambiguous');
});
