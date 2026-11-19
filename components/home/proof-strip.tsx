import { PROOF_WINDOW_DAYS, type HomeProof } from '@/lib/seo/home-live';
import { shortDate } from '@/lib/seo/home-map';
import { COL } from './styles';

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * Three figures, read at render time: records in the last 7 days (the /data loader), city, county and weather feeds switched on
 * (lib/seo/home-live.ts feedCount), and one tap to the record. Not rendered without live data.
 */
export function ProofStrip({ proof }: { proof: HomeProof }) {
  const stats = [
    { n: fmt(proof.total7), label: `public records read in the last ${PROOF_WINDOW_DAYS} days` },
    { n: fmt(proof.feeds), label: 'city, county and weather feeds' },
    { n: '1 TAP', label: 'to the official record, on every alert' },
  ];
  return (
    <section aria-label="What Holler reads" className="bg-background">
      <div className={`${COL} flex flex-col gap-4 pb-6 pt-[72px]`}>
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] border-t-2 border-ink">
          {stats.map((st, i) => (
            <div
              key={st.label}
              className={`flex flex-col-reverse gap-1 border-b border-line py-6 max-[599px]:flex-row max-[599px]:items-baseline max-[599px]:gap-3.5 max-[599px]:py-4 ${i < stats.length - 1 ? 'pr-6' : ''}`}
            >
              <dt className="text-[15px] text-muted">{st.label}</dt>
              <dd className="m-0 font-display text-[clamp(56px,6vw,80px)] leading-[0.95] max-[599px]:min-w-[120px] max-[599px]:text-[44px]">{st.n}</dd>
            </div>
          ))}
        </dl>
        <p className="m-0 font-mono text-[13px] uppercase text-muted">
          From Holler&apos;s own records, <time dateTime={proof.asOf}>{shortDate(proof.asOf)}</time>
        </p>
      </div>
    </section>
  );
}
