// Bundled for node by build-data.mjs. Re-exports the server's own pure helpers so the mock feed uses the same mapping as lib/mobile/feed.ts.
export { formatDistance } from '../../components/format';
export { INTENT_LABEL, intentLine, intentLineKey, intentOf } from '../../lib/signals/intent';
export { getSourceMeta } from '../../lib/signals/source-meta';
export { CATEGORIES, CATEGORY_GROUPS } from '../../lib/signals/categories';
export { PUBLIC_PRICES } from '../../lib/plan/public-prices';
export { PLAN_LIMITS } from '../../lib/plan/limits';
export { buildNotification } from '../../lib/push/notify';
// Pass 2: the member's work-ZIP point and the match test, exactly as the server does them (lib/auth/profile.ts stores lookupZip()'s
// point on the profile; lib/signals/match.ts decides the match and the distance).
export { lookupZip } from '../../lib/geo';
export { matchOne } from '../../lib/signals/match';
