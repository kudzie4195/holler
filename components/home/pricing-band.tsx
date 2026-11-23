import { Pricing } from '@/components/pricing';
import { TRIAL_PHRASE } from '@/lib/plan/price-copy';
import { COL, H2 } from './styles';

/**
 * Pricing on the home page: the headline beside the two short plan cards. Every figure comes from the plan files. The cards show yearly
 * prices, so the trial is stated in its precise form here, never the 2-month headline (owner rule: never next to a yearly price).
 */
export function PricingBand() {
  return (
    <section id="pricing" aria-labelledby="pricing-h" className="bg-background">
      <div className={`${COL} flex flex-wrap items-start gap-12 py-24`}>
        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-4">
          <h2 id="pricing-h" className={H2}>
            {TRIAL_PHRASE.charAt(0).toUpperCase() + TRIAL_PHRASE.slice(1)}. Then a flat monthly price.
          </h2>
          <p className="m-0 text-[1.0625rem] text-muted">No card to start. No per-lead fees. Cancel any{'\u00a0'}time.</p>
        </div>
        <div className="min-w-0 flex-[1_1_540px]">
          <Pricing variant="short" />
        </div>
      </div>
    </section>
  );
}
