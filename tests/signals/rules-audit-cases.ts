// Round 19 RULES: one or more cases per line of the audited rule list (review-ENGINE-compare.md section 5), each on a REAL live row
// (tests/signals/__data__/rules-audit-rows.json holds the rows, copied unchanged from the export of Nov 8 to Dec 6 2026; public records).
// `want: 'none'` means the trade does not see the record at all (not carried). `noLocation` labels the row as a delivered match would
// (no point passed): the label rules alone, for rows the matcher can never deliver (NWS zone alerts, Orlando permits).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CategoryId } from '@/lib/signals/categories';
import type { LabelInput, OpportunityLabel } from '@/lib/signals/lead-rules';

export interface LiveRow {
  id: number;
  source: string;
  kind: string;
  title: string;
  summary: string | null;
  categories: string[];
  state: string | null;
  city: string | null;
  severity: number;
  occurred_at: string;
  data: Record<string, unknown> | null;
  lat: number | null;
  lon: number | null;
}

export const LIVE_ROWS: LiveRow[] = JSON.parse(readFileSync(join(__dirname, '__data__', 'rules-audit-rows.json'), 'utf8'));
const BY_ID = new Map(LIVE_ROWS.map((r) => [r.id, r]));

export function liveRow(id: number): LiveRow {
  const r = BY_ID.get(id);
  if (!r) throw new Error(`row ${id} is not in the fixture`);
  return r;
}

export function inputOf(r: LiveRow, opts: { noLocation?: boolean; summary?: string | null } = {}): LabelInput {
  const base: LabelInput = { source: r.source, kind: r.kind, subtype: typeof r.data?.subtype === 'string' ? (r.data.subtype as string) : null, title: r.title, summary: opts.summary !== undefined ? opts.summary : r.summary };
  return opts.noLocation ? base : { ...base, lat: r.lat, lon: r.lon, state: r.state, severity: r.severity };
}

export interface AuditCase {
  line: number;
  row: number;
  trade: CategoryId;
  want: OpportunityLabel | 'none';
  noLocation?: boolean;
  note?: string;
}

const C = (line: number, row: number, trade: CategoryId, want: AuditCase['want'], extra: Partial<AuditCase> = {}): AuditCase => ({ line, row, trade, want, ...extra });

export const AUDIT_CASES: AuditCase[] = [
  // ---- 311 -----------------------------------------------------------------------------------------------------------------------
  C(1, 1175, 'hvac', 'market_insight'),
  C(1, 22176, 'hvac', 'market_insight'),
  C(2, 1176, 'plumbing', 'market_insight'),
  C(2, 1175, 'plumbing', 'market_insight'),
  C(3, 1176, 'hvac', 'context', { note: 'whole building, no third-complaint mark: no HVAC card' }),
  C(3, 87677, 'hvac', 'context', { note: 'a building with 2 complaints in the window: never marked' }),
  C(4, 3127, 'plumbing', 'context'),
  C(4, 1381, 'plumbing', 'context'),
  C(4, 3127, 'hvac', 'act_now', { note: 'heating keeps the act now' }),
  C(5, 120691, 'hvac', 'context', { note: 'Cincinnati CLOS-NO' }),
  C(5, 4553, 'junk-removal', 'context', { note: 'Austin abatement, Closed' }),
  C(5, 3051, 'handyman', 'context', { note: 'New Orleans Healthy Homes, Closed' }),
  C(6, 1663, 'cleaning', 'context'),
  C(6, 1663, 'painting', 'act_now', { note: 'painting keeps the private graffiti' }),
  C(7, 1702, 'restoration', 'context', { note: 'on_street' }),
  C(7, 62108, 'restoration', 'context', { note: 'no location part' }),
  C(7, 29513, 'restoration', 'coming_soon', { note: 'on_property' }),
  C(8, 4064, 'restoration', 'coming_soon', { note: 'carried: the row is tagged plumbing only' }),
  C(9, 4069, 'lawn-care', 'coming_soon'),
  C(9, 4069, 'general-contractor', 'context'),
  C(9, 4067, 'security', 'coming_soon', { note: 'Open to Entry, carried' }),
  C(9, 4067, 'handyman', 'coming_soon'),
  C(10, 120738, 'restoration', 'coming_soon'),
  C(10, 1237, 'restoration', 'coming_soon'),
  C(10, 154638, 'pest-control', 'coming_soon'),
  C(10, 3157, 'pest-control', 'coming_soon'),
  C(10, 56526, 'handyman', 'coming_soon'),
  C(10, 56526, 'general-contractor', 'coming_soon'),
  C(10, 120748, 'restoration', 'context', { note: '"RESTORATION, REPAIR CWW" is city water works' }),
  C(10, 62442, 'junk-removal', 'context'),
  C(10, 54210, 'junk-removal', 'context'),
  C(11, 4165, 'pest-control', 'context'),
  C(11, 3046, 'pest-control', 'context'),
  C(11, 4160, 'pest-control', 'context'),
  C(11, 1170, 'pest-control', 'market_insight', { note: 'owner call 5: feed only' }),
  C(12, 29757, 'plumbing', 'coming_soon'),
  // ---- code violations -----------------------------------------------------------------------------------------------------------
  C(13, 4249, 'electrical', 'act_now', { note: 'ILLUMINATE PUBLIC STAIR/HALL names lighting; carried' }),
  C(14, 4249, 'general-contractor', 'context'),
  C(14, 4249, 'handyman', 'context'),
  C(15, 4313, 'general-contractor', 'coming_soon'),
  C(15, 4438, 'handyman', 'context'),
  C(15, 4438, 'general-contractor', 'coming_soon'),
  C(16, 55537, 'lawn-care', 'coming_soon'),
  C(16, 4387, 'general-contractor', 'market_insight'),
  C(16, 4387, 'handyman', 'coming_soon'),
  C(17, 4388, 'junk-removal', 'coming_soon'),
  C(17, 4388, 'lawn-care', 'coming_soon'),
  C(17, 4388, 'landscaping', 'context'),
  C(18, 4380, 'hvac', 'context'),
  // ---- inspections ---------------------------------------------------------------------------------------------------------------
  C(19, 1477, 'pest-control', 'coming_soon'),
  C(20, 1477, 'janitorial-commercial', 'coming_soon', { note: 'owner call 6: a heads-up' }),
  C(21, 1481, 'food-truck', 'context'),
  C(21, 744, 'general-contractor', 'context'),
  C(22, 744, 'plumbing', 'coming_soon'),
  // ---- business licences and event permits ---------------------------------------------------------------------------------------
  C(23, 131496, 'security', 'market_insight', { note: 'NYC "Locksmith": no premises' }),
  C(23, 131922, 'security', 'coming_soon', { note: 'NYC "Electronics": a shop (owner call 4)' }),
  C(23, 131502, 'signs-printing', 'market_insight', { note: 'NYC "Garage & Parking Lot": owner call 4 says no' }),
  C(23, 4617, 'janitorial-commercial', 'coming_soon', { note: 'Chicago "Retail Food Establishment"' }),
  C(24, 5478, 'pest-control', 'coming_soon', { noLocation: true, note: 'Orlando "TAKE OUT RESTAU"; Orlando rows have no point' }),
  C(24, 4622, 'pest-control', 'context', { note: 'Chicago "Limited Business License"' }),
  C(25, 5462, 'hvac', 'context', { noLocation: true }),
  C(25, 4617, 'hvac', 'context'),
  C(26, 32364, 'signs-printing', 'context'),
  C(27, 5494, 'catering', 'market_insight'),
  C(27, 5523, 'catering', 'market_insight', { note: 'Special Event at a Plaza site' }),
  C(27, 5513, 'food-truck', 'market_insight', { note: 'Street Event' }),
  C(27, 5522, 'event-services', 'market_insight', { note: 'Production Event' }),
  C(27, 5683, 'catering', 'coming_soon', { note: 'Farmers Market: a named event' }),
  C(28, 5683, 'security', 'context'),
  // ---- weather, storm reports, quakes, travel, federal bids --------------------------------------------------------------------------
  C(29, 6468, 'restoration', 'context', { noLocation: true, note: 'Red Flag Warning is in the table with no trade' }),
  C(30, 1, 'public-adjuster', 'context'),
  C(30, 1, 'insurance', 'context'),
  C(30, 1, 'junk-removal', 'context'),
  C(30, 13977, 'towing', 'context'),
  C(31, 7, 'plumbing', 'context', { noLocation: true }),
  C(31, 13977, 'plumbing', 'context'),
  C(32, 1, 'restoration', 'market_insight'),
  C(32, 13977, 'restoration', 'coming_soon', { note: 'Flood Warning keeps the heads-up' }),
  C(33, 6, 'roofing', 'context', { noLocation: true, note: 'Lake Wind Advisory' }),
  C(33, 6612, 'restoration', 'context', { noLocation: true, note: 'Coastal Flood Advisory' }),
  C(33, 88241, 'restoration', 'coming_soon', { noLocation: true, note: 'Coastal Flood Warning' }),
  C(33, 88241, 'plumbing', 'context', { noLocation: true }),
  C(34, 8, 'snow-removal', 'coming_soon', { noLocation: true }),
  C(34, 8, 'plumbing', 'market_insight', { noLocation: true }),
  C(34, 9, 'roofing', 'market_insight', { noLocation: true, note: 'Wind Advisory' }),
  C(35, 14, 'electrical', 'context', { noLocation: true }),
  C(35, 9, 'electrical', 'context', { noLocation: true }),
  C(35, 8, 'tree-service', 'context', { noLocation: true }),
  C(36, 56651, 'plumbing', 'market_insight', { noLocation: true }),
  C(36, 145499, 'landscaping', 'context', { noLocation: true }),
  C(37, 14, 'siding-gutters', 'coming_soon', { noLocation: true, note: 'carried' }),
  C(37, 8604, 'siding-gutters', 'coming_soon', { note: 'Severe Thunderstorm Warning, carried' }),
  C(38, 154864, 'insurance', 'context', { note: 'a measured gust' }),
  C(38, 145646, 'insurance', 'market_insight', { note: 'a damage report' }),
  C(39, 145646, 'restoration', 'act_now', { note: 'damage to their home' }),
  C(39, 145646, 'roofing', 'coming_soon', { note: 'no roof named' }),
  C(39, 40650, 'tree-service', 'act_now', { note: 'palm trees felled' }),
  C(39, 71579, 'tree-service', 'coming_soon', { note: 'a branch on Interstate 405: road crew' }),
  C(40, 154864, 'roofing', 'market_insight'),
  C(40, 154864, 'restoration', 'market_insight'),
  C(41, 73586, 'auto-body', 'market_insight'),
  C(41, 73586, 'restoration', 'context'),
  C(41, 73586, 'siding-gutters', 'act_now', { note: '1.00 inch, carried' }),
  C(42, 6504, 'restoration', 'context', { note: 'M4.0' }),
  C(42, 88285, 'restoration', 'coming_soon', { note: 'M5.1' }),
  C(42, 88285, 'plumbing', 'context'),
  C(43, 161866, 'rideshare-delivery', 'market_insight'),
  C(44, 156185, 'general-contractor', 'coming_soon', { note: 'Sources Sought' }),
  C(44, 156051, 'general-contractor', 'act_now', { note: 'a Solicitation placed in Cave Junction, OR stays act now' }),
  // ---- building permits ----------------------------------------------------------------------------------------------------------
  C(45, 68, 'painting', 'market_insight'),
  C(45, 68, 'handyman', 'market_insight'),
  C(46, 2011, 'cleaning', 'context'),
  C(46, 2011, 'painting', 'market_insight', { note: 'owner call 3: feed only' }),
  C(47, 67, 'junk-removal', 'context'),
  C(47, 55448, 'junk-removal', 'market_insight', { note: 'Roof and remodel: line 45 wins' }),
  C(48, 55448, 'solar', 'market_insight'),
  C(49, 257, 'siding-gutters', 'context'),
  C(50, 67, 'siding-gutters', 'market_insight', { note: '$4,600' }),
  C(51, 167173, 'electrical', 'context'),
  C(51, 167173, 'roofing', 'context'),
  C(52, 92520, 'fencing', 'context'),
  C(52, 92520, 'concrete-paving', 'context'),
  C(53, 92520, 'junk-removal', 'market_insight'),
  C(54, 138456, 'windows-doors', 'context'),
  C(54, 138456, 'pool-spa', 'context'),
  C(55, 61, 'security', 'market_insight'),
  C(56, 61, 'cleaning', 'market_insight'),
  C(56, 61, 'moving', 'market_insight'),
  C(56, 3057, 'cleaning', 'coming_soon', { note: 'a stated residential class reads as a new home' }),
  C(57, 100357, 'real-estate', 'market_insight', { note: 'New home with electrical and concrete sub-permits' }),
  C(57, 341, 'landscaping', 'market_insight', { note: '$3,000' }),
  C(57, 871, 'fencing', 'market_insight', { note: 'owner call 7: feed only' }),
  C(58, 871, 'lawn-care', 'coming_soon', { note: 'carried' }),
  C(59, 138452, 'janitorial-commercial', 'market_insight'),
  C(59, 138452, 'pest-control', 'context'),
  C(60, 100345, 'pest-control', 'context'),
  C(60, 100345, 'business-services', 'context'),
  C(60, 100345, 'janitorial-commercial', 'coming_soon', { note: 'a tenant fit-out title keeps the heads-up' }),
  C(61, 124957, 'fencing', 'coming_soon'),
  C(61, 2482, 'fencing', 'market_insight', { note: '$92 grading permit' }),
  C(61, 124957, 'concrete-paving', 'market_insight'),
  C(62, 55463, 'hvac', 'none', { note: 'owner call 3 (NO): HVAC does not see additions' }),
  C(63, 247, 'general-contractor', 'market_insight'),
  C(63, 247, 'flooring', 'market_insight'),
  C(63, 247, 'painting', 'market_insight'),
  C(64, 764, 'landscaping', 'context', { note: 'Sprinklers at Park Avenue South' }),
  C(64, 3174, 'landscaping', 'context', { note: 'Sprinkler and Standpipe' }),
  C(64, 9559, 'lawn-care', 'none'),
  C(65, 76848, 'painting', 'coming_soon', { noLocation: true, note: 'Orlando deck, no value stated' }),
  C(65, 33526, 'painting', 'market_insight', { note: '$400' }),
];
