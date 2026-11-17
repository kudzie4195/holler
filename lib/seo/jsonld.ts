import { absoluteUrl } from './canonical';

type Json = Record<string, unknown>;

export interface Crumb {
  name: string;
  path: string;
}

export function placeLd(opts: { name: string; city: string; state: string; lat: number; lon: number; path: string; description?: string | null }): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: opts.name,
    ...(opts.description ? { description: opts.description } : {}),
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

/**
 * The page itself, with the time its counts were computed. dateModified is a CreativeWork property, so it lives on the WebPage and not on the Place.
 * `about` points at the city so the two nodes are tied together.
 */
export function webPageLd(opts: { name: string; path: string; dateModified: string; about: string; description?: string | null }): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: opts.name,
    url: absoluteUrl(opts.path),
    ...(opts.description ? { description: opts.description } : {}),
    dateModified: opts.dateModified,
    about: { '@type': 'Place', name: opts.about },
  };
}

/** A weekly page: a collection of the week's records for one city, with the records as an ItemList. */
export function collectionPageLd(opts: {
  name: string;
  path: string;
  dateModified: string;
  about: string;
  description?: string | null;
  items: { name: string; url: string }[];
}): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: opts.name,
    url: absoluteUrl(opts.path),
    ...(opts.description ? { description: opts.description } : {}),
    dateModified: opts.dateModified,
    about: { '@type': 'Place', name: opts.about },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: opts.items.length,
      itemListElement: opts.items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, url: it.url })),
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
