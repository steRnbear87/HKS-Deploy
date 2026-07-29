/**
 * In-process fleet snapshot scheduler.
 *
 * This self-hosted Docker deployment has no cron sidecar and Vercel Cron
 * (vercel.json) only fires on Vercel - neither exists for a plain
 * `docker compose up` install. Rather than require ops to add and maintain a
 * second container, this runs an hourly check inside the existing web
 * process; both capture functions are idempotent (they skip any tenant
 * already snapshotted today), so this is safe across container restarts and
 * safe to run alongside the CRON_SECRET-gated routes for anyone who'd rather
 * point an external scheduler at them instead.
 *
 * App-inventory runs after device-health (sequentially, not in parallel) so
 * it can reuse that day's just-written device-health snapshot for its
 * devicesTotal figure instead of guessing.
 */

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

// BIOS capture needs several minutes for a large fleet (one Graph call per
// device, no bulk endpoint exists for it) - generous since this runs inside
// the long-lived process on its own timer tick, not an HTTP request bound by
// a route's maxDuration. A full fleet may take a few ticks to fully cover in
// a day; each tick just picks up whatever's still missing (see
// lib/device-health/bios-snapshot.ts).
const BIOS_SNAPSHOT_BUDGET_MS = 4 * 60 * 1000;

// Office location changes rarely (unlike BIOS, it's not tied to hardware
// churn), so a much smaller per-tick budget is plenty - the "already
// captured today" skip in lib/intune/user-office-location.ts means most
// ticks do near-zero work once the fleet's users are fully captured.
const OFFICE_LOCATION_BUDGET_MS = 2 * 60 * 1000;

// windowsAutopilotDeviceIdentities is one paginated tenant-wide sweep (no
// per-device fan-out, unlike BIOS), so a full resync every tick is cheap -
// this budget is per-tenant, not a fleet-wide total.
const AUTOPILOT_SNAPSHOT_BUDGET_MS = 60 * 1000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { captureDueDeviceHealthSnapshots } = await import('@/lib/device-health/snapshot');
  const { captureDueAppInventorySnapshots } = await import('@/lib/device-health/app-inventory-snapshot');
  const { captureDueBiosSnapshots } = await import('@/lib/device-health/bios-snapshot');
  const { captureDueOfficeLocations } = await import('@/lib/intune/user-office-location');
  const { captureDueAutopilotSnapshots } = await import('@/lib/intune-reports/autopilot');

  const runCheck = async () => {
    try {
      await captureDueDeviceHealthSnapshots();
    } catch (error) {
      console.error('[device-health] Scheduled snapshot check failed:', error);
    }
    try {
      await captureDueAppInventorySnapshots();
    } catch (error) {
      console.error('[app-inventory] Scheduled snapshot check failed:', error);
    }
    try {
      await captureDueBiosSnapshots(BIOS_SNAPSHOT_BUDGET_MS);
    } catch (error) {
      console.error('[bios-snapshot] Scheduled snapshot check failed:', error);
    }
    try {
      await captureDueOfficeLocations(OFFICE_LOCATION_BUDGET_MS);
    } catch (error) {
      console.error('[user-office-location] Scheduled snapshot check failed:', error);
    }
    try {
      await captureDueAutopilotSnapshots(AUTOPILOT_SNAPSHOT_BUDGET_MS);
    } catch (error) {
      console.error('[autopilot-snapshot] Scheduled snapshot check failed:', error);
    }
  };

  runCheck();
  setInterval(runCheck, CHECK_INTERVAL_MS);
}
