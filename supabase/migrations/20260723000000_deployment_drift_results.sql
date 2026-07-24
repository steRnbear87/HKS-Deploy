-- Aggregate rollout/drift status for managed apps: how many devices Graph
-- reports telemetry for are on the version IntuneGet expects
-- (update_check_results.current_version) versus behind or ahead of it.
-- Computed by the daily check-updates cron only (not the interactive Refresh
-- button - the tenant-wide detectedApps sweep + per-app managedDevices fan-out
-- this requires is too slow for an on-demand click). No per-device rows; a
-- live drill-down can reuse the existing detected-app-devices Graph pattern
-- later if ever needed. Service-only; API routes read via service_role.
CREATE TABLE IF NOT EXISTS public.deployment_drift_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  tenant_id TEXT NOT NULL,
  winget_id TEXT NOT NULL,
  intune_app_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  expected_version TEXT NOT NULL,
  total_devices_scanned INTEGER NOT NULL DEFAULT 0,
  on_expected_count INTEGER NOT NULL DEFAULT 0,
  behind_count INTEGER NOT NULL DEFAULT 0,
  ahead_count INTEGER NOT NULL DEFAULT 0,
  partial BOOLEAN NOT NULL DEFAULT FALSE,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, tenant_id, winget_id, intune_app_id)
);

CREATE INDEX IF NOT EXISTS idx_deployment_drift_results_user
  ON public.deployment_drift_results(user_id);

ALTER TABLE public.deployment_drift_results ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.deployment_drift_results FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.deployment_drift_results TO service_role;

COMMENT ON TABLE public.deployment_drift_results IS
  'Aggregate per-app rollout/drift status (devices on/behind/ahead of the expected version), captured by the daily check-updates cron.';
