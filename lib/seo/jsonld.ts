import { absoluteUrl } from './canonical';

type Json = Record<string, unknown>;

export interface Crumb {
  name: string;
  path: string;
}

export function placeLd(opts: { name: string; city: string; state: string; lat: number; lon: number; path: string }): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: opts.name,
    url: absoluteUrl(opts.path),
    geo: { '@type': 'GeoCoordinates', latitude: opts.lat, longitude: opts.lon },
    address: {
      '@type': 'PostalAddress',
      addressLocality: opts.city,
      addressRegion: opts.state,
      addressCountry: 'US',
    },
  };
}

export function faqLd(faq: { q: string; a: string }[]): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

export function breadcrumbLd(crumbs: Crumb[]): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: absoluteUrl(c.path),
    })),
  };
}

export function itemListLd(name: string, items: { name: string; url: string }[]): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      url: it.url,
    })),
  };
}

export { jsonLdString } from './serialize';
