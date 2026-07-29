-- The app layer previously did DELETE-then-INSERT as two independent
-- Supabase calls (lib/db/supabase-adapter.ts fleetAppInventory.replaceForDate).
-- SQLite's equivalent wraps both in one transaction per its own interface
-- contract; on Supabase, an insert failure after a successful delete wiped a
-- tenant's daily rollup with nothing replacing it. A single Postgres
-- function call runs as one transaction, so this is atomic without any
-- explicit BEGIN/COMMIT.
CREATE OR REPLACE FUNCTION replace_fleet_app_inventory(
  p_tenant_id TEXT,
  p_snapshot_date TEXT,
  p_rows JSONB
)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM fleet_app_inventory
  WHERE tenant_id = p_tenant_id AND snapshot_date = p_snapshot_date;

  INSERT INTO fleet_app_inventory (
    tenant_id, snapshot_date, captured_at, app_key, display_name, publisher,
    device_count, devices_total, partial
  )
  SELECT
    p_tenant_id,
    p_snapshot_date,
    (r->>'captured_at')::timestamptz,
    r->>'app_key',
    r->>'display_name',
    r->>'publisher',
    COALESCE((r->>'device_count')::int, 0),
    COALESCE((r->>'devices_total')::int, 0),
    COALESCE((r->>'partial')::boolean, false)
  FROM jsonb_array_elements(p_rows) AS r;
END;
$$;

REVOKE ALL ON FUNCTION replace_fleet_app_inventory(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION replace_fleet_app_inventory(TEXT, TEXT, JSONB) TO service_role;
