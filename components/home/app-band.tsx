import { PUSH_CAP } from '@/lib/seo/home-cadence';
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

/** Place, day and distance: the line under a card's title (no day for the example set). */
function cardMeta(r: MapRecord, live: boolean): string {
  return [r.place, live && r.occurredAt ? shortDay(r.occurredAt) : null, `${r.mi.toFixed(1)} mi`].filter(Boolean).join(' · ');
}

/**
 * One card in the phone's feed. The phone is a fixed 500 px picture, so its text stays in px (13 px at the smallest). The title is
 * clamped at two lines. With the spacing below, even three two-line titles end 24 px above the screen's bottom edge, so the crop
 * never cuts through a title, only through the third card's place line or below it. (One line, tried first, cut the useful end
 * off 311 titles: "311 request in Chicago: Tr...".)
 */
function FeedCard({ r, live }: { r: MapRecord; live: boolean }) {
  const { tag } = recordTag(r);
  const meta = cardMeta(r, live);
  const dist = `${r.mi.toFixed(1)} mi`;
  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] border border-line bg-surface p-3.5">
      <span className={`self-start rounded-chip px-2 py-[3px] font-mono text-[13px] leading-4 ${TAG[r.family]}`}>{tag}</span>
      <span className="line-clamp-2 text-base font-semibold leading-5">{r.title}</span>
      <span className="text-[13px] text-muted">
        {meta.slice(0, meta.length - dist.length)}
        <b className="text-ink">{dist}</b>
      </span>
    </div>
  );
}

/**
 * The app band: the apps are coming soon, alerts come by email until then. The phone is a picture (role="img") built from the same
 * picked records as the map; the example set when there is no live data, and then an EXAMPLE tag sits above the phone where a
 * sighted visitor sees it. The picture's label names the push and the three cards.
 */
export function AppBand({ map }: { map: HomeMap }) {
  const banner = featuredRecord(map);
  const cards = phoneRecords(map, banner);
  const where = map.city;
  const cardList = cards.map((r) => `${r.title}, ${cardMeta(r, map.live)}`).join('; ');
  const aria =
    `Preview of the Holler app${map.live ? '' : ', with example records'}: a push saying New alert near ${where}, ${banner.title}, ` +
    `over the Alerts feed${cardList ? ` with ${cardList}` : ''}.`;
  return (
    <section aria-labelledby="app-h" className="on-brand overflow-hidden bg-brand">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-end gap-12 px-6 pt-24">
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-[18px] pb-24 max-[983px]:pb-0">
          <p className="eyebrow m-0 text-sm tracking-[0.08em]">THE APP · COMING SOON</p>
          <h2 id="app-h" className={H2}>
            A push when a record fits.
          </h2>
          <p className="m-0 max-w-[440px] text-lg text-on-brand-muted">
            At most {PUSH_CAP}, only for your trades and your radius. iPhone and Android apps are on the way. Until then, alerts come by email.
          </p>
        </div>
        <div className="flex min-w-0 flex-[1_1_340px] flex-col items-center gap-3">
          {map.live ? null : (
            <span className="rounded-chip border border-on-brand-faint px-2 py-1 font-mono text-[0.8125rem] leading-5 text-on-brand">EXAMPLE</span>
          )}
          <div role="img" aria-label={aria} className="box-border h-[500px] w-[320px] max-w-full rounded-t-[44px] bg-ink px-3 pt-3">
            <div className="on-light flex h-full flex-col overflow-hidden rounded-t-[34px] bg-background text-ink">
              <div className="flex items-center justify-between px-[18px] pb-2.5 pt-[22px]">
                <span className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-chip bg-signal">
                  <Mark size={16} stroke="currentColor" />
                </span>
                <span className="text-base font-semibold">Alerts</span>
                <span className="text-sm font-medium text-brand-text">Refresh</span>
              </div>
              <div className="mx-3 mb-2.5 mt-1 flex gap-2.5 rounded-2xl border border-line bg-surface px-3.5 py-3 shadow-lift">
                <span className="inline-flex h-[30px] w-[30px] flex-none items-center justify-center rounded-chip bg-brand text-signal">
                  <Mark size={17} stroke="currentColor" />
                </span>
                <span className="flex min-w-0 flex-col gap-px">
                  <span className="text-sm font-semibold">New alert near {where}</span>
                  <span className="truncate text-[13px] text-muted">{banner.title}</span>
                </span>
              </div>
              <div className="flex flex-col gap-2 px-3">
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
