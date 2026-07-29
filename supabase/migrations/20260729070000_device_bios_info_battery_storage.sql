-- Battery/storage fields added after device_bios_info's initial release.
-- Same per-device hardwareInformation Graph fetch already made for BIOS
-- version (see lib/device-health/bios-snapshot.ts) - these are just
-- additional columns kept from that one response, not a new Graph call.
ALTER TABLE public.device_bios_info
  ADD COLUMN IF NOT EXISTS battery_health_percentage REAL,
  ADD COLUMN IF NOT EXISTS battery_charge_cycles INTEGER,
  ADD COLUMN IF NOT EXISTS total_storage_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS free_storage_bytes BIGINT;
