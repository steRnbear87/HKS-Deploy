/**
 * Office-location -> region mapping for the device fleet.
 *
 * Region is a UI/reporting concept, not a Graph or Entra ID field - it's
 * derived from the primary user's Entra ID `officeLocation` (see
 * lib/intune/user-office-location.ts). Bucketing is by North American time
 * zone rather than strictly by country: a Canada/Mexico office falls under
 * whichever US region shares its time zone (confirmed with the org -
 * Pacific/Mountain -> US-West, Central -> US-Central, Eastern -> US-East),
 * and every office outside North America is EMEA/APAC.
 *
 * This is a static, hand-maintained list (not an admin-editable table, per
 * the org's call) - add a new office's city here when one opens. Anything
 * unrecognized resolves to 'Unknown region' rather than being silently
 * folded into the wrong bucket.
 *
 * The city list below was pulled directly from the live
 * user_office_locations cache, so it covers every distinct officeLocation
 * value observed for this tenant at the time this file was written - update
 * it as new offices/values show up (the Devices page's Office location
 * column filter shows the current live list).
 */

export type Region = 'US-Central' | 'US-East' | 'US-West' | 'EMEA/APAC' | 'Unknown region';

export const REGION_ORDER: Region[] = ['US-Central', 'US-East', 'US-West', 'EMEA/APAC', 'Unknown region'];

// Keyed by lowercased, trimmed city name exactly as it appears in Entra ID's
// officeLocation field.
const OFFICE_REGION_MAP: Record<string, Region> = {
  // US-Central (Central time; includes Mexico City, which shares the US
  // Central time zone)
  'dallas': 'US-Central',
  'chicago': 'US-Central',
  'houston': 'US-Central',
  'austin': 'US-Central',
  'fort worth': 'US-Central',
  'mexico city': 'US-Central',

  // US-East (Eastern time)
  'washington, dc': 'US-East',
  'orlando': 'US-East',
  'atlanta': 'US-East',
  'miami': 'US-East',
  'new york': 'US-East',
  'detroit': 'US-East',
  'richmond': 'US-East',
  'raleigh': 'US-East',

  // US-West (Pacific or Mountain time)
  'los angeles': 'US-West',
  'seattle': 'US-West',
  'denver': 'US-West',
  'salt lake city': 'US-West',
  'phoenix': 'US-West',
  'san francisco': 'US-West',
  'san diego': 'US-West',

  // EMEA/APAC (everything outside North America)
  'london': 'EMEA/APAC',
  'singapore': 'EMEA/APAC',
  'dubai': 'EMEA/APAC',
  'new delhi': 'EMEA/APAC',
  'shanghai': 'EMEA/APAC',
  'riyadh': 'EMEA/APAC',
};

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve a raw Entra ID officeLocation string to a region.
 *
 * Tries an exact (trimmed, case-insensitive) match first. Office location is
 * free text - people occasionally enter a variant like "London Office"
 * instead of "London" - so an unmatched value falls back to a whole-word
 * substring match against every known city before giving up. Anything still
 * unmatched (including null/empty) resolves to 'Unknown region' rather than
 * guessing.
 */
export function getRegionForOfficeLocation(officeLocation: string | null | undefined): Region {
  if (!officeLocation) return 'Unknown region';

  const normalized = officeLocation.trim().toLowerCase();
  if (!normalized) return 'Unknown region';

  const exact = OFFICE_REGION_MAP[normalized];
  if (exact) return exact;

  for (const [city, region] of Object.entries(OFFICE_REGION_MAP)) {
    const wordBoundary = new RegExp(`\\b${escapeForRegExp(city)}\\b`);
    if (wordBoundary.test(normalized)) return region;
  }

  return 'Unknown region';
}

export interface DeviceRegionCounts {
  total: number;
  'US-Central': number;
  'US-East': number;
  'US-West': number;
  'EMEA/APAC': number;
  'Unknown region': number;
}

export function summarizeDeviceRegions(
  devices: Array<{ officeLocation: string | null }>
): DeviceRegionCounts {
  const counts: DeviceRegionCounts = {
    total: devices.length,
    'US-Central': 0,
    'US-East': 0,
    'US-West': 0,
    'EMEA/APAC': 0,
    'Unknown region': 0,
  };
  for (const device of devices) {
    counts[getRegionForOfficeLocation(device.officeLocation)]++;
  }
  return counts;
}
