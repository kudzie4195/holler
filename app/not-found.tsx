import type { Metadata } from 'next';
import { ButtonLink } from '@/components/button';
import { Footer } from '@/components/footer';
import { BODY_TEXT, PAGE_BOX } from '@/components/grid';
import { TopNav } from '@/components/top-nav';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <>
      {/* Round 24: this tree is sent with every page's payload (the not-found boundary), so its header has no "Start free": a waitlist
          page must carry no sign-up link anywhere. The 404 offers home and the local pages instead. */}
      <TopNav showStart={false} />
      <main id="main" className={`on-brand flex w-full flex-1 flex-col justify-center bg-brand ${BODY_TEXT}`}>
        <div className={`${PAGE_BOX} py-16 md:py-24`}>
          <p className="eyebrow">Error 404 · Page not found</p>
          <h1 className="mt-4 max-w-[16ch] break-words text-5xl sm:text-6xl md:text-7xl">We can&apos;t find that page.</h1>
          <p className="mt-4 max-w-xl text-lg text-on-brand-muted">The link may be old or mistyped. Here are two places to start.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/" variant="signal" size="lg">
              Go home
            </ButtonLink>
            <ButtonLink href="/local" variant="outline-signal" size="lg">
              Browse local activity
            </ButtonLink>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
