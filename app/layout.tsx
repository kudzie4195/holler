import type { Metadata, Viewport } from 'next';
import { Analytics } from '@/components/analytics';
import { siteUrl } from '@/lib/env';
import { FROM_MONTHLY } from '@/lib/plan/price-copy';
import { siteLd } from '@/lib/seo/jsonld';
import { jsonLdString } from '@/lib/seo/serialize';
import './globals.css';

const description =
  `Holler sends a short alert when public data, such as weather alerts, storm reports and city records, shows your town may need what you do. Plans from ${FROM_MONTHLY} a month.`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Holler: know when your town needs you',
    template: '%s | Holler',
  },
  description,
  applicationName: 'Holler',
  icons: { icon: '/icon.svg', apple: '/apple-touch-icon.png' },
  openGraph: {
    type: 'website',
    siteName: 'Holler',
    title: 'Holler: know when your town needs you',
    description,
    url: '/',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Holler: know when your town needs you' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Holler: know when your town needs you',
    description,
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#1E3A2C',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
