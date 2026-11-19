// Bundled for node by build-data.mjs. Re-exports the server's own pure helpers so the mock feed uses the same mapping as lib/mobile/feed.ts.
export { formatDistance } from '../../components/format';
export { INTENT_LABEL, intentLine, intentLineKey, intentOf } from '../../lib/signals/intent';
export { getSourceMeta } from '../../lib/signals/source-meta';
export { CATEGORIES, CATEGORY_GROUPS } from '../../lib/signals/categories';
export { PUBLIC_PRICES } from '../../lib/plan/public-prices';
export { PLAN_LIMITS } from '../../lib/plan/limits';
