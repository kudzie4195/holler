import { PROOF_WINDOW_DAYS, type HomeProof } from '@/lib/seo/home-live';
import { shortDate } from '@/lib/seo/home-map';
import { COL } from './styles';

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * Three figures: records dated in the last PROOF_WINDOW_DAYS days (the /data loader, counted by record date, read at render time),
 * city, county and weather feeds checked (lib/seo/home-live.ts feedCount: the switched-on adapters in the code, not a database
 * figure), and one tap to the public source. The caption names only the record count as Holler's own data. Not rendered without
 * live data. Under 768 px the strip is one column of rows: the label takes the free width and the number sits in a fixed 132 px
 * box at the right (a six-digit count at 44 px fits in it), so the three numbers share one left edge whatever the label length.
 */
export function ProofStrip({ proof }: { proof: HomeProof }) {
  const stats = [
    { n: fmt(proof.total7), label: `records dated in the last ${PROOF_WINDOW_DAYS}\u00a0days` },
    { n: fmt(proof.feeds), label: 'city, county and weather feeds checked' },
    { n: '1 TAP', label: 'to the public source, on every record alert' },
  ];
  return (
    <section aria-label="What Holler reads" className="bg-background">
      <div className={`${COL} flex flex-col gap-4 pb-6 pt-[72px]`}>
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] border-t-2 border-ink max-[767px]:grid-cols-1">
          {stats.map((st, i) => (
            <div
              key={st.label}
              className={`flex flex-col-reverse gap-1 border-b border-line py-6 max-[767px]:flex-row max-[767px]:items-baseline max-[767px]:gap-3.5 max-[767px]:py-4 ${i < stats.length - 1 ? 'pr-6 max-[767px]:pr-0' : ''}`}
            >
              <dt className="text-[0.9375rem] text-muted max-[767px]:min-w-0 max-[767px]:flex-1">{st.label}</dt>
              <dd className="m-0 font-display text-[clamp(56px,6vw,80px)] leading-[0.95] max-[767px]:min-w-[132px] max-[767px]:flex-none max-[767px]:text-[44px]">
                {st.n}
              </dd>
            </div>
          ))}
        </dl>
        <p className="m-0 font-mono text-[0.8125rem] uppercase text-muted">
          Record count from Holler&apos;s own data,{' '}
          <time dateTime={proof.asOf} className="whitespace-nowrap">
            {shortDate(proof.asOf)}
          </time>
        </p>
      </div>
    </section>
  );
}
