import { ZipForm } from './zip-form';

/** Closing band on green: the second ZIP check. */
export function ClosingBand() {
  return (
    <section id="check" aria-labelledby="check-h" className="on-brand bg-brand">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-x-12 gap-y-6 px-6 py-16">
        <h2 id="check-h" className="m-0 flex-[1_1_360px] font-display text-[clamp(40px,4.6vw,60px)] leading-[0.95] text-balance">
          See what happened near you.
        </h2>
        <div className="min-w-0 max-w-[520px] flex-[1_1_420px]">
          <ZipForm id="closing-zip" />
        </div>
      </div>
    </section>
  );
}
