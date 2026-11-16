import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { siteUrl } from '@/lib/env';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
});

const description =
  'Holler watches public data and local posts, then sends a short alert when your town needs what you do. $5 a month after a 7-day free trial. No card to start.';

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
  themeColor: '#FBFAF7',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="bg-background text-ink antialiased">{children}</body>
    </html>
  );
}
