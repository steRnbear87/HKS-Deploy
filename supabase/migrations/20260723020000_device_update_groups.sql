-- Maps each device to the dedicated single-device Entra ID group this tool
-- creates/manages on its behalf, since Intune's Windows Update Graph
-- resources (update rings, feature/quality/driver update profiles) only
-- support group-based assignment - there is no per-device target type.
-- One row per device; the same group is reused across every Windows Update
-- policy type assigned to that device, so a device never accumulates more
-- than one tool-managed group. Service-only; API routes read via service_role.
CREATE TABLE IF NOT EXISTS public.device_update_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  azure_ad_device_id TEXT NOT NULL,
  entra_group_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_device_update_groups_tenant
  ON public.device_update_groups(tenant_id);

ALTER TABLE public.device_update_groups ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.device_update_groups FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.device_update_groups TO service_role;

COMMENT ON TABLE public.device_update_groups IS
  'Maps each device to its tool-managed single-device Entra ID group, used to assign Windows Update policies (rings/feature/quality/driver profiles) to individual devices despite Graph''s group-only assignment model.';
