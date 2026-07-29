-- Current-state cache of each tenant's Windows Autopilot device identities
-- (Graph's deviceManagement/windowsAutopilotDeviceIdentities), one row per
-- device - same shape as device_bios_info: a live registration/enrollment
-- status snapshot, not a daily-accumulating time series. device_id is the
-- Autopilot device identity's own Graph id, a distinct GUID from the
-- managedDevice id used elsewhere in this schema.
-- Service-only; API routes read via service_role.
CREATE TABLE IF NOT EXISTS public.autopilot_device_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  serial_number TEXT,
  group_tag TEXT,
  manufacturer TEXT,
  model TEXT,
  enrollment_state TEXT NOT NULL,
  deployment_profile_assignment_status TEXT NOT NULL,
  last_contacted_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_autopilot_device_snapshots_tenant
  ON public.autopilot_device_snapshots(tenant_id);

ALTER TABLE public.autopilot_device_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.autopilot_device_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.autopilot_device_snapshots TO service_role;

COMMENT ON TABLE public.autopilot_device_snapshots IS
  'Current-state cache of each tenant''s Windows Autopilot device identities, captured by the Autopilot snapshot job.';
