/**
 * Database Types for IntuneGet
 * Shared interfaces between SQLite and Supabase implementations
 */

import type { Json } from '@/types/database';

/**
 * Packaging job record
 */
export interface PackagingJob {
  id: string;
  user_id: string;
  user_email: string | null;
  tenant_id: string | null;
  winget_id: string;
  version: string;
  display_name: string;
  publisher: string | null;
  architecture: string | null;
  installer_type: string | null;
  installer_url: string | null;
  installer_sha256: string | null;
  install_command: string | null;
  uninstall_command: string | null;
  install_scope: string | null;
  silent_switches: string | null;
  detection_rules: Json | null;
  package_config: Json | null;
  github_run_id: string | null;
  github_run_url: string | null;
  intunewin_url: string | null;
  intunewin_size_bytes: number | null;
  unencrypted_content_size: number | null;
  encryption_info: Json | null;
  intune_app_id: string | null;
  intune_app_url: string | null;
  app_source: string | null;
  status: string;
  status_message: string | null;
  progress_percent: number;
  progress_message: string | null;
  error_message: string | null;
  error_stage: string | null;
  error_category: string | null;
  error_code: string | null;
  error_details: Json | null;
  warnings: Json | null;
  packager_id: string | null;
  packager_heartbeat_at: string | null;
  claimed_at: string | null;
  packaging_started_at: string | null;
  packaging_completed_at: string | null;
  upload_started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Upload history record
 */
export interface UploadHistoryRecord {
  id: string;
  packaging_job_id: string | null;
  user_id: string;
  winget_id: string;
  version: string;
  display_name: string;
  publisher: string | null;
  intune_app_id: string;
  intune_app_url: string | null;
  intune_tenant_id: string | null;
  app_source: string | null;
  deployed_at: string;
}

/**
 * Daily per-tenant fleet-health rollup (Graph has no history of its own -
 * this is our own snapshot of device compliance/staleness counts over time).
 */
export interface DeviceHealthSnapshot {
  id: string;
  tenant_id: string;
  /** YYYY-MM-DD, UTC. */
  snapshot_date: string;
  captured_at: string;
  total_devices: number;
  compliant_count: number;
  noncompliant_count: number;
  in_grace_period_count: number;
  config_manager_count: number;
  unknown_count: number;
  stale_count: number;
  partial: boolean;
  created_at: string;
}

/**
 * A detected app-update, ready for the App Updates page to display. Mirrors
 * the Supabase `update_check_results` table so the same shape is usable from
 * either backend - `policy`/`has_prior_deployment` (Supabase-only concepts)
 * are joined in at the route layer, not stored here.
 */
export interface UpdateCheckResultRecord {
  id: string;
  user_id: string;
  tenant_id: string;
  winget_id: string;
  intune_app_id: string;
  display_name: string;
  current_version: string;
  latest_version: string;
  is_critical: boolean;
  is_managed: boolean;
  large_icon_type: string | null;
  large_icon_value: string | null;
  notified_at: string | null;
  dismissed_at: string | null;
  detected_at: string;
  updated_at: string;
}

/**
 * Aggregate rollout/drift status for one managed app: how many of the
 * devices Graph reports telemetry for are on the version IntuneGet expects
 * (expected_version, i.e. update_check_results.current_version) versus
 * behind or ahead of it. No per-device rows - a live drill-down can reuse
 * the existing detected-app-devices Graph pattern later if ever needed.
 */
export interface DeploymentDriftRecord {
  id: string;
  user_id: string;
  tenant_id: string;
  winget_id: string;
  intune_app_id: string;
  display_name: string;
  expected_version: string;
  total_devices_scanned: number;
  on_expected_count: number;
  behind_count: number;
  ahead_count: number;
  partial: boolean;
  scanned_at: string;
}

/** One row per (tenant, day, app) - the fleet-wide "top installed apps" rollup. */
export interface FleetAppInventoryRow {
  id: string;
  tenant_id: string;
  /** YYYY-MM-DD, UTC. */
  snapshot_date: string;
  captured_at: string;
  /** Normalized (lower/trim) displayName, used as the grouping key across app-version variants. */
  app_key: string;
  display_name: string;
  publisher: string | null;
  device_count: number;
  devices_total: number;
  partial: boolean;
  created_at: string;
}

/**
 * Current-state cache of each device's BIOS version, keyed one row per
 * device (not a daily-accumulating snapshot like the two rollups above -
 * BIOS rarely changes, so there's no value in retaining history, and a
 * ~2,591-device fleet would add that many rows every day forever otherwise).
 * `bios_version` is intentionally nullable and distinct from "no row yet":
 * a row with `bios_version: null` means Graph was successfully queried and
 * reported nothing (e.g. not yet collected, or a non-Windows device slipped
 * through); no row at all means this device hasn't been captured today.
 */
export interface DeviceBiosInfoRecord {
  id: string;
  tenant_id: string;
  device_id: string;
  bios_version: string | null;
  /** Same per-device hardwareInformation payload the BIOS fetch already
   * pulls - battery/storage fields are just additional columns kept from
   * that one response, not a separate Graph call. */
  battery_health_percentage: number | null;
  battery_charge_cycles: number | null;
  total_storage_bytes: number | null;
  free_storage_bytes: number | null;
  captured_at: string;
}

/**
 * Current-state cache of each tenant's Windows Autopilot device identities
 * (Graph's deviceManagement/windowsAutopilotDeviceIdentities), keyed one row
 * per device - same "current state, not accumulating history" shape as
 * DeviceBiosInfoRecord, since this is a live registration/enrollment status
 * snapshot, not a time series. device_id is the Autopilot device identity's
 * own Graph id (a distinct GUID from the managedDevice id used elsewhere).
 */
export interface AutopilotDeviceSnapshotRecord {
  id: string;
  tenant_id: string;
  device_id: string;
  serial_number: string | null;
  group_tag: string | null;
  manufacturer: string | null;
  model: string | null;
  enrollment_state: string;
  deployment_profile_assignment_status: string;
  last_contacted_at: string | null;
  captured_at: string;
}

/**
 * Current-state cache of each Entra ID user's office location, keyed one row
 * per user (not per device - many devices share a primary user, so caching
 * by user_principal_name instead of device_id avoids refetching the same
 * profile once per device). Mirrors DeviceBiosInfoRecord's "row exists ==
 * already checked" semantics: `office_location: null` means Graph was
 * queried and the user genuinely has no office location set, not "not yet
 * captured". user_principal_name is stored lowercased for case-insensitive
 * lookup (Graph UPNs are case-insensitive but device records may not match
 * the casing Graph returns for the user object).
 */
export interface UserOfficeLocationRecord {
  id: string;
  tenant_id: string;
  user_principal_name: string;
  office_location: string | null;
  captured_at: string;
}

/**
 * Maps a device to the dedicated single-device Entra ID group this tool
 * creates/manages on its behalf. Intune's Windows Update Graph resources
 * (update rings, feature/quality/driver update profiles) only support
 * group-based assignment - there is no per-device target type - so "assign
 * policy X to device Y" is implemented as "assign policy X to device Y's
 * tool-managed group". One row per device; the same group is reused across
 * every Windows Update policy type assigned to that device.
 */
export interface DeviceUpdateGroupRecord {
  id: string;
  tenant_id: string;
  device_id: string;
  azure_ad_device_id: string;
  entra_group_id: string;
  created_at: string;
}

/**
 * Job statistics
 */
export interface JobStats {
  queued: number;
  packaging: number;
  uploading: number;
  deployed: number;
  failed: number;
  cancelled: number;
}

/**
 * Database adapter interface
 * Both SQLite and Supabase implementations must conform to this interface
 */
export interface DatabaseAdapter {
  jobs: {
    /**
     * Get jobs by status
     */
    getByStatus(status: string, limit?: number, ascending?: boolean): Promise<PackagingJob[]>;

    /**
     * Get a job by ID
     */
    getById(id: string): Promise<PackagingJob | null>;

    /**
     * Get jobs by user ID
     */
    getByUserId(userId: string, limit?: number): Promise<PackagingJob[]>;

    /**
     * Get jobs for every user in a tenant (tenant-wide deployments view)
     */
    getByTenantId(tenantId: string, limit?: number): Promise<PackagingJob[]>;

    /**
     * Create a new job
     */
    create(job: Partial<PackagingJob>): Promise<PackagingJob>;

    /**
     * Update a job
     * @param id Job ID
     * @param data Fields to update
     * @param conditions Optional conditions for the update (e.g., { status: 'queued' })
     */
    update(id: string, data: Partial<PackagingJob>, conditions?: Record<string, unknown>): Promise<PackagingJob | null>;

    /**
     * Claim a job atomically (only if status is 'queued')
     */
    claim(jobId: string, packagerId: string): Promise<PackagingJob | null>;

    /**
     * Release a job back to queued state
     */
    release(jobId: string, packagerId: string): Promise<PackagingJob | null>;

    /**
     * Force release a stale job back to queued state (no packager_id check)
     */
    forceRelease(jobId: string): Promise<PackagingJob | null>;

    /**
     * Get stale jobs (packaging status with old heartbeat)
     */
    getStaleJobs(staleThreshold: Date): Promise<PackagingJob[]>;

    /**
     * Get job statistics
     */
    getStats(): Promise<JobStats>;

    /**
     * Soft-archive a single job by ID
     */
    deleteById(id: string): Promise<boolean>;

    /**
     * Bulk-archive jobs matching a user ID and a set of statuses
     * Returns the number of archived rows
     */
    deleteByUserIdAndStatuses(userId: string, statuses: string[]): Promise<number>;
  };

  uploadHistory: {
    /**
     * Create an upload history record
     */
    create(record: Partial<UploadHistoryRecord>): Promise<UploadHistoryRecord>;

    /**
     * Get upload history by user ID
     */
    getByUserId(userId: string, limit?: number): Promise<UploadHistoryRecord[]>;

    /**
     * Distinct (user_id, tenant_id) pairs across every deployment on record -
     * the self-hosted SQLite source of "who to check for updates", since the
     * Supabase-only notification_preferences/webhook_configurations/
     * app_update_policies tables that also feed that discovery don't exist here.
     */
    getDistinctUserTenantPairs(): Promise<Array<{ user_id: string; intune_tenant_id: string | null }>>;
  };

  deviceHealthSnapshots: {
    /**
     * Insert or replace today's snapshot for a tenant (keyed on tenant_id + snapshot_date).
     */
    upsert(snapshot: Omit<DeviceHealthSnapshot, 'id' | 'created_at'>): Promise<DeviceHealthSnapshot>;

    /**
     * Snapshots for a tenant on or after sinceDate (YYYY-MM-DD), oldest first.
     */
    getByTenantId(tenantId: string, sinceDate: string): Promise<DeviceHealthSnapshot[]>;

    /**
     * Most recent snapshot for a tenant, or null if none exist yet.
     */
    getLatest(tenantId: string): Promise<DeviceHealthSnapshot | null>;

    /**
     * Prune snapshots older than cutoffDate (YYYY-MM-DD). Returns rows deleted.
     */
    deleteOlderThan(cutoffDate: string): Promise<number>;

    /**
     * Distinct tenant IDs that have at least one snapshot or packaging job -
     * used by the snapshot job to know which tenants to capture.
     */
    getKnownTenantIds(): Promise<string[]>;
  };

  fleetAppInventory: {
    /**
     * Replace all rows for a tenant/date with a new top-N ranking in one
     * atomic operation (delete-then-insert), so a re-run never leaves stale
     * ranks mixed with fresh ones.
     */
    replaceForDate(
      tenantId: string,
      snapshotDate: string,
      rows: Array<Omit<FleetAppInventoryRow, 'id' | 'created_at' | 'tenant_id' | 'snapshot_date'>>
    ): Promise<void>;

    /** Most recent day's ranked rows for a tenant, highest device_count first. */
    getLatestForTenant(tenantId: string, limit?: number): Promise<FleetAppInventoryRow[]>;

    /** Prune snapshots older than cutoffDate (YYYY-MM-DD). Returns rows deleted. */
    deleteOlderThan(cutoffDate: string): Promise<number>;
  };

  updateCheckResults: {
    /** Upsert on (user_id, tenant_id, winget_id, intune_app_id). */
    upsertMany(rows: Array<Omit<UpdateCheckResultRecord, 'id'>>): Promise<void>;

    /** Powers GET /api/updates/available. */
    getByUserId(
      userId: string,
      opts?: { tenantId?: string; includeDismissed?: boolean; criticalOnly?: boolean }
    ): Promise<UpdateCheckResultRecord[]>;

    /** Bulk read across many users at once - powers the cron's prior-row/stale-row logic. */
    getByUserIds(userIds: string[]): Promise<UpdateCheckResultRecord[]>;

    /** Powers PATCH /api/updates/available (dismiss/restore). Scoped by user for safety. */
    setDismissed(ids: string[], userId: string, dismissed: boolean): Promise<number>;

    /** Stale-row cleanup (cron + refresh route). */
    deleteByIds(ids: string[]): Promise<number>;

    /** Post-deploy cleanup: clear a resolved update once the app has been redeployed. */
    deleteByUserTenantWinget(userId: string, tenantId: string, wingetId: string): Promise<number>;

    /** Prune rows older than cutoffDate (ISO timestamp). Returns rows deleted. */
    deleteOlderThan(cutoffDate: string): Promise<number>;
  };

  deploymentDrift: {
    /** Upsert on (user_id, tenant_id, winget_id, intune_app_id). */
    upsertMany(rows: Array<Omit<DeploymentDriftRecord, 'id'>>): Promise<void>;

    /** Powers the rollout join in GET /api/updates/available. */
    getByUserId(userId: string, opts?: { tenantId?: string }): Promise<DeploymentDriftRecord[]>;

    /** Prune rows older than cutoffDate (ISO timestamp). Returns rows deleted. */
    deleteOlderThan(cutoffDate: string): Promise<number>;
  };

  deviceBiosInfo: {
    /** Upsert on (tenant_id, device_id). */
    upsertMany(rows: Array<Omit<DeviceBiosInfoRecord, 'id'>>): Promise<void>;

    /** One bulk read per tenant - used both by the capture job (to compute
     * "already captured today") and the devices list route's join. Never
     * do per-device lookups here. */
    getByTenantId(tenantId: string): Promise<DeviceBiosInfoRecord[]>;

    /** Deletes cached rows for devices no longer in the tenant's live fleet
     * (retired/removed) - this table has no date column to prune by age. */
    pruneRemoved(tenantId: string, currentDeviceIds: string[]): Promise<number>;
  };

  autopilotDeviceSnapshots: {
    /** Upsert on (tenant_id, device_id). */
    upsertMany(rows: Array<Omit<AutopilotDeviceSnapshotRecord, 'id'>>): Promise<void>;

    /** One bulk read per tenant - used both by the capture job and the
     * Autopilot report route. Never do per-device lookups here. */
    getByTenantId(tenantId: string): Promise<AutopilotDeviceSnapshotRecord[]>;

    /** Deletes cached rows for Autopilot device identities no longer
     * returned by Graph (deregistered) - this table has no date column to
     * prune by age. */
    pruneRemoved(tenantId: string, currentDeviceIds: string[]): Promise<number>;
  };

  userOfficeLocations: {
    /** Upsert on (tenant_id, user_principal_name). */
    upsertMany(rows: Array<Omit<UserOfficeLocationRecord, 'id'>>): Promise<void>;

    /** One bulk read per tenant - used both by the capture job (to compute
     * "already captured today") and the devices list route's join. Never
     * do per-user lookups here. */
    getByTenantId(tenantId: string): Promise<UserOfficeLocationRecord[]>;

    /** Deletes cached rows for users no longer the primary user of any
     * device in the tenant's live fleet - this table has no date column to
     * prune by age. */
    pruneRemoved(tenantId: string, currentUserPrincipalNames: string[]): Promise<number>;
  };

  deviceUpdateGroups: {
    /** Looks up the tool-managed group for a device, if one has been created. */
    getByDeviceId(tenantId: string, deviceId: string): Promise<DeviceUpdateGroupRecord | null>;

    /** Upsert on (tenant_id, device_id) - creates or repoints the mapping. */
    upsert(row: Omit<DeviceUpdateGroupRecord, 'id' | 'created_at'>): Promise<DeviceUpdateGroupRecord>;
  };
}
