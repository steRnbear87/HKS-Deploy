-- Denylist of winget ids that must never enter curated_apps (e.g. installers
-- that 403/timeout in CI, or known-bad manifests). Read by build-app-list.yml
-- on every import run; rows are added manually via the Supabase dashboard,
-- no application code writes to this table. This table existed directly in
-- the original hosted Supabase project without ever being captured as a
-- migration - this backfills that gap so fresh (self-hosted) projects have it.
CREATE TABLE IF NOT EXISTS public.curated_excluded_apps (
  winget_id TEXT PRIMARY KEY,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.curated_excluded_apps ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.curated_excluded_apps FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.curated_excluded_apps TO service_role;

COMMENT ON TABLE public.curated_excluded_apps IS
  'Winget ids permanently excluded from the curated catalog import (build-app-list.yml); maintained manually.';
