import type { Metadata, Viewport } from 'next';
import { Analytics } from '@/components/analytics';
import { siteUrl } from '@/lib/env';
import { FROM_MONTHLY } from '@/lib/plan/price-copy';
import { siteLd } from '@/lib/seo/jsonld';
import { jsonLdString } from '@/lib/seo/serialize';
import './globals.css';

const description =
  `Holler reads public data, such as building permits, code cases and storm reports, and shows you where the work is near you each week. Plans from ${FROM_MONTHLY} a month.`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Holler: see where the work is near you this week',
    template: '%s | Holler',
  },
  description,
  applicationName: 'Holler',
  icons: { icon: '/icon.svg', apple: '/apple-touch-icon.png' },
  openGraph: {
    type: 'website',
    siteName: 'Holler',
    title: 'Holler: see where the work is near you this week',
    description,
    url: '/',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Holler: see where the work is near you this week' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Holler: see where the work is near you this week',
    description,
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#1E3A2C',
  width: 'device-width',
  initialScale: 1,
};

/**
 * The display face (every h1, the wordmark) is preloaded so the headline does not paint in the fallback first and then swap.
 * The bundler emits this file once and gives the same hashed /_next/static/media URL that globals.css uses, so the preload is
 * never a second download. Inter and JetBrains Mono are not preloaded: body text in the matched fallback is fine for a moment.
 */
const BARLOW_700 = new URL('../node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2', import.meta.url).href;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* A plain link in head: ReactDOM.preload() here only reached the RSC payload, not the prerendered HTML head. */}
      <head>
        <link rel="preload" href={BARLOW_700} as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      {/* Fonts are self-hosted @font-face rules in globals.css (Barlow Condensed, Inter, JetBrains Mono). */}
      <body className="bg-background text-ink antialiased">
        {/* Organization + WebSite, once for the whole site (lib/seo/jsonld.ts siteLd). Static: no request data. */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(siteLd()) }} />
        <Analytics />
        {children}
      </body>
    </html>
  );
}
