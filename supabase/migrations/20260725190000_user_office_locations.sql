-- Current-state cache of each Entra ID user's office location, one row per
-- user (not per device - many devices share a primary user, so caching by
-- user_principal_name instead of device_id avoids refetching the same
-- profile once per device that user owns). Captured by a Graph $batch
-- fan-out against /users/{upn}?$select=officeLocation, run incrementally
-- across cron ticks. office_location is nullable and distinct from "no row
-- yet": a row with office_location = NULL means Graph was queried and the
-- user genuinely has no office location set; no row at all means not
-- captured today. user_principal_name is stored lowercased for
-- case-insensitive lookup. Service-only; API routes read via service_role.
CREATE TABLE IF NOT EXISTS public.user_office_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  user_principal_name TEXT NOT NULL,
  office_location TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_principal_name)
);

CREATE INDEX IF NOT EXISTS idx_user_office_locations_tenant
  ON public.user_office_locations(tenant_id);

ALTER TABLE public.user_office_locations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_office_locations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_office_locations TO service_role;

COMMENT ON TABLE public.user_office_locations IS
  'Current-state cache of each Entra ID user''s office location, captured incrementally by the office-location snapshot job.';
