'use client';

import { useMemo, useSyncExternalStore } from 'react';
import type { ManualMetro } from '@/lib/signals/manual-bids/portals';
import { checklistKey, parseChecked, readCheckedRaw, writeChecked } from '@/lib/signals/manual-bids/checklist-store';

/**
 * One box per government, "checked this week", kept in localStorage only (no server, no account). The key carries the Monday of the
 * week, so ticks start fresh each week. Storage that is blocked or full is ignored: the boxes then simply do not persist.
 */
// Same-tab writes notify through this set; other tabs through the storage event.
const listeners = new Set<() => void>();
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}
const snapshot = () => readCheckedRaw(checklistKey(new Date())) ?? '';
const serverSnapshot = () => null;

export function Checklist({ metros }: { metros: readonly ManualMetro[] }) {
  // null on the server and in the first client paint (no storage there), then this week's stored ticks.
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const checked = useMemo(() => parseChecked(raw), [raw]);

  function toggle(id: string, on: boolean) {
    writeChecked(checklistKey(new Date()), { ...checked, [id]: on });
    for (const l of listeners) l();
  }

  const checkable = metros.flatMap((m) => m.portals).filter((p) => p.status === 'enter' || p.status === 'terms');
  const total = checkable.length;
  const done = checkable.filter((p) => checked[`${p.state}:${p.government}`]).length;

  return (
    <div className="mt-6">
      <p className="text-sm text-muted" aria-live="polite">
        {done} of {total} checked this week.
      </p>
      {metros.map((m) => (
        <section key={m.metro} className="mt-6">
          <h2 className="font-display text-xl font-semibold text-ink">{m.metro}</h2>
          <ul className="mt-2 flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
            {m.portals.map((p) => {
              const id = `${p.state}:${p.government}`;
              const boxId = `chk-${id.replace(/[^a-z0-9]+/gi, '-')}`;
              // Only a page the owner may look at gets a box: outside the served area and wrong-URL rows are information only.
              const checkable = p.status === 'enter' || p.status === 'terms';
              const tone = p.status === 'enter' ? 'text-muted' : 'font-medium text-warn-ink';
              return (
                <li key={id} className="flex items-start gap-3 px-4 py-3">
                  {checkable ? (
                    <input id={boxId} type="checkbox" className="mt-1 size-5" checked={!!checked[id]} onChange={(e) => toggle(id, e.target.checked)} />
                  ) : (
                    <span aria-hidden="true" className="mt-1 inline-block size-5" />
                  )}
                  <div className="min-w-0 flex-1">
                    {checkable ? (
                      <label htmlFor={boxId} className="font-semibold text-ink">
                        {p.government}, {p.state}
                      </label>
                    ) : (
                      <span className="font-semibold text-muted">
                        {p.government}, {p.state}
                      </span>
                    )}
                    <span className="ml-2 text-xs text-muted">
                      {p.family}, ZIP {p.zip}
                    </span>
                    {p.url && p.status !== 'bad_url' ? (
                      <p className="truncate text-sm">
                        <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="text-ink underline underline-offset-2">
                          {p.url}
                        </a>
                      </p>
                    ) : null}
                    {p.note ? <p className={`mt-1 text-sm ${tone}`}>{p.note}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
