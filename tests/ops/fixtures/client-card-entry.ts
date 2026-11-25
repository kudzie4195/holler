/**
 * Round 34 switch audit: the entry tests/ops/client-switches.test.ts bundles FOR THE BROWSER (rolldown, platform browser, Next's `env`
 * replacements from next.config.ts, no runtime environment): the feed card and the label code it calls, exactly as the client chunk has them.
 */
export { BriefBlock, briefOfItem } from '@/components/feed/brief-block';
export { labelFor, storefrontKindOfName } from '@/lib/signals/lead-rules';
