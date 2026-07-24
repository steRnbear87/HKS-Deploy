-- Daily per-tenant "top installed apps across the fleet" rollup, one row per
-- (tenant, day, app). Backed by Graph's tenant-wide detectedApps collection
-- (confirmed to carry a real deviceCount field) via a daily snapshot job -
-- Graph itself has no history, and computing this live on every page load
-- would be too expensive. Service-only; API routes read via service_role.
CREATE TABLE IF NOT EXISTS public.fleet_app_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  app_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  publisher TEXT,
  device_count INTEGER NOT NULL DEFAULT 0,
  devices_total INTEGER NOT NULL DEFAULT 0,
  partial BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, snapshot_date, app_key)
);

CREATE INDEX IF NOT EXISTS idx_fleet_app_inventory_tenant_date_count
  ON public.fleet_app_inventory(tenant_id, snapshot_date, device_count DESC);

ALTER TABLE public.fleet_app_inventory ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.fleet_app_inventory FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fleet_app_inventory TO service_role;

COMMENT ON TABLE public.fleet_app_inventory IS
  'Daily per-tenant "top installed apps" ranking captured by the fleet app-inventory snapshot job.';
