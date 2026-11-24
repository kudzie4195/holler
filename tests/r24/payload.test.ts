// Round 24: two things every page carries besides its own body. The not-found boundary is sent in every page's payload, so its header
// has no sign-up button; /es/check sets its own card text, so no answer inherits the root layout's price line.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

import NotFound from '@/app/not-found';
import { generateMetadata as esCheckMeta } from '@/app/es/check/page';
import { generateMetadata as enCheckMeta } from '@/app/check/page';

describe('payload carried by every page', () => {
  it('the 404 tree has no link to /signup', () => {
    const html = renderToStaticMarkup(createElement(NotFound));
    expect(html).not.toContain('/signup');
    expect(html).toContain('href="/"');
  });
  it('/check and /es/check metadata name no price, for a waitlist answer too', async () => {
    for (const meta of [
      await esCheckMeta({ searchParams: Promise.resolve({ zip: '75201', trade: 'lawn-care' }) } as never),
      await enCheckMeta({ searchParams: Promise.resolve({ zip: '75201', trade: 'lawn-care' }) } as never),
    ]) {
      expect(meta.twitter).toBeTruthy();
      expect(JSON.stringify(meta)).not.toMatch(/\$7\.99|free trial|prueba gratis/i);
    }
  });
});
