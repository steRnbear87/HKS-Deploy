-- Daily fleet-health rollup, one row per tenant per day. Microsoft Graph has
-- no historical device-compliance data - this table is the history, built by
-- our own daily snapshot job. Service-only; API routes read via service_role.
CREATE TABLE IF NOT EXISTS public.device_health_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  total_devices INTEGER NOT NULL DEFAULT 0,
  compliant_count INTEGER NOT NULL DEFAULT 0,
  noncompliant_count INTEGER NOT NULL DEFAULT 0,
  in_grace_period_count INTEGER NOT NULL DEFAULT 0,
  config_manager_count INTEGER NOT NULL DEFAULT 0,
  unknown_count INTEGER NOT NULL DEFAULT 0,
  stale_count INTEGER NOT NULL DEFAULT 0,
  partial BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_device_health_snapshots_tenant_date
  ON public.device_health_snapshots(tenant_id, snapshot_date);

ALTER TABLE public.device_health_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.device_health_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.device_health_snapshots TO service_role;

COMMENT ON TABLE public.device_health_snapshots IS
  'Daily per-tenant device compliance/staleness rollup, captured by the fleet-health snapshot job.';
