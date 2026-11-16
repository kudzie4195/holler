'use client';

import { useEffect } from 'react';

// Replaces the root layout when it fails, so it brings its own html/body and uses the design tokens inline.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[holler] global error', error.digest ?? error.message);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: '#FBFAF7',
          color: '#16181D',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <main style={{ maxWidth: 448, padding: '64px 20px' }}>
          <h1 style={{ fontSize: 36, letterSpacing: '-0.02em', margin: 0 }}>Something went wrong on our side.</h1>
          <p style={{ fontSize: 18, color: '#5D6470', marginTop: 12 }}>
            Your account and data are fine. Try again, and if it keeps happening, check back in a few minutes.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 32,
              minHeight: 48,
              padding: '0 28px',
              borderRadius: 999,
              border: 0,
              background: '#E8590C',
              color: '#16181D',
              fontSize: 16,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
