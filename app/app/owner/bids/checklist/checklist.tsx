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

  const total = metros.reduce((n, m) => n + m.portals.length, 0);
  const done = metros.reduce((n, m) => n + m.portals.filter((p) => checked[`${p.state}:${p.government}`]).length, 0);

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
              return (
                <li key={id} className="flex items-start gap-3 px-4 py-3">
                  <input id={boxId} type="checkbox" className="mt-1 size-5" checked={!!checked[id]} onChange={(e) => toggle(id, e.target.checked)} />
                  <div className="min-w-0 flex-1">
                    <label htmlFor={boxId} className="font-semibold text-ink">
                      {p.government}, {p.state}
                    </label>
                    <span className="ml-2 text-xs text-muted">{p.family}</span>
                    <p className="truncate text-sm">
                      <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="text-ink underline underline-offset-2">
                        {p.url}
                      </a>
                    </p>
                    {p.flag ? <p className="mt-1 text-sm font-medium text-warn-ink">{p.flag}</p> : null}
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
