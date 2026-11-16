import { Badge } from './badge';
import { Card } from './card';

/** Static, clearly labelled illustration of what an alert looks like. Not live data. */
export function ExampleAlerts() {
  return (
    <div role="group" aria-label="Example alerts, not live data" className="relative">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex items-center rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
          Example alerts
        </span>
        <span className="text-xs text-muted">Illustration, not live data</span>
      </div>
      <div className="flex flex-col gap-4">
        <Card className="!p-4 sm:!p-5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <Badge kind="report" />
            <span>National Weather Service</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-xs tabular-nums">4:12 pm</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-xs tabular-nums">6 mi away</span>
          </div>
          <p className="mt-3 text-lg font-semibold leading-snug text-ink">Quarter-size hail reported near Marietta, GA</p>
          <p className="mt-1 text-muted">Roofers, auto glass shops and tree crews nearby tend to get calls after a storm like this.</p>
          <div className="mt-4 flex flex-wrap gap-2" aria-hidden="true">
            <FakeButton>Open source</FakeButton>
            <FakeButton>Save</FakeButton>
            <FakeButton>Dismiss</FakeButton>
          </div>
        </Card>
        <Card className="!p-4 sm:!p-5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <Badge kind="ask" />
            <span>Public post</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-xs tabular-nums">18 min ago</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-xs tabular-nums">9 mi away</span>
          </div>
          <p className="mt-3 text-lg font-semibold leading-snug text-ink">Anyone recommend a plumber near Decatur?</p>
          <p className="mt-1 text-muted">Water heater quit this morning. Need someone who can come today.</p>
          <div className="mt-4 flex flex-wrap gap-2" aria-hidden="true">
            <span className="inline-flex min-h-9 items-center rounded-full bg-accent px-4 text-sm font-semibold text-ink">Draft reply</span>
            <FakeButton>Open source</FakeButton>
            <FakeButton>Done</FakeButton>
          </div>
        </Card>
      </div>
    </div>
  );
}

function FakeButton({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex min-h-9 items-center rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink">
      {children}
    </span>
  );
}
