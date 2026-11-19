'use client';

import { useEffect } from 'react';

// Replaces the root layout when it fails, so it brings its own html/body and uses the design token values inline
// (globals.css may not have loaded). Field green band, signal button with ink text (13.2:1), signal focus ring (9.7:1 on brand).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[holler] global error', error.digest ?? error.message);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: '#1E3A2C',
          color: '#F5F4EF',
          fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif",
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <main style={{ maxWidth: 448, padding: '64px 20px' }}>
          <style>{'button:focus-visible{outline:3px solid #D9F046;outline-offset:3px}'}</style>
          <h1 style={{ fontSize: '3rem', lineHeight: 0.95, fontFamily: "'Barlow Condensed', 'Arial Narrow', 'Roboto Condensed', sans-serif", fontWeight: 700, textTransform: 'uppercase', margin: 0 }}>Something went wrong on our side.</h1>
          <p style={{ fontSize: '1.125rem', color: '#C9D6CD', marginTop: 16 }}>
            Your account and data are fine. Try again, and if it keeps happening, check back in a few minutes.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 32,
              minHeight: 48,
              padding: '0 28px',
              borderRadius: 10,
              border: 0,
              background: '#D9F046',
              color: '#14201A',
              fontSize: '1rem',
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
