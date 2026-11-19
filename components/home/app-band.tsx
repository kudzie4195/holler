import { shortDay, type HomeMap, type MapRecord } from '@/lib/seo/home-map';
import { featuredRecord, phoneRecords, recordTag } from './select';
import { H2, TAG } from './styles';

function Mark({ size, stroke }: { size: number; stroke: string }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round">
      <circle cx="12" cy="12" r="2" />
      <path d="M8 8a5.7 5.7 0 0 0 0 8" />
      <path d="M16 8a5.7 5.7 0 0 1 0 8" />
    </svg>
  );
}

function FeedCard({ r, live }: { r: MapRecord; live: boolean }) {
  const { tag } = recordTag(r);
  const meta = [r.place, live && r.occurredAt ? shortDay(r.occurredAt) : null].filter(Boolean).join(' · ');
  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] border border-line bg-surface p-3.5">
      <span className={`self-start rounded-chip px-2 py-[3px] font-mono text-[12px] leading-4 ${TAG[r.family]}`}>{tag}</span>
      <span className="text-base font-semibold leading-tight">{r.title}</span>
      <span className="text-[13px] text-muted">
        {meta ? `${meta} · ` : ''}
        <b className="text-ink">{r.mi.toFixed(1)} mi</b>
      </span>
    </div>
  );
}

/**
 * The app band: the apps are coming soon, alerts come by email until then. The phone is a picture (role="img") built from the same
 * picked records as the map; the example set when there is no live data.
 */
export function AppBand({ map }: { map: HomeMap }) {
  const banner = featuredRecord(map);
  const cards = phoneRecords(map, banner);
  const where = map.city;
  return (
    <section aria-labelledby="app-h" className="on-brand overflow-hidden bg-brand">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-end gap-12 px-6 pt-24">
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-[18px] pb-24 max-[599px]:pb-0">
          <p className="eyebrow m-0 text-sm tracking-[0.08em]">THE APP · COMING SOON</p>
          <h2 id="app-h" className={H2}>
            A push when a record fits.
          </h2>
          <p className="m-0 max-w-[440px] text-lg text-on-brand-muted">
            At most one an hour, only for your trades and your radius. iPhone and Android apps are on the way. Until then, alerts come by email.
          </p>
        </div>
        <div className="flex min-w-0 flex-[1_1_340px] justify-center">
          <div
            role="img"
            aria-label={`Preview of the Holler app${map.live ? '' : ', with example records'}: a push saying New alert near ${where}, ${banner.title}, over the Alerts feed.`}
            className="box-border h-[500px] w-[320px] max-w-full rounded-t-[44px] bg-ink px-3 pt-3"
          >
            <div className="on-light flex h-full flex-col overflow-hidden rounded-t-[34px] bg-background text-ink">
              <div className="flex items-center justify-between px-[18px] pb-3 pt-[22px]">
                <span className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-chip bg-signal">
                  <Mark size={16} stroke="currentColor" />
                </span>
                <span className="text-base font-semibold">Alerts</span>
                <span className="text-sm font-medium text-brand-text">Refresh</span>
              </div>
              <div className="mx-3 mb-3 mt-1 flex gap-2.5 rounded-2xl border border-line bg-surface px-3.5 py-3 shadow-lift">
                <span className="inline-flex h-[30px] w-[30px] flex-none items-center justify-center rounded-chip bg-brand text-signal">
                  <Mark size={17} stroke="currentColor" />
                </span>
                <span className="flex min-w-0 flex-col gap-px">
                  <span className="text-sm font-semibold">New alert near {where}</span>
                  <span className="truncate text-[13px] text-muted">{banner.title}</span>
                </span>
              </div>
              <div className="flex flex-col gap-2.5 px-3">
                {cards.map((r) => (
                  <FeedCard key={r.id} r={r} live={map.live} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
