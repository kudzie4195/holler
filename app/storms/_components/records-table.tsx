import { FamilyDot, linkClass } from '@/app/local/_components/ui';
import type { RecordType, StormRecord } from '@/lib/storms/report';

export const TABLE_CAP = 100;

const TYPE_LABEL: Record<RecordType, string> = { tornado: 'Tornado', hail: 'Hail', wind: 'Wind', declaration: 'FEMA declaration' };

export function RecordsTable({ records, dateLabel }: { records: StormRecord[]; dateLabel: string }) {
  const shown = records.slice(0, TABLE_CAP);
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
          <caption className="sr-only">Source records for {dateLabel}</caption>
          <thead>
            <tr className="border-t-2 border-b border-t-ink border-b-line font-mono text-xs uppercase tracking-[0.06em] text-muted">
              <th scope="col" className="py-2.5 pr-4 font-medium">Type</th>
              <th scope="col" className="py-2.5 pr-4 font-medium">Time</th>
              <th scope="col" className="py-2.5 pr-4 font-medium">Place</th>
              <th scope="col" className="py-2.5 pr-4 font-medium">Detail</th>
              <th scope="col" className="py-2.5 font-medium">Official source</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={`${r.at}-${r.type}-${i}`} className="border-b border-line align-top">
                <td className="py-2.5 pr-4 font-medium">
                  <span className="inline-flex items-center gap-2">
                    <FamilyDot family="weather" />
                    {TYPE_LABEL[r.type]}
                  </span>
                </td>
                <td className="py-2.5 pr-4 font-mono">
                  <time dateTime={r.at}>{r.timeLabel || 'Date only'}</time>
                </td>
                <td className="py-2.5 pr-4">{r.place}</td>
                <td className="py-2.5 pr-4">{r.detail ?? 'Not stated'}</td>
                <td className="py-2.5">
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noopener" className={linkClass}>
                      {r.source === 'fema' ? 'FEMA' : 'NOAA SPC'}
                    </a>
                  ) : (
                    <span className="text-muted">{r.source === 'fema' ? 'FEMA' : 'NOAA SPC'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {records.length > shown.length ? (
        <p className="mt-2 text-sm text-muted">
          Showing the first {shown.length} of {records.length} records. The counts above use all {records.length}.
        </p>
      ) : null}
    </div>
  );
}
