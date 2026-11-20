import { Capacitor } from '@capacitor/core';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TouchEvent } from 'react';
import { linkTarget } from '../lib/links';
import { useApp } from '../state/AppContext';
import { tabOf, type TabName } from '../state/routes';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark';

export function Button({
  variant = 'primary',
  full,
  small,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; full?: boolean; small?: boolean }) {
  return <button type="button" className={`btn ${variant} ${full ? 'full' : ''} ${small ? 'small' : ''} ${className}`} {...rest} />;
}

export function Field({
  label,
  hint,
  error,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string | null; id: string }) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest} />
      {hint ? <span id={`${id}-hint`} className="hint">{hint}</span> : null}
      {error ? <span id={`${id}-err`} className="err">{error}</span> : null}
    </div>
  );
}

export function Notice({ tone = 'info', children, role }: { tone?: 'info' | 'success' | 'warn' | 'danger'; children: ReactNode; role?: string }) {
  return (
    <div className={`notice ${tone}`} role={role ?? (tone === 'danger' ? 'alert' : undefined)}>
      {children}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <span className="switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden="true" />
    </span>
  );
}

export function Mark({ size = 32 }: { size?: number }) {
  // The Holler mark, the same drawing as the website's public/icon.svg: a signal-lime tile with ink signal arcs (ink on signal 13.2:1).
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="6" fill="var(--signal)" />
      <g transform="translate(6.588 6.588) scale(0.7843)" stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round">
        <circle cx="12" cy="12" r="2" />
        <path d="M8 8a5.7 5.7 0 0 0 0 8M16 8a5.7 5.7 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" />
      </g>
    </svg>
  );
}

function Icon({ name }: { name: TabName | 'back' }) {
  const common = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (name === 'feed') return <svg {...common}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>;
  if (name === 'check') return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>;
  if (name === 'settings') return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
  return <svg {...common}><path d="m15 18-6-6 6-6" /></svg>;
}

export function Screen({
  title,
  children,
  tabs,
  end,
  back,
  brand,
}: {
  title: string;
  children: ReactNode;
  tabs?: boolean;
  end?: ReactNode;
  back?: boolean;
  /** Show the Holler mark in the start slot when there is no back button. */
  brand?: boolean;
}) {
  const app = useApp();
  const showBack = back ?? app.canGoBack;
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [title]);
  return (
    <div className={`app ${tabs ? 'with-tabs' : ''}`}>
      <header className="topbar">
        <div className="slot">
          {showBack ? (
            <button type="button" className="btn ghost small" onClick={app.back} aria-label="Back">
              <Icon name="back" />
              <span>Back</span>
            </button>
          ) : brand ? (
            <span className="topbar-mark">
              <Mark size={26} />
            </span>
          ) : null}
        </div>
        <h1>{title}</h1>
        <div className="slot end">{end}</div>
      </header>
      <div className="scroll" ref={scroller} data-scroller>
        <main className="content">{children}</main>
      </div>
      {tabs ? <TabBar /> : null}
    </div>
  );
}

export function TabBar() {
  const app = useApp();
  const current = tabOf(app.route);
  const tabs: Array<{ name: TabName; label: string }> = [
    { name: 'feed', label: 'Alerts' },
    { name: 'check', label: 'Area check' },
    { name: 'settings', label: 'Settings' },
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map((t) => (
        <button key={t.name} type="button" aria-current={current === t.name ? 'page' : undefined} onClick={() => app.navigate({ name: t.name }, { reset: true })}>
          <Icon name={t.name} />
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="stack" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="card">
          <div className="skeleton" style={{ height: 14, width: '40%' }} />
          <div className="skeleton" style={{ height: 18, width: '85%', marginTop: 12 }} />
          <div className="skeleton" style={{ height: 14, width: '60%', marginTop: 10 }} />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card stack" role="alert">
      <h3>That did not load</h3>
      <p className="muted">{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card stack">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

/** Pull down at the top of the list to refresh. A Refresh button does the same for anyone who cannot drag. */
export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [pulling, setPulling] = useState(false);
  const [busy, setBusy] = useState(false);
  const startY = useRef<number | null>(null);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };
  const handlers = {
    onTouchStart: (e: TouchEvent) => {
      const scroller = (e.currentTarget as HTMLElement).closest('[data-scroller]');
      startY.current = scroller && scroller.scrollTop <= 0 ? e.touches[0].clientY : null;
    },
    onTouchMove: (e: TouchEvent) => {
      if (startY.current === null) return;
      setPulling(e.touches[0].clientY - startY.current > 70);
    },
    onTouchEnd: () => {
      if (pulling) void run();
      setPulling(false);
      startY.current = null;
    },
  };
  return { handlers, pulling, busy, run };
}

/**
 * Open a link: https: pages in the in-app browser, the support mailto: in the mail app, and nothing
 * else (see lib/links.ts). Every caller passes a server-supplied value, so anything unexpected is ignored.
 */
export async function openInApp(url: string, opts: { supportMailto?: string | null } = {}): Promise<void> {
  const target = linkTarget(url, opts);
  if (!target) return;
  if (target.kind === 'mailto') {
    window.location.href = target.url;
    return;
  }
  try {
    if (Capacitor.isNativePlatform()) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url: target.url, presentationStyle: 'popover' });
      return;
    }
  } catch {
    /* fall through to a new tab */
  }
  window.open(target.url, '_blank', 'noopener');
}
