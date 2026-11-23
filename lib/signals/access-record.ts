/**
 * Round 21 integration: the ONE owner access record for a source read from a web page rather than a data portal (round 20 WATCH's page-watch
 * pages, lib/signals/adapters/page-watch-datasets.ts, and round 20 NEXT's Houston permit report, houston-permits-config.ts). Until the owner
 * has read the host's robots.txt and terms of use in a browser and recorded them here, NOTHING is requested from the source (not the page,
 * not robots.txt, not the probe, not Firecrawl). Pure, client-safe.
 */
export interface AccessRecord {
  /** The owner read robots.txt and the terms (and the vendor's terms for a vendor portal). Ships false. */
  termsChecked: boolean;
  /** The robots.txt the owner read, e.g. https://www.septa.org/robots.txt. Required with termsChecked. */
  robotsUrl?: string;
  /** The terms page the owner read. Required with termsChecked. */
  termsUrl?: string;
  /** YYYY-MM-DD the owner read them. Required with termsChecked. */
  checkedOn?: string;
  /** Who read them (optional). */
  checkedBy?: string;
  /**
   * A vendor's list endpoint only (Bonfire): the vendor's terms allow an automated client to call it. Required when the source reads such an
   * endpoint (`opts.endpoint`); ignored otherwise.
   */
  endpointAllowed?: boolean;
}

/**
 * May anything be requested? Only when termsChecked is true AND the robots.txt URL (https, ending in /robots.txt), the terms URL (https) and
 * the day (YYYY-MM-DD) are recorded, and, for a vendor's list endpoint, endpointAllowed is true. The strictest of the two round 20 rules.
 */
export function accessRecordCleared(r: AccessRecord | null | undefined, opts: { endpoint?: boolean } = {}): boolean {
  if (!r) return false;
  return (
    r.termsChecked === true &&
    /^https:\/\/\S+\/robots\.txt$/.test(r.robotsUrl ?? '') &&
    /^https:\/\/\S+$/.test(r.termsUrl ?? '') &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.checkedOn ?? '') &&
    (!opts.endpoint || r.endpointAllowed === true)
  );
}
