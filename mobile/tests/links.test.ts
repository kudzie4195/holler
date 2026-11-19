// Review r6 P2: openInApp must never hand javascript: (or any non-https link) to the WebView.
import { describe, expect, it } from 'vitest';
import { linkTarget } from '../src/lib/links';

describe('linkTarget', () => {
  it('opens https pages only', () => {
    expect(linkTarget('https://localholler.com/terms')).toEqual({ kind: 'https', url: 'https://localholler.com/terms' });
    expect(linkTarget('https://apps.apple.com/account/subscriptions')?.kind).toBe('https');
  });
  it('ignores javascript:, data:, http:, tel:, intent: and custom schemes', () => {
    for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<script>1</script>', 'http://localholler.com', 'tel:+15555550100', 'intent://x#Intent;end', 'holler://alert/1', 'file:///etc/hosts', '//evil.example', '', '   ']) {
      expect(linkTarget(bad)).toBeNull();
    }
    expect(linkTarget(null)).toBeNull();
    expect(linkTarget(42)).toBeNull();
  });
  it('opens a mailto: only when it is the support address', () => {
    expect(linkTarget('mailto:help@localholler.com')).toBeNull();
    expect(linkTarget('mailto:help@localholler.com', { supportMailto: 'mailto:help@localholler.com' })).toEqual({ kind: 'mailto', url: 'mailto:help@localholler.com' });
    expect(linkTarget('mailto:other@evil.example', { supportMailto: 'mailto:help@localholler.com' })).toBeNull();
    expect(linkTarget('mailto:a@b.co?bcc=x@y.z', { supportMailto: 'mailto:a@b.co?bcc=x@y.z' })).toBeNull();
  });
});
