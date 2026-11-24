/**
 * The most cards one alert email lists (app/api/cron/notify/route.ts). The rest of that run's matches are counted in the email's
 * "Plus {n} more on your matches page." line. One constant, so /check (lib/check/verdict.ts) says the same number the route uses.
 */
export const MAX_ITEMS_IN_DIGEST = 10;
