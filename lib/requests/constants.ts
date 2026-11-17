/** Rules for resident service requests (/request). One place so pages, emails, routes and tests agree. */
import { HOLLER_REQUEST_SOURCE } from '@/lib/signals/request-visibility';

export const REQUEST_SOURCE = HOLLER_REQUEST_SOURCE;

export const DESCRIPTION_MIN = 20;
export const DESCRIPTION_MAX = 500;

/** A confirmed request stays open this long. */
export const OPEN_DAYS = 14;
/** An unconfirmed request (and its confirm link) is dropped after this many days. */
export const CONFIRM_DAYS = 7;
/** A request that runs out keeps its email address and its descriptions this many days, then they are wiped. Closing or removing a
 * request wipes them at once. */
export const PURGE_AFTER_DAYS = 30;

export const REPLY_MIN = 20;
export const REPLY_MAX = 800;
export const MAX_REPLIES_PER_REQUEST = 5;
export const MAX_REPLIES_PER_BUSINESS_PER_DAY = 10;

/** Site-wide cap on confirmation emails to residents per day (a brake if someone aims the form at other people's inboxes). */
export const REQUEST_CONFIRM_DAILY_CAP = 300;

/** Signal severity for a confirmed request: a person is asking right now. */
export const REQUEST_SEVERITY = 2 as const;

export const DAY_MS = 86_400_000;
