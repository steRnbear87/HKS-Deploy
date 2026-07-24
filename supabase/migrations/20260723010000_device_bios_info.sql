-- Current-state cache of each device's BIOS version, one row per device
-- (not a daily-accumulating snapshot like device_health_snapshots/
-- fleet_app_inventory - BIOS rarely changes, and a ~2,591-device fleet would
-- add that many rows every day forever if it were). Captured by a dedicated
-- per-device Graph fan-out (deviceManagement/managedDevices/{id} - Graph only
-- populates hardwareInformation on single-device fetches, never on the bulk
-- list endpoint), run incrementally across cron ticks since it can't finish
-- in one budget window for a large fleet. bios_version is nullable and
-- distinct from "no row yet": a row with bios_version = NULL means Graph was
-- queried and reported nothing; no row at all means not captured today.
-- Service-only; API routes read via service_role.
CREATE TABLE IF NOT EXISTS public.device_bios_info (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  bios_version TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_device_bios_info_tenant
  ON public.device_bios_info(tenant_id);

ALTER TABLE public.device_bios_info ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.device_bios_info FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.device_bios_info TO service_role;

COMMENT ON TABLE public.device_bios_info IS
  'Current-state cache of each device''s BIOS version, captured incrementally by the BIOS snapshot job.';
