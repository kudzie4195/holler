import { FROM_MONTHLY, TRIAL_DAYS_FREE } from '@/lib/plan/price-copy';
import type { HomeMap } from '@/lib/seo/home-map';
import { RadiusMap } from './radius-map';
import { ZipForm } from './zip-form';

/** Hero on field green: headline, subhead, ZIP check, price line, radius map. The one h1 of the page. */
export function Hero({ lead, map }: { lead: string; map: HomeMap }) {
  return (
    <section id="top" className="on-brand bg-brand">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-14 px-6 pb-[72px] pt-12 max-[599px]:gap-10 max-[599px]:pb-14 max-[599px]:pt-7">
        <div className="flex min-w-0 flex-[1_1_460px] flex-col gap-6 max-[599px]:gap-5">
          <h1 className="m-0 font-display text-[clamp(52px,7.2vw,96px)] leading-[0.9] text-balance">
            Records <span className="whitespace-nowrap">near you,</span> <span className="whitespace-nowrap">sorted for</span>{' '}
            <span className="whitespace-nowrap">your trade.</span>
          </h1>
          <p className="m-0 max-w-[540px] text-[clamp(17px,1.6vw,20px)] leading-[1.55] text-on-brand-muted">{lead}</p>
          <ZipForm id="hero-zip" />
          <p className="m-0 text-[15px] text-on-brand-muted">
            From {FROM_MONTHLY} a month after {TRIAL_DAYS_FREE}. No card.
          </p>
        </div>
        <RadiusMap map={map} />
      </div>
    </section>
  );
}
