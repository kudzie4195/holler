import { absoluteUrl } from './canonical';
import { COMPANY } from '@/lib/legal/company';

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

/** The publisher node reused by articles and datasets. Not a site-wide schema: pages that need one reference it. */
export function organizationLd(): Json {
  return {
    '@type': 'Organization',
    name: 'Holler',
    url: absoluteUrl('/'),
  };
}

/** COMPANY's mailing address as a schema.org PostalAddress ("City, ST 12345" is split; anything else is left out, never guessed). */
function companyPostalAddress(): Json {
  const m = /^(.+), ([A-Z]{2}) (\d{5}(?:-\d{4})?)$/.exec(COMPANY.addressLines[1] ?? '');
  return {
    '@type': 'PostalAddress',
    streetAddress: COMPANY.addressLines[0],
    ...(m ? { addressLocality: m[1], addressRegion: m[2], postalCode: m[3] } : {}),
    addressCountry: 'US',
  };
}

/**
 * Site-wide Organization + WebSite graph, rendered once in app/layout.tsx. Built on organizationLd(); the legal name and mailing
 * address come from lib/legal/company.ts. No phone and no sameAs: Holler has neither yet, and none is invented.
 */
export function siteLd(): Json {
  const org = {
    ...organizationLd(),
    '@id': absoluteUrl('/#organization'),
    legalName: COMPANY.legalName,
    logo: absoluteUrl('/icon.svg'),
    address: companyPostalAddress(),
  };
  return {
    '@context': 'https://schema.org',
    '@graph': [
      org,
      {
        '@type': 'WebSite',
        '@id': absoluteUrl('/#website'),
        name: COMPANY.brand,
        url: absoluteUrl('/'),
        inLanguage: 'en-US',
        publisher: { '@id': absoluteUrl('/#organization') },
      },
    ],
  };
}

/** A guide. dateModified is the guide's own reviewed date (a constant in its data), never the render time. */
export function articleLd(opts: {
  headline: string;
  description: string;
  path: string;
  datePublished: string;
  dateModified: string;
}): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: opts.headline,
    description: opts.description,
    url: absoluteUrl(opts.path),
    mainEntityOfPage: absoluteUrl(opts.path),
    datePublished: opts.datePublished,
    dateModified: opts.dateModified,
    inLanguage: 'en-US',
    author: organizationLd(),
    publisher: organizationLd(),
  };
}

/** The numbers page. temporalCoverage is an ISO interval; dateModified is the newest record's time when known. */
export function datasetLd(opts: {
  name: string;
  description: string;
  path: string;
  temporalCoverage: string;
  dateModified: string;
  variables: string[];
}): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: opts.name,
    description: opts.description,
    url: absoluteUrl(opts.path),
    creator: organizationLd(),
    isAccessibleForFree: true,
    temporalCoverage: opts.temporalCoverage,
    dateModified: opts.dateModified,
    variableMeasured: opts.variables,
  };
}

export { jsonLdString } from './serialize';
