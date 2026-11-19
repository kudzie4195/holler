import { shortDay, type HomeMap } from '@/lib/seo/home-map';
import { featuredRecord, recordTag } from './select';
import { COL, H2, MARK, TAG } from './styles';

/**
 * "Anatomy of an alert": one record from the picked set as an alert card, with the three numbered parts explained beside it.
 * Live: the record's date and a link to its public source. Example: marked "Example", no date, and a plain line in place of the
 * link. The number marks never wrap onto a row of their own: the text beside each one wraps inside its own box.
 */
export function Anatomy({ map, steps }: { map: HomeMap; steps: { title: string; body: string }[] }) {
  const r = featuredRecord(map);
  const { tag, note } = recordTag(r);
  const live = map.live && !!r.url;
  return (
    <section id="how" aria-labelledby="how-h" className="bg-background">
      <div className={`${COL} flex flex-col gap-11 pb-24 pt-[72px]`}>
        <h2 id="how-h" className={`${H2} max-w-[760px]`}>
          Short enough to read in the truck.
        </h2>
        <div className="flex flex-wrap items-center gap-10">
          <article className="flex min-w-0 flex-[1_1_460px] flex-col gap-4 rounded-card border border-line bg-surface p-8 shadow-lift max-[599px]:p-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`rounded-chip px-2.5 py-[5px] font-mono text-[0.8125rem] font-medium leading-5 ${TAG[r.family]}`}>{tag}</span>
              {live ? null : <span className="rounded-chip border border-line-strong px-2 py-1 font-mono text-[0.8125rem] leading-5 text-ink">EXAMPLE</span>}
              <span className="text-[0.9375rem] text-muted">{note}</span>
            </div>
            <div className="flex items-start gap-3">
              <h3 className="m-0 flex-auto text-[clamp(26px,2.8vw,34px)] font-semibold leading-[1.12]">{r.title}</h3>
              <span aria-hidden="true" className={MARK}>
                1
              </span>
            </div>
            <div className="flex items-center gap-3 text-[1.0625rem] text-muted">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-2">
                {r.place ? <span>{r.place}</span> : null}
                {live && r.occurredAt ? <time dateTime={r.occurredAt}>{shortDay(r.occurredAt)}</time> : null}
                <span className="font-semibold text-ink">{r.mi.toFixed(1)} mi away</span>
              </span>
              <span aria-hidden="true" className={MARK}>
                2
              </span>
            </div>
            <div className="flex items-center gap-3 border-t border-line pt-[18px]">
              <span className="min-w-0 flex-1">
                {live ? (
                  <a
                    href={r.url!}
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center rounded-control bg-brand px-[18px] py-3 text-base font-semibold text-on-brand transition-[background-color] duration-150 hover:bg-ink"
                  >
                    Open the source
                  </a>
                ) : (
                  <span className="inline-flex min-h-11 items-center font-mono text-[0.8125rem] uppercase text-muted">Each alert links to its source</span>
                )}
              </span>
              <span aria-hidden="true" className={MARK}>
                3
              </span>
            </div>
          </article>
          <ol className="m-0 flex min-w-0 flex-[1_1_320px] list-none flex-col gap-[26px] p-0">
            {steps.map((st, i) => (
              <li key={st.title} className="flex items-start gap-4">
                <span className={MARK}>{i + 1}</span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-xl font-semibold">{st.title}</span>
                  <span className="text-muted">{st.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
