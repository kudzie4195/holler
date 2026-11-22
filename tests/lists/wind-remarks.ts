/**
 * The reviewer's 115-remark SPC wind table (round 18 LISTS review 2), shared by tests/lists/rev2-wind.test.ts (the address lists) and
 * tests/signals/spc-wind-title.test.ts (the adapter's card title, severity and label; round 18 integration). No tests here: the table and the helper that runs a remark through the adapter.
 * `no` = the remark must never be read as wind damage; `yes` = it reports damage to a thing.
 */
import { scanSpc } from '@/lib/signals/adapters/spc';
import { stormKindOf, stormListLabel, type StormRow } from '@/lib/lists/core';
import { labelForMember } from '@/lib/signals/lead-rules';
import { stormFactsOf } from '@/lib/signals/wind-damage';

export type Want = 'no' | 'yes';
// [remark, want, where it comes from]
export const R: [string, Want, string][] = [
  // --- the commander's must-not list ---
  ['Trees swaying, no damage', 'no', 'task'],
  ['Damage unknown', 'no', 'task'],
  ['Possible damage', 'no', 'task'],
  ['damage not yet assessed', 'no', 'task'],
  ['Report of damages to follow', 'no', 'task'],
  ['undamaged', 'no', 'task'],
  ['Structures appear undamaged.', 'no', 'task variant'],
  ['Gust measured at the Miller tree farm.', 'no', 'task'],
  ['Measured at the power plant.', 'no', 'task'],
  // place names with damage-like words
  ['Measured at Lone Tree, CO mesonet.', 'no', 'place name'],
  ['Gust at Shingle Springs RAWS.', 'no', 'place name'],
  ['Mesonet site near Roof Butte.', 'no', 'place name'],
  ['Personal weather station on Tree Top Lane.', 'no', 'place name'],
  ['Sensor at Twin Trees campground.', 'no', 'place name'],
  ['Measured in Powers Lake.', 'no', 'place name'],
  ['ASOS at Downs, KS.', 'no', 'place name'],
  ['Measured at Damascus fire station.', 'no', 'place name'],
  ['Gust at Limb Creek bridge sensor.', 'no', 'place name'],
  ['Measured at Blown Fork Road.', 'no', 'place name'],
  ['Measured on Down East Road.', 'no', 'place name'],
  ['Mesonet at Power Line Road and Hwy 9.', 'no', 'place name'],
  ['Trained spotter at Big Tree Park.', 'no', 'place name'],
  ['Measured at Snapped Oak Ranch RAWS.', 'no', 'place name'],
  ['ASOS at DeKalb-Peachtree Airport measured 61 mph.', 'no', 'review 1'],
  ['Measured by ASOS at the downtown airport.', 'no', 'review 1'],
  ['Gust measured at Main Street mesonet site.', 'no', 'review 1'],
  ['Rooftop anemometer measured 61 mph.', 'no', 'review 1'],
  ['Powerful gust measured by a trained spotter.', 'no', 'review 1'],
  ['Measured gust. No damage reported.', 'no', 'review 1'],
  // negations and unknowns
  ['No reports of damage.', 'no', 'mine'],
  ['No damage has been reported at this time.', 'no', 'mine'],
  ['No wind damage reported.', 'no', 'mine'],
  ['No significant damage.', 'no', 'mine'],
  ['No trees down.', 'no', 'mine'],
  ['No trees or power lines down.', 'no', 'mine'],
  ['Trees were not blown down.', 'no', 'tests/signals/brief.test.ts'],
  ['Damage is not confirmed.', 'no', 'mine'],
  ['Unknown if any damage occurred.', 'no', 'mine'],
  ['Not aware of any damage.', 'no', 'mine'],
  ['Damage survey pending.', 'no', 'mine'],
  ['Emergency manager checking for damage.', 'no', 'mine'],
  ['Zero damage.', 'no', 'mine'],
  ["Spotter didn't see any damage.", 'no', 'mine'],
  // forecast wording
  ['Damaging winds could blow down trees.', 'no', 'tests/signals/brief.test.ts'],
  ['Damaging winds are expected.', 'no', 'tests/signals/brief.test.ts'],
  // innocent uses of the list words
  ['Measured on the roof of the EOC.', 'no', 'mine'],
  ['Roof-mounted anemometer at the fire station.', 'no', 'mine'],
  ['Storm chaser measured the gust driving down Highway 9.', 'no', 'mine'],
  ['Visibility down to a quarter mile in blowing dust.', 'no', 'mine'],
  ['Winds died down within five minutes.', 'no', 'mine'],
  ['Tree branches swaying.', 'no', 'mine'],
  ['Small limbs moving.', 'no', 'mine'],
  ['Dust blown across the highway.', 'no', 'mine'],
  ['Leaves and small twigs blown around.', 'no', 'mine'],
  ['Power remained on.', 'no', 'mine'],
  ['Peak gust at mesonet site. (FFC)', 'no', 'tests/signals/brief.test.ts'],
  ['Peak wind gust from passing thunderstorm. (ABQ)', 'no', 'tests/coverage/weather-coverage.test.ts'],
  ['Gust at 45 mph (test row below the 50 mph line)', 'no', 'tests/coverage/weather-coverage.test.ts'],
  ['68 mph gust at Dallas North Tollway and Hwy 428 (FWD)', 'no', 'tests/fixtures/spc-wind.csv'],
  ['ASOS station KLAA Lamar Airport (PUB)', 'no', 'tests/fixtures/spc-wind.csv'],
  ['Routine gust (FFC)', 'no', 'tests/fixtures/spc-wind.csv'],
  // --- should make a list ---
  ['Tree down on house', 'yes', 'task'],
  ['Roof blown off barn', 'yes', 'task'],
  ['Power lines down', 'yes', 'task'],
  ['Shingles removed', 'yes', 'task'],
  ['Large limbs down', 'yes', 'task'],
  ['Structural damage to mobile home', 'yes', 'task'],
  ['Social media photo shows chicken coop damage, trees down (LZK)', 'yes', 'tests/fixtures/spc-wind.csv'],
  ['Palm trees felled and mobile sign blown over (live 2026-11-19 today file)', 'yes', 'tests/coverage/weather-coverage.test.ts'],
  ['trees down', 'yes', 'tests/signals/capabilities.test.ts'],
  ['trees down on homes', 'yes', 'tests/match/storms.test.ts'],
  ['Part of the roof was blown off a barn.', 'yes', 'tests/signals/quality-gate-r15.test.ts'],
  ['Roof damage reported.', 'yes', 'tests/i18n/brief.test.ts'],
  ['No damage reported, but trees down on homes.', 'yes', 'tests/signals/brief.test.ts'],
  ['Trees down. No injuries reported.', 'yes', 'tests/signals/brief.test.ts'],
  ['Wind damage reported to a barn.', 'yes', 'tests/signals/brief.test.ts'],
  ['Estimated gust. Roof peeled off a shed.', 'yes', 'tests/signals/brief.test.ts'],
  ['Trees down on Paces Ferry.', 'yes', 'review 1'],
  ['Power lines snapped.', 'yes', 'review 1'],
  ['Several large limbs downed.', 'yes', 'review 1'],
  ['Shingles torn off.', 'yes', 'lists.test.ts'],
  ['Numerous trees uprooted.', 'yes', 'mine'],
  ['Carport destroyed.', 'yes', 'mine'],
  ['Barn collapsed.', 'yes', 'mine'],
  ['Siding torn from a house.', 'yes', 'mine'],
  ['Fence flattened and a shed overturned.', 'yes', 'mine'],
  ['Windows broken at a gas station.', 'yes', 'mine'],
  ['Semi overturned on I-40.', 'yes', 'mine'],
  ['Utility poles leaning.', 'yes', 'mine'],
  ['Mobile home rolled.', 'yes', 'mine'],
  ['Tin roofing peeled back on outbuilding.', 'yes', 'mine'],
  ['Large branch fell on a car.', 'yes', 'mine'],
  ['TSTM WND DMG. Multiple trees and powerlines dwn.', 'yes', 'mine'],
  ['Trees and power lines down, no injuries.', 'yes', 'mine'],
  ['No structural damage, but several trees down.', 'yes', 'mine'],
  ['Minor shingle damage to two homes.', 'yes', 'mine'],
  ['Gutters ripped off a home.', 'yes', 'mine'],
  // --- the rest of the SPC_REMARKS table of tests/signals/brief.test.ts (want = whether that table expects a damage mention) ---
  ['Several trees down on homes and power lines down. (FFC)', 'yes', 'tests/signals/brief.test.ts'],
  ['Large tree limbs snapped. (FFC)', 'yes', 'tests/signals/brief.test.ts'],
  ['Several trees uprooted. (FFC)', 'yes', 'tests/signals/brief.test.ts'],
  ['Power poles snapped along Highway 41. (FFC)', 'yes', 'tests/signals/brief.test.ts'],
  ['Shingles torn from roof of home. (FFC)', 'yes', 'tests/signals/brief.test.ts'],
  ['Trees blown over onto cars. (FFC)', 'yes', 'tests/signals/brief.test.ts'],
  ['Tree fell on a house. (FFC)', 'yes', 'tests/signals/brief.test.ts'],
  ['Measured by ASOS. No damage reported. (FFC)', 'no', 'tests/signals/brief.test.ts'],
  ['Damage not reported.', 'no', 'tests/signals/brief.test.ts'],
  ['Several trees down on homes.', 'yes', 'tests/signals/brief.test.ts'],
  // hail and tornado fixture remarks, sent as WIND rows (they are never wind rows in the fixtures; here only to try the words)
  ['Ping pong sized hail near Christus Hospital (SHV)', 'no', 'tests/fixtures/spc-hail.csv'],
  ['Media photo of 1.5-2.0 inch hail; time from radar (LSX)', 'no', 'tests/fixtures/spc-hail.csv'],
  ['Dime size hail, cars dented (FWD)', 'no', 'tests/fixtures/spc-hail.csv'],
  ['1.00 inch 1S of Democrat (FWD)', 'no', 'tests/fixtures/spc-hail.csv'],
  ['Multiple sightings of a weak landspout (LUB)', 'no', 'tests/fixtures/spc-torn.csv'],
  ['Landspout spotted near Shallowater (LUB)', 'no', 'tests/fixtures/spc-torn.csv'],
  ['Brief tornado touchdown relayed via social media (ILX)', 'no', 'tests/fixtures/spc-torn.csv'],
  ['Quarter size hail reported to fall in Hollywood associated with a severe thunderstorm over the area. (MFL)', 'no', 'tests/coverage/weather-coverage.test.ts'],
];

export interface Through {
  stored: boolean;
  title: string | null;
  /** lib/lists/core.ts stormKindOf on the stored row: 'wind' means a wind address list. */
  kind: string | null;
  /** The list label (stormListLabel). */
  label: string | null;
  /** The adapter's own severity for the stored row (round 18 integration). */
  severity: number | null;
  /** The card label the member sees (labelForMember, roofing + tree service) (round 18 integration). */
  cardLabel: string | null;
}

/** One remark through the REAL SPC adapter (scanSpc) as a wind row at `speed` ('61', 'UNK', ...), then through the lists and the label rules. */
export function through(remark: string, speed: string): Through {
  const csv = `Time,Speed,Location,County,State,Lat,Lon,Comments\n1906,${speed},2 N Smyrna,Cobb,GA,33.90,-84.51,"${remark.replace(/"/g, '""')}"\n`;
  const s = scanSpc({ csv, type: 'wind', day: '2026-11-20' }).signals[0];
  if (!s) return { stored: false, title: null, kind: null, label: null, severity: null, cardLabel: null };
  const d = s.data as { type?: string; windMph?: number; comments?: string };
  const row: StormRow = {
    id: 1, source: 'spc', kind: s.kind, title: s.title, lat: s.lat ?? null, lon: s.lon ?? null, city: s.city ?? null, state: s.state ?? null,
    occurred_at: s.occurredAt as string, url: s.url ?? null, categories: s.categories as string[],
    stormType: d.type ?? null, hailInches: null, windMph: d.windMph === undefined ? null : String(d.windMph), comments: d.comments ?? null,
  };
  const kind = stormKindOf(row);
  const label = stormListLabel(row, ['roofing', 'tree-service'], Date.parse('2026-11-22T15:00:00Z'));
  const cardLabel = labelForMember({ source: s.source, kind: s.kind, title: s.title, summary: s.summary ?? null, categories: s.categories as string[], storm: stormFactsOf(s.source, s.data) }, ['roofing', 'tree-service']);
  return { stored: true, title: s.title, kind, label, severity: s.severity, cardLabel };
}
