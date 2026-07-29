/**
 * SQLite Database Implementation for Self-Hosted Mode
 * Provides a simple, zero-dependency database for true self-hosting
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { DatabaseAdapter, PackagingJob, UploadHistoryRecord, DeviceHealthSnapshot, FleetAppInventoryRow, UpdateCheckResultRecord, DeploymentDriftRecord, DeviceBiosInfoRecord, AutopilotDeviceSnapshotRecord, UserOfficeLocationRecord, DeviceUpdateGroupRecord } from './types';

// Singleton database instance
let db: Database.Database | null = null;

/**
 * Get or create the SQLite database instance
 */
function getDb(): Database.Database {
  if (db) return db;

  const dbPath = process.env.DATABASE_PATH || './data/intuneget.db';
  const dbDir = path.dirname(dbPath);

  // Ensure the data directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');

  // Initialize schema
  initializeSchema(db);

  return db;
}

/**
 * Initialize the database schema
 */
function initializeSchema(db: Database.Database): void {
  // Create packaging_jobs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS packaging_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_email TEXT,
      tenant_id TEXT,
      winget_id TEXT NOT NULL,
      version TEXT NOT NULL,
      display_name TEXT NOT NULL,
      publisher TEXT,
      architecture TEXT,
      installer_type TEXT NOT NULL,
      installer_url TEXT NOT NULL,
      installer_sha256 TEXT,
      install_command TEXT,
      uninstall_command TEXT,
      install_scope TEXT,
      silent_switches TEXT,
      detection_rules TEXT,
      package_config TEXT,
      github_run_id TEXT,
      github_run_url TEXT,
      intunewin_url TEXT,
      intunewin_size_bytes INTEGER,
      unencrypted_content_size INTEGER,
      encryption_info TEXT,
      intune_app_id TEXT,
      intune_app_url TEXT,
      app_source TEXT DEFAULT 'win32',
      status TEXT NOT NULL DEFAULT 'queued',
      status_message TEXT,
      progress_percent INTEGER DEFAULT 0,
      progress_message TEXT,
      error_message TEXT,
      error_stage TEXT,
      error_category TEXT,
      error_code TEXT,
      error_details TEXT,
      warnings TEXT,
      packager_id TEXT,
      packager_heartbeat_at TEXT,
      claimed_at TEXT,
      packaging_started_at TEXT,
      packaging_completed_at TEXT,
      upload_started_at TEXT,
      completed_at TEXT,
      cancelled_at TEXT,
      cancelled_by TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const existingColumns = new Set(
    (db.pragma('table_info(packaging_jobs)') as Array<{ name: string }>).map((column) => column.name),
  );
  const compatibleColumns: Record<string, string> = {
    app_source: "TEXT DEFAULT 'win32'",
    error_stage: 'TEXT',
    error_category: 'TEXT',
    error_code: 'TEXT',
    error_details: 'TEXT',
    warnings: 'TEXT',
    archived_at: 'TEXT',
  };
  for (const [column, definition] of Object.entries(compatibleColumns)) {
    if (!existingColumns.has(column)) {
      db.exec(`ALTER TABLE packaging_jobs ADD COLUMN ${column} ${definition}`);
    }
  }

  // Create index for status queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_packaging_jobs_status ON packaging_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_packaging_jobs_user_id ON packaging_jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_packaging_jobs_created_at ON packaging_jobs(created_at);
    CREATE INDEX IF NOT EXISTS idx_packaging_jobs_packager_heartbeat ON packaging_jobs(packager_heartbeat_at);
  `);

  // Create upload_history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS upload_history (
      id TEXT PRIMARY KEY,
      packaging_job_id TEXT,
      user_id TEXT NOT NULL,
      winget_id TEXT NOT NULL,
      version TEXT NOT NULL,
      display_name TEXT NOT NULL,
      publisher TEXT,
      intune_app_id TEXT NOT NULL,
      intune_app_url TEXT,
      intune_tenant_id TEXT,
      app_source TEXT DEFAULT 'win32',
      deployed_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (packaging_job_id) REFERENCES packaging_jobs(id)
    )
  `);

  const existingUploadHistoryColumns = new Set(
    (db.pragma('table_info(upload_history)') as Array<{ name: string }>).map((column) => column.name),
  );
  if (!existingUploadHistoryColumns.has('app_source')) {
    db.exec(`ALTER TABLE upload_history ADD COLUMN app_source TEXT DEFAULT 'win32'`);
  }

  // Create index for upload_history
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_upload_history_user_id ON upload_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_upload_history_deployed_at ON upload_history(deployed_at);
  `);

  // Create device_health_snapshots table
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_health_snapshots (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      total_devices INTEGER NOT NULL DEFAULT 0,
      compliant_count INTEGER NOT NULL DEFAULT 0,
      noncompliant_count INTEGER NOT NULL DEFAULT 0,
      in_grace_period_count INTEGER NOT NULL DEFAULT 0,
      config_manager_count INTEGER NOT NULL DEFAULT 0,
      unknown_count INTEGER NOT NULL DEFAULT 0,
      stale_count INTEGER NOT NULL DEFAULT 0,
      partial INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tenant_id, snapshot_date)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_device_health_snapshots_tenant_date ON device_health_snapshots(tenant_id, snapshot_date);
  `);

  // Create fleet_app_inventory table
  db.exec(`
    CREATE TABLE IF NOT EXISTS fleet_app_inventory (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      app_key TEXT NOT NULL,
      display_name TEXT NOT NULL,
      publisher TEXT,
      device_count INTEGER NOT NULL DEFAULT 0,
      devices_total INTEGER NOT NULL DEFAULT 0,
      partial INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tenant_id, snapshot_date, app_key)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_fleet_app_inventory_tenant_date_count ON fleet_app_inventory(tenant_id, snapshot_date, device_count);
  `);

  // Create update_check_results table
  db.exec(`
    CREATE TABLE IF NOT EXISTS update_check_results (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      winget_id TEXT NOT NULL,
      intune_app_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      current_version TEXT NOT NULL,
      latest_version TEXT NOT NULL,
      is_critical INTEGER NOT NULL DEFAULT 0,
      is_managed INTEGER NOT NULL DEFAULT 1,
      large_icon_type TEXT,
      large_icon_value TEXT,
      notified_at TEXT,
      dismissed_at TEXT,
      detected_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, tenant_id, winget_id, intune_app_id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_update_check_results_user ON update_check_results(user_id);
  `);

  // Create deployment_drift_results table
  db.exec(`
    CREATE TABLE IF NOT EXISTS deployment_drift_results (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      winget_id TEXT NOT NULL,
      intune_app_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      expected_version TEXT NOT NULL,
      total_devices_scanned INTEGER NOT NULL DEFAULT 0,
      on_expected_count INTEGER NOT NULL DEFAULT 0,
      behind_count INTEGER NOT NULL DEFAULT 0,
      ahead_count INTEGER NOT NULL DEFAULT 0,
      partial INTEGER NOT NULL DEFAULT 0,
      scanned_at TEXT NOT NULL,
      UNIQUE(user_id, tenant_id, winget_id, intune_app_id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_deployment_drift_results_user ON deployment_drift_results(user_id);
  `);

  // Create device_bios_info table - a current-state cache (one row per
  // device, upserted in place), not a daily-accumulating snapshot.
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_bios_info (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      bios_version TEXT,
      captured_at TEXT NOT NULL,
      UNIQUE(tenant_id, device_id)
    )
  `);

  // Battery/storage fields added after the table's initial release - same
  // per-device hardwareInformation fetch already made for BIOS, just more
  // columns kept from that one response (see bios-snapshot.ts).
  const existingBiosColumns = new Set(
    (db.pragma('table_info(device_bios_info)') as Array<{ name: string }>).map((column) => column.name),
  );
  const biosCompatibleColumns: Record<string, string> = {
    battery_health_percentage: 'REAL',
    battery_charge_cycles: 'INTEGER',
    total_storage_bytes: 'INTEGER',
    free_storage_bytes: 'INTEGER',
  };
  for (const [column, definition] of Object.entries(biosCompatibleColumns)) {
    if (!existingBiosColumns.has(column)) {
      db.exec(`ALTER TABLE device_bios_info ADD COLUMN ${column} ${definition}`);
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_device_bios_info_tenant ON device_bios_info(tenant_id);
  `);

  // Create autopilot_device_snapshots table - a current-state cache (one row
  // per Autopilot device identity, upserted in place), same shape as
  // device_bios_info: a live registration/enrollment snapshot, not a
  // daily-accumulating time series.
  db.exec(`
    CREATE TABLE IF NOT EXISTS autopilot_device_snapshots (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      serial_number TEXT,
      group_tag TEXT,
      manufacturer TEXT,
      model TEXT,
      enrollment_state TEXT NOT NULL,
      deployment_profile_assignment_status TEXT NOT NULL,
      last_contacted_at TEXT,
      captured_at TEXT NOT NULL,
      UNIQUE(tenant_id, device_id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_autopilot_device_snapshots_tenant ON autopilot_device_snapshots(tenant_id);
  `);

  // Create user_office_locations table - a current-state cache (one row per
  // user, upserted in place), not a daily-accumulating snapshot. Keyed by
  // user rather than device since many devices share a primary user.
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_office_locations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_principal_name TEXT NOT NULL,
      office_location TEXT,
      captured_at TEXT NOT NULL,
      UNIQUE(tenant_id, user_principal_name)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_office_locations_tenant ON user_office_locations(tenant_id);
  `);

  // Maps each device to its tool-managed single-device Entra ID group, since
  // Intune's Windows Update Graph resources only support group assignment.
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_update_groups (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      azure_ad_device_id TEXT NOT NULL,
      entra_group_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(tenant_id, device_id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_device_update_groups_tenant ON device_update_groups(tenant_id);
  `);
}

/**
 * Parse JSON fields from database row
 */
function parseJobRow(row: Record<string, unknown>): PackagingJob {
  return {
    ...row,
    detection_rules: row.detection_rules ? JSON.parse(row.detection_rules as string) : null,
    package_config: row.package_config ? JSON.parse(row.package_config as string) : null,
    encryption_info: row.encryption_info ? JSON.parse(row.encryption_info as string) : null,
    error_details: row.error_details ? JSON.parse(row.error_details as string) : null,
    warnings: row.warnings ? JSON.parse(row.warnings as string) : null,
  } as PackagingJob;
}

/**
 * SQLite implementation of the database adapter
 */
export const sqliteDb: DatabaseAdapter = {
  jobs: {
    /**
     * Get jobs by status
     */
    async getByStatus(status: string, limit: number = 10, ascending: boolean = true): Promise<PackagingJob[]> {
      const database = getDb();
      const order = ascending ? 'ASC' : 'DESC';
      const stmt = database.prepare(`
        SELECT * FROM packaging_jobs
        WHERE status = ? AND archived_at IS NULL
        ORDER BY created_at ${order}
        LIMIT ?
      `);
      const rows = stmt.all(status, limit) as Record<string, unknown>[];
      return rows.map(parseJobRow);
    },

    /**
     * Get a job by ID
     */
    async getById(id: string): Promise<PackagingJob | null> {
      const database = getDb();
      const stmt = database.prepare('SELECT * FROM packaging_jobs WHERE id = ?');
      const row = stmt.get(id) as Record<string, unknown> | undefined;
      return row ? parseJobRow(row) : null;
    },

    /**
     * Get jobs by user ID
     * Auto-excludes terminal-state jobs older than 7 days
     */
    async getByUserId(userId: string, limit: number = 50): Promise<PackagingJob[]> {
      const database = getDb();
      // Return the most recent jobs for the user with no age cutoff, so the
      // Uploads (all activities) view shows older completed deployments too.
      const stmt = database.prepare(`
        SELECT * FROM packaging_jobs
        WHERE user_id = ? AND archived_at IS NULL
        ORDER BY created_at DESC
        LIMIT ?
      `);
      const rows = stmt.all(userId, limit) as Record<string, unknown>[];
      return rows.map(parseJobRow);
    },

    async getByTenantId(tenantId: string, limit: number = 50): Promise<PackagingJob[]> {
      const database = getDb();
      // Every user's jobs in this tenant, most recent first, no age cutoff.
      const stmt = database.prepare(`
        SELECT * FROM packaging_jobs
        WHERE tenant_id = ? AND archived_at IS NULL
        ORDER BY created_at DESC
        LIMIT ?
      `);
      const rows = stmt.all(tenantId, limit) as Record<string, unknown>[];
      return rows.map(parseJobRow);
    },

    /**
     * Create a new job
     */
    async create(job: Partial<PackagingJob>): Promise<PackagingJob> {
      const database = getDb();
      const id = job.id || crypto.randomUUID();
      const now = new Date().toISOString();

      const stmt = database.prepare(`
        INSERT INTO packaging_jobs (
          id, user_id, user_email, tenant_id, winget_id, version, display_name,
          publisher, architecture, installer_type, installer_url, installer_sha256,
          install_command, uninstall_command, install_scope, detection_rules,
          package_config, app_source, status, progress_percent, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `);

      stmt.run(
        id,
        job.user_id,
        job.user_email || null,
        job.tenant_id || null,
        job.winget_id,
        job.version,
        job.display_name,
        job.publisher || null,
        job.architecture || null,
        job.installer_type,
        job.installer_url,
        job.installer_sha256 || null,
        job.install_command || null,
        job.uninstall_command || null,
        job.install_scope || null,
        job.detection_rules ? JSON.stringify(job.detection_rules) : null,
        job.package_config ? JSON.stringify(job.package_config) : null,
        job.app_source || 'win32',
        job.status || 'queued',
        job.progress_percent || 0,
        now,
        now
      );

      return this.getById(id) as Promise<PackagingJob>;
    },

    /**
     * Update a job
     */
    async update(id: string, data: Partial<PackagingJob>, conditions?: Record<string, unknown>): Promise<PackagingJob | null> {
      const database = getDb();
      const now = new Date().toISOString();

      // Build the SET clause
      const updates: string[] = ['updated_at = ?'];
      const values: unknown[] = [now];

      for (const [key, value] of Object.entries(data)) {
        if (key === 'detection_rules' || key === 'package_config' || key === 'encryption_info' || key === 'warnings' || key === 'error_details') {
          updates.push(`${key} = ?`);
          values.push(value ? JSON.stringify(value) : null);
        } else {
          updates.push(`${key} = ?`);
          values.push(value);
        }
      }

      // Build the WHERE clause
      let whereClause = 'id = ?';
      values.push(id);

      if (conditions) {
        for (const [key, value] of Object.entries(conditions)) {
          if (value === null) {
            whereClause += ` AND ${key} IS NULL`;
          } else {
            whereClause += ` AND ${key} = ?`;
            values.push(value);
          }
        }
      }

      const stmt = database.prepare(`
        UPDATE packaging_jobs
        SET ${updates.join(', ')}
        WHERE ${whereClause}
      `);

      const result = stmt.run(...values);

      // Check if the update was successful
      if (result.changes === 0) {
        return null;
      }

      return this.getById(id);
    },

    /**
     * Claim a job atomically (only if status is 'queued')
     */
    async claim(jobId: string, packagerId: string): Promise<PackagingJob | null> {
      const now = new Date().toISOString();

      return this.update(
        jobId,
        {
          status: 'packaging',
          packager_id: packagerId,
          packager_heartbeat_at: now,
          claimed_at: now,
          packaging_started_at: now,
        },
        { status: 'queued' }
      );
    },

    /**
     * Release a job back to queued state
     */
    async release(jobId: string, packagerId: string): Promise<PackagingJob | null> {
      return this.update(
        jobId,
        {
          status: 'queued',
          packager_id: null,
          packager_heartbeat_at: null,
          claimed_at: null,
          packaging_started_at: null,
        },
        { packager_id: packagerId }
      );
    },

    /**
     * Force release a stale job back to queued state (no packager_id check)
     */
    async forceRelease(jobId: string): Promise<PackagingJob | null> {
      const database = getDb();
      const stmt = database.prepare(`
        UPDATE packaging_jobs
        SET status = 'queued',
            packager_id = NULL,
            packager_heartbeat_at = NULL,
            claimed_at = NULL,
            packaging_started_at = NULL,
            updated_at = ?
        WHERE id = ?
      `);

      const result = stmt.run(new Date().toISOString(), jobId);

      if (result.changes === 0) {
        return null;
      }

      return this.getById(jobId);
    },

    /**
     * Get stale jobs (packaging status with old heartbeat)
     */
    async getStaleJobs(staleThreshold: Date): Promise<PackagingJob[]> {
      const database = getDb();
      const stmt = database.prepare(`
        SELECT * FROM packaging_jobs
        WHERE status = 'packaging'
        AND packager_heartbeat_at < ?
      `);
      const rows = stmt.all(staleThreshold.toISOString()) as Record<string, unknown>[];
      return rows.map(parseJobRow);
    },

    /**
     * Get job statistics
     */
    async getStats(): Promise<{
      queued: number;
      packaging: number;
      uploading: number;
      deployed: number;
      failed: number;
      cancelled: number;
    }> {
      const database = getDb();
      const stmt = database.prepare(`
        SELECT status, COUNT(*) as count
        FROM packaging_jobs
        WHERE archived_at IS NULL
        GROUP BY status
      `);
      const rows = stmt.all() as Array<{ status: string; count: number }>;

      const stats = {
        queued: 0,
        packaging: 0,
        uploading: 0,
        deployed: 0,
        failed: 0,
        cancelled: 0,
      };

      for (const row of rows) {
        if (row.status in stats) {
          stats[row.status as keyof typeof stats] = row.count;
        }
      }

      return stats;
    },

    /** Soft-archive a single job by ID. */
    async deleteById(id: string): Promise<boolean> {
      const database = getDb();
      const now = new Date().toISOString();
      const stmt = database.prepare(
        'UPDATE packaging_jobs SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL',
      );
      const result = stmt.run(now, now, id);
      return result.changes > 0;
    },

    /** Bulk-archive jobs matching a user ID and a set of statuses. */
    async deleteByUserIdAndStatuses(userId: string, statuses: string[]): Promise<number> {
      const database = getDb();
      const placeholders = statuses.map(() => '?').join(', ');
      const stmt = database.prepare(`
        UPDATE packaging_jobs
        SET archived_at = ?, updated_at = ?
        WHERE user_id = ? AND status IN (${placeholders}) AND archived_at IS NULL
      `);
      const now = new Date().toISOString();
      const result = stmt.run(now, now, userId, ...statuses);
      return result.changes;
    },
  },

  uploadHistory: {
    /**
     * Create an upload history record
     */
    async create(record: Partial<UploadHistoryRecord>): Promise<UploadHistoryRecord> {
      const database = getDb();
      const id = record.id || crypto.randomUUID();
      const now = new Date().toISOString();

      const stmt = database.prepare(`
        INSERT INTO upload_history (
          id, packaging_job_id, user_id, winget_id, version, display_name,
          publisher, intune_app_id, intune_app_url, intune_tenant_id, deployed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        record.packaging_job_id || null,
        record.user_id,
        record.winget_id,
        record.version,
        record.display_name,
        record.publisher || null,
        record.intune_app_id,
        record.intune_app_url || null,
        record.intune_tenant_id || null,
        record.deployed_at || now
      );

      const result = database.prepare('SELECT * FROM upload_history WHERE id = ?').get(id);
      return result as UploadHistoryRecord;
    },

    /**
     * Get upload history by user ID
     */
    async getByUserId(userId: string, limit: number = 50): Promise<UploadHistoryRecord[]> {
      const database = getDb();
      const stmt = database.prepare(`
        SELECT * FROM upload_history
        WHERE user_id = ?
        ORDER BY deployed_at DESC
        LIMIT ?
      `);
      return stmt.all(userId, limit) as UploadHistoryRecord[];
    },

    async getDistinctUserTenantPairs(): Promise<Array<{ user_id: string; intune_tenant_id: string | null }>> {
      const database = getDb();
      return database
        .prepare('SELECT DISTINCT user_id, intune_tenant_id FROM upload_history WHERE intune_tenant_id IS NOT NULL')
        .all() as Array<{ user_id: string; intune_tenant_id: string | null }>;
    },
  },

  deviceHealthSnapshots: {
    async upsert(snapshot: Omit<DeviceHealthSnapshot, 'id' | 'created_at'>): Promise<DeviceHealthSnapshot> {
      const database = getDb();
      const id = crypto.randomUUID();

      const stmt = database.prepare(`
        INSERT INTO device_health_snapshots (
          id, tenant_id, snapshot_date, captured_at, total_devices, compliant_count,
          noncompliant_count, in_grace_period_count, config_manager_count, unknown_count,
          stale_count, partial
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, snapshot_date) DO UPDATE SET
          captured_at = excluded.captured_at,
          total_devices = excluded.total_devices,
          compliant_count = excluded.compliant_count,
          noncompliant_count = excluded.noncompliant_count,
          in_grace_period_count = excluded.in_grace_period_count,
          config_manager_count = excluded.config_manager_count,
          unknown_count = excluded.unknown_count,
          stale_count = excluded.stale_count,
          partial = excluded.partial
      `);

      stmt.run(
        id,
        snapshot.tenant_id,
        snapshot.snapshot_date,
        snapshot.captured_at,
        snapshot.total_devices,
        snapshot.compliant_count,
        snapshot.noncompliant_count,
        snapshot.in_grace_period_count,
        snapshot.config_manager_count,
        snapshot.unknown_count,
        snapshot.stale_count,
        snapshot.partial ? 1 : 0
      );

      const row = database
        .prepare('SELECT * FROM device_health_snapshots WHERE tenant_id = ? AND snapshot_date = ?')
        .get(snapshot.tenant_id, snapshot.snapshot_date) as Record<string, unknown>;
      return { ...row, partial: !!row.partial } as DeviceHealthSnapshot;
    },

    async getByTenantId(tenantId: string, sinceDate: string): Promise<DeviceHealthSnapshot[]> {
      const database = getDb();
      const stmt = database.prepare(`
        SELECT * FROM device_health_snapshots
        WHERE tenant_id = ? AND snapshot_date >= ?
        ORDER BY snapshot_date ASC
      `);
      const rows = stmt.all(tenantId, sinceDate) as Record<string, unknown>[];
      return rows.map((row) => ({ ...row, partial: !!row.partial }) as DeviceHealthSnapshot);
    },

    async getLatest(tenantId: string): Promise<DeviceHealthSnapshot | null> {
      const database = getDb();
      const row = database
        .prepare('SELECT * FROM device_health_snapshots WHERE tenant_id = ? ORDER BY snapshot_date DESC LIMIT 1')
        .get(tenantId) as Record<string, unknown> | undefined;
      return row ? ({ ...row, partial: !!row.partial } as DeviceHealthSnapshot) : null;
    },

    async deleteOlderThan(cutoffDate: string): Promise<number> {
      const database = getDb();
      const result = database
        .prepare('DELETE FROM device_health_snapshots WHERE snapshot_date < ?')
        .run(cutoffDate);
      return result.changes;
    },

    async getKnownTenantIds(): Promise<string[]> {
      const database = getDb();
      const rows = database
        .prepare('SELECT DISTINCT tenant_id FROM packaging_jobs WHERE tenant_id IS NOT NULL')
        .all() as Array<{ tenant_id: string }>;
      return rows.map((row) => row.tenant_id);
    },
  },

  fleetAppInventory: {
    async replaceForDate(
      tenantId: string,
      snapshotDate: string,
      rows: Array<Omit<FleetAppInventoryRow, 'id' | 'created_at' | 'tenant_id' | 'snapshot_date'>>
    ): Promise<void> {
      const database = getDb();
      const deleteStmt = database.prepare(
        'DELETE FROM fleet_app_inventory WHERE tenant_id = ? AND snapshot_date = ?'
      );
      const insertStmt = database.prepare(`
        INSERT INTO fleet_app_inventory (
          id, tenant_id, snapshot_date, captured_at, app_key, display_name, publisher,
          device_count, devices_total, partial
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const runReplace = database.transaction(() => {
        deleteStmt.run(tenantId, snapshotDate);
        for (const row of rows) {
          insertStmt.run(
            crypto.randomUUID(),
            tenantId,
            snapshotDate,
            row.captured_at,
            row.app_key,
            row.display_name,
            row.publisher,
            row.device_count,
            row.devices_total,
            row.partial ? 1 : 0
          );
        }
      });
      runReplace();
    },

    async getLatestForTenant(tenantId: string, limit: number = 20): Promise<FleetAppInventoryRow[]> {
      const database = getDb();
      const latestDateRow = database
        .prepare('SELECT MAX(snapshot_date) as snapshot_date FROM fleet_app_inventory WHERE tenant_id = ?')
        .get(tenantId) as { snapshot_date: string | null } | undefined;

      if (!latestDateRow?.snapshot_date) return [];

      const rows = database
        .prepare(
          'SELECT * FROM fleet_app_inventory WHERE tenant_id = ? AND snapshot_date = ? ORDER BY device_count DESC LIMIT ?'
        )
        .all(tenantId, latestDateRow.snapshot_date, limit) as Record<string, unknown>[];

      return rows.map((row) => ({ ...row, partial: !!row.partial }) as FleetAppInventoryRow);
    },

    async deleteOlderThan(cutoffDate: string): Promise<number> {
      const database = getDb();
      const result = database
        .prepare('DELETE FROM fleet_app_inventory WHERE snapshot_date < ?')
        .run(cutoffDate);
      return result.changes;
    },
  },

  updateCheckResults: {
    async upsertMany(rows: Array<Omit<UpdateCheckResultRecord, 'id'>>): Promise<void> {
      if (rows.length === 0) return;
      const database = getDb();
      const stmt = database.prepare(`
        INSERT INTO update_check_results (
          id, user_id, tenant_id, winget_id, intune_app_id, display_name,
          current_version, latest_version, is_critical, is_managed,
          large_icon_type, large_icon_value, notified_at, dismissed_at,
          detected_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, tenant_id, winget_id, intune_app_id) DO UPDATE SET
          display_name = excluded.display_name,
          current_version = excluded.current_version,
          latest_version = excluded.latest_version,
          is_critical = excluded.is_critical,
          is_managed = excluded.is_managed,
          large_icon_type = excluded.large_icon_type,
          large_icon_value = excluded.large_icon_value,
          notified_at = excluded.notified_at,
          detected_at = excluded.detected_at,
          updated_at = excluded.updated_at
      `);

      const runUpsert = database.transaction(() => {
        for (const row of rows) {
          stmt.run(
            crypto.randomUUID(),
            row.user_id,
            row.tenant_id,
            row.winget_id,
            row.intune_app_id,
            row.display_name,
            row.current_version,
            row.latest_version,
            row.is_critical ? 1 : 0,
            row.is_managed ? 1 : 0,
            row.large_icon_type,
            row.large_icon_value,
            row.notified_at,
            row.dismissed_at,
            row.detected_at,
            row.updated_at
          );
        }
      });
      runUpsert();
    },

    async getByUserId(
      userId: string,
      opts: { tenantId?: string; includeDismissed?: boolean; criticalOnly?: boolean } = {}
    ): Promise<UpdateCheckResultRecord[]> {
      const database = getDb();
      const conditions = ['user_id = ?'];
      const params: unknown[] = [userId];

      if (opts.tenantId) {
        conditions.push('tenant_id = ?');
        params.push(opts.tenantId);
      }
      if (!opts.includeDismissed) {
        conditions.push('dismissed_at IS NULL');
      }
      if (opts.criticalOnly) {
        conditions.push('is_critical = 1');
      }

      const rows = database
        .prepare(`SELECT * FROM update_check_results WHERE ${conditions.join(' AND ')} ORDER BY detected_at DESC`)
        .all(...params) as Record<string, unknown>[];

      return rows.map((row) => rowToUpdateCheckResult(row));
    },

    async getByUserIds(userIds: string[]): Promise<UpdateCheckResultRecord[]> {
      if (userIds.length === 0) return [];
      const database = getDb();
      const placeholders = userIds.map(() => '?').join(', ');
      const rows = database
        .prepare(`SELECT * FROM update_check_results WHERE user_id IN (${placeholders})`)
        .all(...userIds) as Record<string, unknown>[];
      return rows.map((row) => rowToUpdateCheckResult(row));
    },

    async setDismissed(ids: string[], userId: string, dismissed: boolean): Promise<number> {
      if (ids.length === 0) return 0;
      const database = getDb();
      const placeholders = ids.map(() => '?').join(', ');
      const now = new Date().toISOString();
      const result = database
        .prepare(
          `UPDATE update_check_results SET dismissed_at = ?, updated_at = ? WHERE user_id = ? AND id IN (${placeholders})`
        )
        .run(dismissed ? now : null, now, userId, ...ids);
      return result.changes;
    },

    async deleteByIds(ids: string[]): Promise<number> {
      if (ids.length === 0) return 0;
      const database = getDb();
      const placeholders = ids.map(() => '?').join(', ');
      const result = database.prepare(`DELETE FROM update_check_results WHERE id IN (${placeholders})`).run(...ids);
      return result.changes;
    },

    async deleteByUserTenantWinget(userId: string, tenantId: string, wingetId: string): Promise<number> {
      const database = getDb();
      const result = database
        .prepare('DELETE FROM update_check_results WHERE user_id = ? AND tenant_id = ? AND winget_id = ?')
        .run(userId, tenantId, wingetId);
      return result.changes;
    },

    async deleteOlderThan(cutoffDate: string): Promise<number> {
      const database = getDb();
      const result = database
        .prepare('DELETE FROM update_check_results WHERE detected_at < ?')
        .run(cutoffDate);
      return result.changes;
    },
  },

  deploymentDrift: {
    async upsertMany(rows: Array<Omit<DeploymentDriftRecord, 'id'>>): Promise<void> {
      if (rows.length === 0) return;
      const database = getDb();
      const stmt = database.prepare(`
        INSERT INTO deployment_drift_results (
          id, user_id, tenant_id, winget_id, intune_app_id, display_name,
          expected_version, total_devices_scanned, on_expected_count,
          behind_count, ahead_count, partial, scanned_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, tenant_id, winget_id, intune_app_id) DO UPDATE SET
          display_name = excluded.display_name,
          expected_version = excluded.expected_version,
          total_devices_scanned = excluded.total_devices_scanned,
          on_expected_count = excluded.on_expected_count,
          behind_count = excluded.behind_count,
          ahead_count = excluded.ahead_count,
          partial = excluded.partial,
          scanned_at = excluded.scanned_at
      `);

      const runUpsert = database.transaction(() => {
        for (const row of rows) {
          stmt.run(
            crypto.randomUUID(),
            row.user_id,
            row.tenant_id,
            row.winget_id,
            row.intune_app_id,
            row.display_name,
            row.expected_version,
            row.total_devices_scanned,
            row.on_expected_count,
            row.behind_count,
            row.ahead_count,
            row.partial ? 1 : 0,
            row.scanned_at
          );
        }
      });
      runUpsert();
    },

    async getByUserId(
      userId: string,
      opts: { tenantId?: string } = {}
    ): Promise<DeploymentDriftRecord[]> {
      const database = getDb();
      const conditions = ['user_id = ?'];
      const params: unknown[] = [userId];

      if (opts.tenantId) {
        conditions.push('tenant_id = ?');
        params.push(opts.tenantId);
      }

      const rows = database
        .prepare(`SELECT * FROM deployment_drift_results WHERE ${conditions.join(' AND ')}`)
        .all(...params) as Record<string, unknown>[];

      return rows.map((row) => rowToDeploymentDrift(row));
    },

    async deleteOlderThan(cutoffDate: string): Promise<number> {
      const database = getDb();
      const result = database
        .prepare('DELETE FROM deployment_drift_results WHERE scanned_at < ?')
        .run(cutoffDate);
      return result.changes;
    },
  },

  deviceBiosInfo: {
    async upsertMany(rows: Array<Omit<DeviceBiosInfoRecord, 'id'>>): Promise<void> {
      if (rows.length === 0) return;
      const database = getDb();
      const stmt = database.prepare(`
        INSERT INTO device_bios_info (
          id, tenant_id, device_id, bios_version,
          battery_health_percentage, battery_charge_cycles, total_storage_bytes, free_storage_bytes,
          captured_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, device_id) DO UPDATE SET
          bios_version = excluded.bios_version,
          battery_health_percentage = excluded.battery_health_percentage,
          battery_charge_cycles = excluded.battery_charge_cycles,
          total_storage_bytes = excluded.total_storage_bytes,
          free_storage_bytes = excluded.free_storage_bytes,
          captured_at = excluded.captured_at
      `);

      const runUpsert = database.transaction(() => {
        for (const row of rows) {
          stmt.run(
            crypto.randomUUID(),
            row.tenant_id,
            row.device_id,
            row.bios_version,
            row.battery_health_percentage,
            row.battery_charge_cycles,
            row.total_storage_bytes,
            row.free_storage_bytes,
            row.captured_at
          );
        }
      });
      runUpsert();
    },

    async getByTenantId(tenantId: string): Promise<DeviceBiosInfoRecord[]> {
      const database = getDb();
      const rows = database
        .prepare('SELECT * FROM device_bios_info WHERE tenant_id = ?')
        .all(tenantId) as Record<string, unknown>[];
      return rows as unknown as DeviceBiosInfoRecord[];
    },

    async pruneRemoved(tenantId: string, currentDeviceIds: string[]): Promise<number> {
      const database = getDb();
      if (currentDeviceIds.length === 0) {
        const result = database.prepare('DELETE FROM device_bios_info WHERE tenant_id = ?').run(tenantId);
        return result.changes;
      }
      const placeholders = currentDeviceIds.map(() => '?').join(', ');
      const result = database
        .prepare(`DELETE FROM device_bios_info WHERE tenant_id = ? AND device_id NOT IN (${placeholders})`)
        .run(tenantId, ...currentDeviceIds);
      return result.changes;
    },
  },

  autopilotDeviceSnapshots: {
    async upsertMany(rows: Array<Omit<AutopilotDeviceSnapshotRecord, 'id'>>): Promise<void> {
      if (rows.length === 0) return;
      const database = getDb();
      const stmt = database.prepare(`
        INSERT INTO autopilot_device_snapshots (
          id, tenant_id, device_id, serial_number, group_tag, manufacturer, model,
          enrollment_state, deployment_profile_assignment_status, last_contacted_at, captured_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, device_id) DO UPDATE SET
          serial_number = excluded.serial_number,
          group_tag = excluded.group_tag,
          manufacturer = excluded.manufacturer,
          model = excluded.model,
          enrollment_state = excluded.enrollment_state,
          deployment_profile_assignment_status = excluded.deployment_profile_assignment_status,
          last_contacted_at = excluded.last_contacted_at,
          captured_at = excluded.captured_at
      `);

      const runUpsert = database.transaction(() => {
        for (const row of rows) {
          stmt.run(
            crypto.randomUUID(),
            row.tenant_id,
            row.device_id,
            row.serial_number,
            row.group_tag,
            row.manufacturer,
            row.model,
            row.enrollment_state,
            row.deployment_profile_assignment_status,
            row.last_contacted_at,
            row.captured_at
          );
        }
      });
      runUpsert();
    },

    async getByTenantId(tenantId: string): Promise<AutopilotDeviceSnapshotRecord[]> {
      const database = getDb();
      const rows = database
        .prepare('SELECT * FROM autopilot_device_snapshots WHERE tenant_id = ?')
        .all(tenantId) as Record<string, unknown>[];
      return rows as unknown as AutopilotDeviceSnapshotRecord[];
    },

    async pruneRemoved(tenantId: string, currentDeviceIds: string[]): Promise<number> {
      const database = getDb();
      if (currentDeviceIds.length === 0) {
        const result = database.prepare('DELETE FROM autopilot_device_snapshots WHERE tenant_id = ?').run(tenantId);
        return result.changes;
      }
      const placeholders = currentDeviceIds.map(() => '?').join(', ');
      const result = database
        .prepare(`DELETE FROM autopilot_device_snapshots WHERE tenant_id = ? AND device_id NOT IN (${placeholders})`)
        .run(tenantId, ...currentDeviceIds);
      return result.changes;
    },
  },

  userOfficeLocations: {
    async upsertMany(rows: Array<Omit<UserOfficeLocationRecord, 'id'>>): Promise<void> {
      if (rows.length === 0) return;
      const database = getDb();
      const stmt = database.prepare(`
        INSERT INTO user_office_locations (id, tenant_id, user_principal_name, office_location, captured_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, user_principal_name) DO UPDATE SET
          office_location = excluded.office_location,
          captured_at = excluded.captured_at
      `);

      const runUpsert = database.transaction(() => {
        for (const row of rows) {
          stmt.run(crypto.randomUUID(), row.tenant_id, row.user_principal_name, row.office_location, row.captured_at);
        }
      });
      runUpsert();
    },

    async getByTenantId(tenantId: string): Promise<UserOfficeLocationRecord[]> {
      const database = getDb();
      const rows = database
        .prepare('SELECT * FROM user_office_locations WHERE tenant_id = ?')
        .all(tenantId) as Record<string, unknown>[];
      return rows as unknown as UserOfficeLocationRecord[];
    },

    async pruneRemoved(tenantId: string, currentUserPrincipalNames: string[]): Promise<number> {
      const database = getDb();
      if (currentUserPrincipalNames.length === 0) {
        const result = database.prepare('DELETE FROM user_office_locations WHERE tenant_id = ?').run(tenantId);
        return result.changes;
      }
      const placeholders = currentUserPrincipalNames.map(() => '?').join(', ');
      const result = database
        .prepare(`DELETE FROM user_office_locations WHERE tenant_id = ? AND user_principal_name NOT IN (${placeholders})`)
        .run(tenantId, ...currentUserPrincipalNames);
      return result.changes;
    },
  },

  deviceUpdateGroups: {
    async getByDeviceId(tenantId: string, deviceId: string): Promise<DeviceUpdateGroupRecord | null> {
      const database = getDb();
      const row = database
        .prepare('SELECT * FROM device_update_groups WHERE tenant_id = ? AND device_id = ?')
        .get(tenantId, deviceId) as Record<string, unknown> | undefined;
      return (row as unknown as DeviceUpdateGroupRecord) || null;
    },

    async upsert(row: Omit<DeviceUpdateGroupRecord, 'id' | 'created_at'>): Promise<DeviceUpdateGroupRecord> {
      const database = getDb();
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      // Deliberately does not update entra_group_id on conflict - a
      // concurrent racer's insert must never overwrite an already-persisted
      // group, so the first writer wins and a losing caller can detect the
      // mismatch and clean up its own now-orphaned Entra group (see
      // ensureDeviceUpdateGroup).
      database
        .prepare(
          `INSERT INTO device_update_groups (id, tenant_id, device_id, azure_ad_device_id, entra_group_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(tenant_id, device_id) DO UPDATE SET
             azure_ad_device_id = excluded.azure_ad_device_id`
        )
        .run(id, row.tenant_id, row.device_id, row.azure_ad_device_id, row.entra_group_id, createdAt);
      return (await sqliteDb.deviceUpdateGroups.getByDeviceId(row.tenant_id, row.device_id))!;
    },
  },
};

function rowToUpdateCheckResult(row: Record<string, unknown>): UpdateCheckResultRecord {
  return {
    ...row,
    is_critical: !!row.is_critical,
    is_managed: !!row.is_managed,
  } as UpdateCheckResultRecord;
}

function rowToDeploymentDrift(row: Record<string, unknown>): DeploymentDriftRecord {
  return {
    ...row,
    partial: !!row.partial,
  } as DeploymentDriftRecord;
}

/**
 * Close the database connection (for cleanup)
 */
export function closeSqliteDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
