import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/app/actions', () => ({ setMatchStatus: async () => ({ ok: true }), getRequestReplyStates: async () => ({}) }));

import { Feed, LockedFeed, type FeedItem } from '@/components/feed';

const base: FeedItem = {
  id: 1,
  status: 'new',
  kind: 'permit',
  source: 'socrata-chicago-permits',
  title: 'New roofing permit',
  summary: 'Re-roof.',
  url: 'https://example.com/p/1',
  distance: '2 mi away',
  place: 'Atlanta, GA',
  ago: '1 hr ago',
  occurredAt: '2026-11-17T12:00:00.000Z',
  draft: null,
  city: 'Atlanta',
  state: 'GA',
  county: 'Fulton County',
  zip: '30301',
  contacts: [
    { role: 'site', name: '', address: '12 Main St', city: 'Atlanta', state: 'GA', zip: '30301' },
    { role: 'contractor', name: 'Peachtree Roofing LLC', phone: '404-555-0100', email: 'jobs@peachtree.example', website: 'peachtree.example' },
  ],
};

const render = (items: FeedItem[]) => renderToStaticMarkup(createElement(Feed, { items, cityPage: null }));

describe('feed: Who to contact (unlocked)', () => {
  it('organisation block: name, role, details, actions, reminder, accessible disclosure', () => {
    const html = render([base]);
    expect(html).toContain('Who to contact');
    expect(html).toContain('<details');
    expect(html).toContain('<summary');
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('Peachtree Roofing LLC');
    expect(html).toContain('Named on this permit');
    expect(html).toContain('Phone: 404-555-0100');
    expect(html).toContain('Job site: 12 Main St, Atlanta, GA 30301');
    expect(html).not.toContain('Address: 12 Main St');
    expect(html).toContain('Search this business');
    expect(html).toContain('Open map');
    expect(html).toContain('Copy a first note');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('(opens in a new tab)');
    expect(html).toContain('Do Not Call');
  });

  it('touch targets: every action is at least 44px on touch (min-h-11)', () => {
    const html = render([base]);
    const actions = html.match(/<(a|button|summary)\b[^>]*class="[^"]*"/g) ?? [];
    const inBlock = actions.filter((a) => /Search|map|min-h-11/.test(a) || a.startsWith('<summary'));
    expect(inBlock.length).toBeGreaterThan(0);
    for (const a of actions.filter((x) => x.startsWith('<summary'))) expect(a).toContain('min-h-11');
    expect(html.match(/min-h-11/g)!.length).toBeGreaterThanOrEqual(5);
  });

  it('long names and addresses wrap', () => {
    const html = render([{ ...base, contacts: [{ role: 'contractor', name: 'A'.repeat(120) + ' Construction Company of Greater Atlanta', address: '1 ' + 'Long'.repeat(30) + ' Boulevard' }] }]);
    expect(html).toContain('break-words');
  });

  it('shows at most 3 contacts with "and N more"', () => {
    const contacts = ['A', 'B', 'C', 'D', 'E'].map((n) => ({ role: 'contractor' as const, name: `${n} Roofing` }));
    const html = render([{ ...base, contacts }]);
    expect(html).toContain('A Roofing');
    expect(html).toContain('C Roofing');
    expect(html).not.toContain('D Roofing');
    expect(html).toContain('and 2 more');
  });

  it('job-site block for a site-only permit', () => {
    const html = render([{ ...base, contacts: [base.contacts![0]] }]);
    expect(html).toContain('The job site');
    expect(html).not.toMatch(/county records|property records|Look up the owner/i);
    expect(html).toContain('Copy a letter');
    expect(html).not.toContain('Search this business');
  });

  it('area kit for a weather alert, with the storm guide', () => {
    const html = render([{ ...base, id: 2, kind: 'alert', source: 'nws', contacts: undefined }]);
    expect(html).toContain('Reach this area');
    expect(html).toContain('30301');
    expect(html).toContain('eddm.usps.com');
    expect(html).toContain('Copy a door hanger note');
    expect(html).toContain('/guides/storm-damage-leads-from-weather-alerts-and-storm-reports');
  });

  it('no block for a resident request, an airport delay or an event', () => {
    for (const [source, kind] of [['holler-request', 'ask'], ['faa', 'travel'], ['socrata-nyc-events', 'event']]) {
      const html = render([{ ...base, id: 3, source, kind, contacts: undefined }]);
      expect(html).not.toContain('Who to contact');
    }
  });

  it('a resident request keeps the Reply flow even if contacts were somehow passed', () => {
    const html = render([{ ...base, source: 'holler-request', kind: 'ask' }]);
    expect(html).toContain('>Reply<');
    expect(html).not.toContain('Peachtree');
  });
});

describe('feed: locked member', () => {
  it('locked view shows the heading and an upgrade prompt, and no contact data even if an item carried some', () => {
    const html = renderToStaticMarkup(createElement(LockedFeed, { items: [base, { ...base, id: 2, source: 'faa', kind: 'travel' }] } as never, createElement('p', null, 'pay')));
    expect(html).toContain('Who to contact');
    expect(html).toContain('Pick a plan to see who this record names');
    expect(html).not.toContain('Peachtree');
    expect(html).not.toContain('404-555-0100');
    expect(html).not.toContain('12 Main St');
    expect(html).not.toContain('jobs@peachtree');
    // the airport-delay card has no block, so only one heading
    expect(html.match(/Who to contact/g)).toHaveLength(1);
  });

  it('P2-6: a contractor with its own street address shows Address, not Job site', () => {
    const own: FeedItem = { ...base, contacts: [base.contacts![0], { ...base.contacts![1], address: '9 Oak Ave', city: 'Marietta', state: 'GA', zip: '30060' }] };
    const html = render([own]);
    expect(html).toContain('Address: 9 Oak Ave, Marietta, GA 30060');
    expect(html).not.toContain('Job site:');
  });
});
