-- Core per-user profile/token storage. This app authenticates via Microsoft
-- (MSAL) directly, not Supabase Auth, so `id` is the Microsoft account's
-- localAccountId (plain text), not a foreign key into auth.users. Stores the
-- Graph access/refresh token pair server-side so cron jobs and background
-- work can act on the user's behalf between interactive sessions.
--
-- Like curated_excluded_apps and (originally) sccm_migrations' dependency on
-- this table, user_profiles existed in the original hosted Supabase project
-- without ever being captured as a migration - this backfills that gap.
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  microsoft_access_token TEXT,
  microsoft_refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  intune_tenant_id TEXT,
  tenant_name TEXT,
  profile_image TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_intune_tenant_id
  ON public.user_profiles(intune_tenant_id);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_profiles TO service_role;

COMMENT ON TABLE public.user_profiles IS
  'Per-user Microsoft Graph token storage and profile info, keyed by MSAL localAccountId (this app uses Microsoft auth directly, not Supabase Auth).';
