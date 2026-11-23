/**
 * Round 20 (LIC): the switch for the licence-file sync. HOLLER_LICENSE_SYNC_ENABLED is OFF unless it is "1", "true", "on" or "yes" (any
 * case). With it off, /api/cron/license-sync fetches nothing and writes nothing. The probe (/api/admin/license-probe) is not gated: it is
 * Bearer only, reads one sample and writes nothing. The permit lookup needs no switch: without rows in holler_contractor_licenses (or
 * without the table) it attaches nothing. Pure: reads process.env at call time.
 */
export const LICENSE_SYNC_FLAG = 'HOLLER_LICENSE_SYNC_ENABLED';

export function licenseSyncEnabled(value: string | undefined = typeof process !== 'undefined' ? process.env?.HOLLER_LICENSE_SYNC_ENABLED : undefined): boolean {
  return typeof value === 'string' && /^(?:1|true|on|yes)$/i.test(value.trim());
}
