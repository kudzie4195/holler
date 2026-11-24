import { FROM_MONTHLY, TRIAL_HEADLINE } from '@/lib/plan/price-copy';
import type { HomeMap } from '@/lib/seo/home-map';
import { RadiusMap } from './radius-map';
import { ZipForm } from './zip-form';

/** Hero on field green: headline, subhead, ZIP check, price line, radius map. The one h1 of the page. */
export function Hero({ lead, map }: { lead: string; map: HomeMap }) {
  return (
    <section id="top" className="on-brand bg-brand">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-14 px-6 pb-[72px] pt-12 max-[600px]:gap-10 max-[600px]:pb-14 max-[600px]:pt-7">
        <div className="flex min-w-0 flex-[1_1_460px] flex-col gap-6 max-[600px]:gap-5">
          {/* Owner decision (round 23): this wording, verbatim. The whitespace-nowrap spans only stop the line breaking mid phrase. */}
          <h1 className="m-0 font-display text-[clamp(52px,7.2vw,96px)] leading-[0.9] text-balance">
            See where <span className="whitespace-nowrap">the work is</span> <span className="whitespace-nowrap">near you</span>{' '}
            <span className="whitespace-nowrap">this week.</span>
          </h1>
          <p className="m-0 max-w-[540px] text-[clamp(1.0625rem,1.6vw,1.25rem)] leading-[1.55] text-on-brand-muted">{lead}</p>
          <ZipForm id="hero-zip" />
          {/* "/mo" keeps the line to one line on 360 to 375 px phones (design item 9): about 303 px at 15 px in a 312 px column. */}
          <p className="m-0 text-[0.9375rem] text-on-brand-muted">
            From {FROM_MONTHLY}/mo after {TRIAL_HEADLINE}. No card.
          </p>
        </div>
        <RadiusMap map={map} />
      </div>
    </section>
  );
}
