/**
 * Supabase Database Adapter
 * Wraps the existing Supabase client to conform to the DatabaseAdapter interface
 */

import { createServerClient } from '@/lib/supabase';
import type { DatabaseAdapter, PackagingJob, UploadHistoryRecord, JobStats, DeviceHealthSnapshot, FleetAppInventoryRow, UpdateCheckResultRecord, DeploymentDriftRecord, DeviceBiosInfoRecord, AutopilotDeviceSnapshotRecord, UserOfficeLocationRecord, DeviceUpdateGroupRecord } from './types';
import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Type guard to check if a response is an error
 */
function isError(error: PostgrestError | null): error is PostgrestError {
  return error !== null;
}

function isMissingArchiveColumn(error: PostgrestError | null): boolean {
  return Boolean(error?.message?.includes('archived_at'));
}

/**
 * Quote a single value for use inside a PostgREST `in.(...)` filter list.
 * Without this, a device id or UPN containing a comma, parenthesis, or
 * quote breaks the filter syntax (or silently mis-matches), corrupting the
 * prune step for that tenant.
 */
function quotePostgrestListValue(value: string): string {
  return `"${value.replace(/"/g, '')}"`;
}

// PostgREST caps the rows returned by a single request (commonly 1000)
// regardless of how many rows actually match. Any read that needs the
// COMPLETE result set (not just one caller-facing page) must page through
// with .range() itself rather than issuing one unbounded select() - a
// fleet-sized tenant (thousands of devices) would otherwise silently get
// truncated to the first page with no error or indication anything was cut.
const SUPABASE_PAGE_SIZE = 1000;

/**
 * Fetch every row matching a query by paging through with .range() until a
 * short page comes back, rather than trusting a single unbounded select()
 * to return everything. `buildQuery(offset, limit)` must return a fresh
 * query for that page each call (a Supabase query builder can't be re-used
 * across multiple .range() calls).
 */
async function fetchAllRows<T>(
  buildQuery: (offset: number, limit: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>
): Promise<T[]> {
  const allRows: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await buildQuery(offset, SUPABASE_PAGE_SIZE);
    if (error) {
      throw error;
    }
    const page = data ?? [];
    allRows.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) {
      break;
    }
    offset += SUPABASE_PAGE_SIZE;
  }
  return allRows;
}

/**
 * Helper type for query results
 */
interface QueryResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

/**
 * Helper type for count query results
 */
interface CountResult {
  count: number | null;
  error: PostgrestError | null;
}

/**
 * Query builder interface for packaging_jobs table
 */
interface PackagingJobsSelectQuery {
  eq(column: string, value: string): PackagingJobsSelectQuery;
  lt(column: string, value: string): PackagingJobsSelectQuery;
  is(column: string, value: null): PackagingJobsSelectQuery;
  order(column: string, options: { ascending: boolean }): PackagingJobsSelectQuery;
  limit(count: number): PackagingJobsSelectQuery;
  single(): Promise<QueryResult<PackagingJob>>;
  then<T>(resolve: (result: QueryResult<PackagingJob[]> & CountResult) => T): Promise<T>;
}

interface PackagingJobsUpdateQuery {
  eq(column: string, value: string): PackagingJobsUpdateQuery;
  is(column: string, value: null): PackagingJobsUpdateQuery;
  select(): {
    single(): Promise<QueryResult<PackagingJob>>;
  };
}

interface PackagingJobsQueryBuilder {
  select(columns: string, options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }): PackagingJobsSelectQuery;
  insert(data: Partial<PackagingJob>): {
    select(): {
      single(): Promise<QueryResult<PackagingJob>>;
    };
  };
  update(data: Partial<PackagingJob>): PackagingJobsUpdateQuery;
}

/**
 * Query builder interface for upload_history table
 */
interface UploadHistorySelectQuery {
  eq(column: string, value: string): UploadHistorySelectQuery;
  order(column: string, options: { ascending: boolean }): UploadHistorySelectQuery;
  limit(count: number): UploadHistorySelectQuery;
  single(): Promise<QueryResult<UploadHistoryRecord>>;
  then<T>(resolve: (result: QueryResult<UploadHistoryRecord[]>) => T): Promise<T>;
}

interface UploadHistoryQueryBuilder {
  select(columns: string): UploadHistorySelectQuery;
  insert(data: Partial<UploadHistoryRecord>): {
    select(): {
      single(): Promise<QueryResult<UploadHistoryRecord>>;
    };
  };
}

/**
 * Get a typed query builder for packaging_jobs table
 */
function getPackagingJobsQuery(supabase: ReturnType<typeof createServerClient>): PackagingJobsQueryBuilder {
  // Type assertion is needed here due to Supabase client typing limitations
  // The Database type structure doesn't fully match what supabase-js expects
  return supabase.from('packaging_jobs') as unknown as PackagingJobsQueryBuilder;
}

/**
 * Get a typed query builder for upload_history table
 */
function getUploadHistoryQuery(supabase: ReturnType<typeof createServerClient>): UploadHistoryQueryBuilder {
  // Type assertion is needed here due to Supabase client typing limitations
  return supabase.from('upload_history') as unknown as UploadHistoryQueryBuilder;
}

/**
 * Supabase implementation of the database adapter
 */
export const supabaseDb: DatabaseAdapter = {
  jobs: {
    /**
     * Get jobs by status
     */
    async getByStatus(status: string, limit: number = 10, ascending: boolean = true): Promise<PackagingJob[]> {
      const supabase = createServerClient();
      const query = getPackagingJobsQuery(supabase);

      // Exclude archived rows before the LIMIT, not after (SQLite's
      // equivalent query does this in its WHERE clause) - filtering
      // client-side after an already-limited result can silently return
      // fewer than `limit` rows whenever any of the most-recent rows
      // happen to be archived.
      const { data, error } = await query
        .select('*')
        .eq('status', status)
        .is('archived_at', null)
        .order('created_at', { ascending })
        .limit(limit);

      if (isError(error)) {
        console.error('Error fetching jobs by status:', error);
        throw error;
      }

      return data || [];
    },

    /**
     * Get a job by ID
     */
    async getById(id: string): Promise<PackagingJob | null> {
      const supabase = createServerClient();
      const query = getPackagingJobsQuery(supabase);

      const { data, error } = await query
        .select('*')
        .eq('id', id)
        .single();

      if (isError(error)) {
        if (error.code === 'PGRST116') {
          // Not found
          return null;
        }
        console.error('Error fetching job by ID:', error);
        throw error;
      }

      return data;
    },

    /**
     * Get jobs by user ID
     * Auto-excludes terminal-state jobs older than 7 days
     */
    async getByUserId(userId: string, limit: number = 50): Promise<PackagingJob[]> {
      const supabase = createServerClient();

      // Return the most recent jobs for the user with no age cutoff, so the
      // Uploads (all activities) view shows older completed deployments too.
      const { data, error } = await supabase
        .from('packaging_jobs')
        .select('*')
        .eq('user_id', userId)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (isError(error)) {
        console.error('Error fetching jobs by user ID:', error);
        throw error;
      }

      return (data as unknown as PackagingJob[]) || [];
    },

    async getByTenantId(tenantId: string, limit: number = 50): Promise<PackagingJob[]> {
      const supabase = createServerClient();

      // Every user's jobs in this tenant, most recent first, no age cutoff.
      const { data, error } = await supabase
        .from('packaging_jobs')
        .select('*')
        .eq('tenant_id', tenantId)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (isError(error)) {
        console.error('Error fetching jobs by tenant ID:', error);
        throw error;
      }

      return (data as unknown as PackagingJob[]) || [];
    },

    /**
     * Create a new job
     */
    async create(job: Partial<PackagingJob>): Promise<PackagingJob> {
      const supabase = createServerClient();
      const query = getPackagingJobsQuery(supabase);

      const insertData: Partial<PackagingJob> = {
        id: job.id || crypto.randomUUID(),
        user_id: job.user_id,
        user_email: job.user_email,
        tenant_id: job.tenant_id,
        winget_id: job.winget_id,
        version: job.version,
        display_name: job.display_name,
        publisher: job.publisher,
        architecture: job.architecture,
        installer_type: job.installer_type,
        installer_url: job.installer_url,
        installer_sha256: job.installer_sha256,
        install_command: job.install_command,
        uninstall_command: job.uninstall_command,
        install_scope: job.install_scope,
        detection_rules: job.detection_rules,
        package_config: job.package_config,
        app_source: job.app_source || 'win32',
        status: job.status || 'queued',
        progress_percent: job.progress_percent || 0,
      };

      const { data, error } = await query
        .insert(insertData)
        .select()
        .single();

      if (isError(error)) {
        console.error('Error creating job:', error);
        throw error;
      }

      if (!data) {
        throw new Error('No data returned from insert');
      }

      return data;
    },

    /**
     * Update a job
     */
    async update(id: string, updateData: Partial<PackagingJob>, conditions?: Record<string, unknown>): Promise<PackagingJob | null> {
      const supabase = createServerClient();
      const query = getPackagingJobsQuery(supabase);

      // Build the update query
      let updateQuery = query.update(updateData).eq('id', id);

      // Apply additional conditions
      if (conditions) {
        for (const [key, value] of Object.entries(conditions)) {
          if (value === null) {
            updateQuery = updateQuery.is(key, null);
          } else {
            updateQuery = updateQuery.eq(key, value as string);
          }
        }
      }

      const { data: result, error } = await updateQuery.select().single();

      if (isError(error)) {
        // If no rows were updated (e.g., condition not met), return null
        if (error.code === 'PGRST116') {
          return null;
        }
        console.error('Error updating job:', error);
        throw error;
      }

      return result;
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
     * Release a job back to queued state - conditioned on packager_id
     * ownership, matching the SQLite adapter, so a packager can only ever
     * release a job it actually claimed rather than stealing one back from
     * another in-flight packager.
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
      const supabase = createServerClient();
      const query = getPackagingJobsQuery(supabase);

      const { data, error } = await query
        .update({
          status: 'queued',
          packager_id: null,
          packager_heartbeat_at: null,
          claimed_at: null,
          packaging_started_at: null,
        })
        .eq('id', jobId)
        .select()
        .single();

      if (isError(error)) {
        if (error.code === 'PGRST116') {
          return null;
        }
        console.error('Error force releasing job:', error);
        throw error;
      }

      return data;
    },

    /**
     * Get stale jobs (packaging status with old heartbeat). Filters on
     * packager_heartbeat_at, not packaging_started_at - the heartbeat is
     * renewed throughout the run (see the packager's own PATCH /jobs calls),
     * while packaging_started_at is set once at claim time, so filtering on
     * it force-released jobs that were still actively heartbeating.
     */
    async getStaleJobs(staleThreshold: Date): Promise<PackagingJob[]> {
      const supabase = createServerClient();
      const query = getPackagingJobsQuery(supabase);

      const { data, error } = await query
        .select('*')
        .eq('status', 'packaging')
        .lt('packager_heartbeat_at', staleThreshold.toISOString());

      if (isError(error)) {
        console.error('Error fetching stale jobs:', error);
        throw error;
      }

      return data || [];
    },

    /**
     * Get job statistics
     */
    async getStats(): Promise<JobStats> {
      const supabase = createServerClient();
      const stats: JobStats = {
        queued: 0,
        packaging: 0,
        uploading: 0,
        deployed: 0,
        failed: 0,
        cancelled: 0,
      };

      // Fetch counts for each status
      for (const status of Object.keys(stats)) {
        const query = getPackagingJobsQuery(supabase);
        let { count, error } = await query
          .select('*', { count: 'exact', head: true })
          .eq('status', status)
          .is('archived_at', null);

        // Deploys can briefly run before migration 033 is applied. Keep reads
        // available during that window; archiving activates once the column exists.
        if (isMissingArchiveColumn(error)) {
          ({ count, error } = await getPackagingJobsQuery(supabase)
            .select('*', { count: 'exact', head: true })
            .eq('status', status));
        }

        if (!isError(error) && count !== null) {
          stats[status as keyof JobStats] = count;
        }
      }

      return stats;
    },

    /**
     * Soft-archive a single job by ID so upload-history references remain valid.
     */
    async deleteById(id: string): Promise<boolean> {
      const supabase = createServerClient();

      // Same guard as lib/db/sqlite.ts: only count this as a real change
      // (and only actually write) if the job wasn't already archived -
      // without it, a nonexistent id or an already-archived job both
      // silently reported success instead of the "nothing changed" false
      // callers rely on to decide whether to update their own state.
      const { data, error } = await supabase
        .from('packaging_jobs')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', id)
        .is('archived_at', null)
        .select('id');

      if (isError(error)) {
        console.error('Error archiving job:', error);
        throw error;
      }

      return (data as unknown[])?.length > 0;
    },

    /**
     * Bulk-archive jobs matching a user ID and a set of statuses.
     */
    async deleteByUserIdAndStatuses(userId: string, statuses: string[]): Promise<number> {
      const supabase = createServerClient();

      const { data, error } = await supabase
        .from('packaging_jobs')
        .update({ archived_at: new Date().toISOString() })
        .eq('user_id', userId)
        .in('status', statuses)
        .is('archived_at', null)
        .select('id');

      if (isError(error)) {
        console.error('Error bulk-archiving jobs:', error);
        throw error;
      }

      return (data as unknown[])?.length ?? 0;
    },
  },

  uploadHistory: {
    /**
     * Create an upload history record
     */
    async create(record: Partial<UploadHistoryRecord>): Promise<UploadHistoryRecord> {
      const supabase = createServerClient();
      const query = getUploadHistoryQuery(supabase);

      const insertData: Partial<UploadHistoryRecord> = {
        id: record.id || crypto.randomUUID(),
        packaging_job_id: record.packaging_job_id,
        user_id: record.user_id,
        winget_id: record.winget_id,
        version: record.version,
        display_name: record.display_name,
        publisher: record.publisher,
        intune_app_id: record.intune_app_id,
        intune_app_url: record.intune_app_url,
        intune_tenant_id: record.intune_tenant_id,
        deployed_at: record.deployed_at || new Date().toISOString(),
      };

      const { data, error } = await query
        .insert(insertData)
        .select()
        .single();

      if (isError(error)) {
        console.error('Error creating upload history:', error);
        throw error;
      }

      if (!data) {
        throw new Error('No data returned from insert');
      }

      return data;
    },

    /**
     * Get upload history by user ID
     */
    async getByUserId(userId: string, limit: number = 50): Promise<UploadHistoryRecord[]> {
      const supabase = createServerClient();
      const query = getUploadHistoryQuery(supabase);

      const { data, error } = await query
        .select('*')
        .eq('user_id', userId)
        .order('deployed_at', { ascending: false })
        .limit(limit);

      if (isError(error)) {
        console.error('Error fetching upload history:', error);
        throw error;
      }

      return data || [];
    },

    async getDistinctUserTenantPairs(): Promise<Array<{ user_id: string; intune_tenant_id: string | null }>> {
      const supabase = createServerClient();

      const { data, error } = await supabase
        .from('upload_history')
        .select('user_id, intune_tenant_id')
        .not('intune_tenant_id', 'is', null);

      if (isError(error)) {
        console.error('Error fetching distinct user/tenant pairs:', error);
        throw error;
      }

      const seen = new Set<string>();
      const pairs: Array<{ user_id: string; intune_tenant_id: string | null }> = [];
      for (const row of (data as unknown as Array<{ user_id: string; intune_tenant_id: string | null }>) || []) {
        const key = `${row.user_id}:${row.intune_tenant_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push(row);
      }
      return pairs;
    },
  },

  deviceHealthSnapshots: {
    async upsert(snapshot: Omit<DeviceHealthSnapshot, 'id' | 'created_at'>): Promise<DeviceHealthSnapshot> {
      const supabase = createServerClient();

      const { data, error } = await supabase
        .from('device_health_snapshots')
        .upsert(snapshot, { onConflict: 'tenant_id,snapshot_date' })
        .select()
        .single();

      if (isError(error)) {
        console.error('Error upserting device health snapshot:', error);
        throw error;
      }
      if (!data) {
        throw new Error('No data returned from device health snapshot upsert');
      }

      return data as DeviceHealthSnapshot;
    },

    async getByTenantId(tenantId: string, sinceDate: string): Promise<DeviceHealthSnapshot[]> {
      const supabase = createServerClient();

      const { data, error } = await supabase
        .from('device_health_snapshots')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('snapshot_date', sinceDate)
        .order('snapshot_date', { ascending: true });

      if (isError(error)) {
        console.error('Error fetching device health snapshots:', error);
        throw error;
      }

      return (data as unknown as DeviceHealthSnapshot[]) || [];
    },

    async getLatest(tenantId: string): Promise<DeviceHealthSnapshot | null> {
      const supabase = createServerClient();

      const { data, error } = await supabase
        .from('device_health_snapshots')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (isError(error)) {
        console.error('Error fetching latest device health snapshot:', error);
        throw error;
      }

      return (data as unknown as DeviceHealthSnapshot) || null;
    },

    async deleteOlderThan(cutoffDate: string): Promise<number> {
      const supabase = createServerClient();

      const { data, error } = await supabase
        .from('device_health_snapshots')
        .delete()
        .lt('snapshot_date', cutoffDate)
        .select('id');

      if (isError(error)) {
        console.error('Error pruning device health snapshots:', error);
        throw error;
      }

      return (data as unknown[])?.length ?? 0;
    },

    async getKnownTenantIds(): Promise<string[]> {
      const supabase = createServerClient();

      let rows: Array<{ tenant_id: string | null }>;
      try {
        rows = await fetchAllRows<{ tenant_id: string | null }>((offset, limit) =>
          supabase
            .from('packaging_jobs')
            .select('tenant_id')
            .not('tenant_id', 'is', null)
            .range(offset, offset + limit - 1) as unknown as PromiseLike<{
            data: Array<{ tenant_id: string | null }> | null;
            error: PostgrestError | null;
          }>
        );
      } catch (error) {
        console.error('Error fetching known tenant IDs:', error);
        throw error;
      }

      const tenantIds = new Set<string>();
      for (const row of rows) {
        if (row.tenant_id) tenantIds.add(row.tenant_id);
      }
      return Array.from(tenantIds);
    },
  },

  fleetAppInventory: {
    async replaceForDate(
      tenantId: string,
      snapshotDate: string,
      rows: Array<Omit<FleetAppInventoryRow, 'id' | 'created_at' | 'tenant_id' | 'snapshot_date'>>
    ): Promise<void> {
      const supabase = createServerClient();

      // Delete-then-insert as one Postgres function call (single
      // transaction), not two independent Supabase calls - otherwise an
      // insert failure after a successful delete wipes a tenant's daily
      // rollup with nothing replacing it. Matches the atomicity SQLite's
      // adapter already gets from wrapping both in one transaction.
      const { error } = await supabase.rpc('replace_fleet_app_inventory', {
        p_tenant_id: tenantId,
        p_snapshot_date: snapshotDate,
        p_rows: rows,
      });

      if (isError(error)) {
        console.error('Error replacing fleet app inventory rows:', error);
        throw error;
      }
    },

    async getLatestForTenant(tenantId: string, limit: number = 20): Promise<FleetAppInventoryRow[]> {
      const supabase = createServerClient();

      const { data: latestDateRow, error: latestDateError } = await supabase
        .from('fleet_app_inventory')
        .select('snapshot_date')
        .eq('tenant_id', tenantId)
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (isError(latestDateError)) {
        console.error('Error fetching latest fleet app inventory date:', latestDateError);
        throw latestDateError;
      }
      if (!latestDateRow) return [];

      const { data, error } = await supabase
        .from('fleet_app_inventory')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('snapshot_date', (latestDateRow as { snapshot_date: string }).snapshot_date)
        .order('device_count', { ascending: false })
        .limit(limit);

      if (isError(error)) {
        console.error('Error fetching fleet app inventory:', error);
        throw error;
      }

      return (data as unknown as FleetAppInventoryRow[]) || [];
    },

    async deleteOlderThan(cutoffDate: string): Promise<number> {
      const supabase = createServerClient();

      const { data, error } = await supabase
        .from('fleet_app_inventory')
        .delete()
        .lt('snapshot_date', cutoffDate)
        .select('id');

      if (isError(error)) {
        console.error('Error pruning fleet app inventory:', error);
        throw error;
      }

      return (data as unknown[])?.length ?? 0;
    },
  },

  updateCheckResults: {
    async upsertMany(rows: Array<Omit<UpdateCheckResultRecord, 'id'>>): Promise<void> {
      if (rows.length === 0) return;
      const supabase = createServerClient();

      // Supabase's upsert() always overwrites every column, unlike the
      // SQLite adapter's ON CONFLICT DO UPDATE SET (sqlite.ts), which
      // deliberately omits dismissed_at - so on Supabase the nightly
      // re-check was silently clearing a user's earlier dismissal back to
      // null. Read any existing dismissed_at first and carry it forward.
      const userTenantPairs = Array.from(
        new Set(rows.map((r) => `${r.user_id}::${r.tenant_id}`))
      ).map((k) => {
        const [user_id, tenant_id] = k.split('::');
        return { user_id, tenant_id };
      });

      const existingDismissed = new Map<string, string>();
      for (const { user_id, tenant_id } of userTenantPairs) {
        const { data: existing, error: fetchError } = await supabase
          .from('update_check_results')
          .select('winget_id, intune_app_id, dismissed_at')
          .eq('user_id', user_id)
          .eq('tenant_id', tenant_id)
          .not('dismissed_at', 'is', null);

        if (isError(fetchError)) {
          console.error('Error fetching existing dismissed_at for update check merge:', fetchError);
          continue;
        }
        for (const row of (existing || []) as Array<{
          winget_id: string;
          intune_app_id: string;
          dismissed_at: string;
        }>) {
          existingDismissed.set(
            `${user_id}::${tenant_id}::${row.winget_id}::${row.intune_app_id}`,
            row.dismissed_at
          );
        }
      }

      const rowsWithPreservedDismissal = rows.map((row) => {
        const preserved = existingDismissed.get(
          `${row.user_id}::${row.tenant_id}::${row.winget_id}::${row.intune_app_id}`
        );
        return preserved ? { ...row, dismissed_at: preserved } : row;
      });

      const { error } = await supabase
        .from('update_check_results')
        .upsert(rowsWithPreservedDismissal, { onConflict: 'user_id,tenant_id,winget_id,intune_app_id' });

      if (isError(error)) {
        console.error('Error upserting update check results:', error);
        throw error;
      }
    },

    async getByUserId(
      userId: string,
      opts: { tenantId?: string; includeDismissed?: boolean; criticalOnly?: boolean } = {}
    ): Promise<UpdateCheckResultRecord[]> {
      const supabase = createServerClient();

      let query = supabase
        .from('update_check_results')
        .select('*')
        .eq('user_id', userId)
        .order('detected_at', { ascending: false });

      if (opts.tenantId) {
        query = query.eq('tenant_id', opts.tenantId);
      }
      if (!opts.includeDismissed) {
        query = query.is('dismissed_at', null);
      }
      if (opts.criticalOnly) {
        query = query.eq('is_critical', true);
      }

      const { data, error } = await query;

      if (isError(error)) {
        console.error('Error fetching update check results:', error);
        throw error;
      }

      return (data as unknown as UpdateCheckResultRecord[]) || [];
    },

    async getByUserIds(userIds: string[]): Promise<UpdateCheckResultRecord[]> {
      if (userIds.length === 0) return [];
      const supabase = createServerClient();

      const { data, error } = await supabase
        .from('update_check_results')
        .select('*')
        .in('user_id', userIds);

      if (isError(error)) {
        console.error('Error fetching update check results:', error);
        throw error;
      }

      return (data as unknown as UpdateCheckResultRecord[]) || [];
    },

    async setDismissed(ids: string[], userId: string, dismissed: boolean): Promise<number> {
      if (ids.length === 0) return 0;
      const supabase = createServerClient();
      const now = new Date().toISOString();

      const { data, error } = await supabase
        .from('update_check_results')
        .update({ dismissed_at: dismissed ? now : null, updated_at: now })
        .eq('user_id', userId)
        .in('id', ids)
        .select('id');

      if (isError(error)) {
        console.error('Error setting dismissed state:', error);
        throw error;
      }

      return (data as unknown[])?.length ?? 0;
    },

    async deleteByIds(ids: string[]): Promise<number> {
      if (ids.length === 0) return 0;
      const supabase = createServerClient();

      const { data, error } = await supabase
        .from('update_check_results')
        .delete()
        .in('id', ids)
        .select('id');

      if (isError(error)) {
        console.error('Error deleting update check results:', error);
        throw error;
      }

      return (data as unknown[])?.length ?? 0;
    },

    async deleteByUserTenantWinget(userId: string, tenantId: string, wingetId: string): Promise<number> {
      const supabase = createServerClient();

      const { data, error } = await supabase
        .from('update_check_results')
        .delete()
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
        .eq('winget_id', wingetId)
        .select('id');

      if (isError(error)) {
        console.error('Error deleting update check result by user/tenant/winget:', error);
        throw error;
      }

      return (data as unknown[])?.length ?? 0;
    },

    async deleteOlderThan(cutoffDate: string): Promise<number> {
      const supabase = createServerClient();

      const { data, error } = await supabase
        .from('update_check_results')
        .delete()
        .lt('detected_at', cutoffDate)
        .select('id');

      if (isError(error)) {
        console.error('Error pruning update check results:', error);
        throw error;
      }

      return (data as unknown[])?.length ?? 0;
    },
  },

  deploymentDrift: {
    async upsertMany(rows: Array<Omit<DeploymentDriftRecord, 'id'>>): Promise<void> {
      if (rows.length === 0) return;
      const supabase = createServerClient();

      const { error } = await supabase
        .from('deployment_drift_results')
        .upsert(rows, { onConflict: 'user_id,tenant_id,winget_id,intune_app_id' });

      if (isError(error)) {
        console.error('Error upserting deployment drift results:', error);
        throw error;
      }
    },

    async getByUserId(
      userId: string,
      opts: { tenantId?: string } = {}
    ): Promise<DeploymentDriftRecord[]> {
      const supabase = createServerClient();

      let query = supabase
        .from('deployment_drift_results')
        .select('*')
        .eq('user_id', userId);

      if (opts.tenantId) {
        query = query.eq('tenant_id', opts.tenantId);
      }

      const { data, error } = await query;

      if (isError(error)) {
        console.error('Error fetching deployment drift results:', error);
        throw error;
      }

      return (data as unknown as DeploymentDriftRecord[]) || [];
    },

    async deleteOlderThan(cutoffDate: string): Promise<number> {
      const supabase = createServerClient();

      const { data, error } = await supabase
        .from('deployment_drift_results')
        .delete()
        .lt('scanned_at', cutoffDate)
        .select('id');

      if (isError(error)) {
        console.error('Error pruning deployment drift results:', error);
        throw error;
      }

      return (data as unknown[])?.length ?? 0;
    },
  },

  deviceBiosInfo: {
    async upsertMany(rows: Array<Omit<DeviceBiosInfoRecord, 'id'>>): Promise<void> {
      if (rows.length === 0) return;
      const supabase = createServerClient();

      const { error } = await supabase
        .from('device_bios_info')
        .upsert(rows, { onConflict: 'tenant_id,device_id' });

      if (isError(error)) {
        console.error('Error upserting device BIOS info:', error);
        throw error;
      }
    },

    async getByTenantId(tenantId: string): Promise<DeviceBiosInfoRecord[]> {
      const supabase = createServerClient();

      try {
        return await fetchAllRows<DeviceBiosInfoRecord>((offset, limit) =>
          supabase
            .from('device_bios_info')
            .select('*')
            .eq('tenant_id', tenantId)
            .range(offset, offset + limit - 1) as unknown as PromiseLike<{
            data: DeviceBiosInfoRecord[] | null;
            error: PostgrestError | null;
          }>
        );
      } catch (error) {
        console.error('Error fetching device BIOS info:', error);
        throw error;
      }
    },

    async pruneRemoved(tenantId: string, currentDeviceIds: string[]): Promise<number> {
      const supabase = createServerClient();

      let query = supabase.from('device_bios_info').delete().eq('tenant_id', tenantId);
      if (currentDeviceIds.length > 0) {
        // Quote each id - unquoted values in a PostgREST in.() filter break
        // (or silently mis-match) if any device id ever contains a comma,
        // parenthesis, or quote.
        query = query.not('device_id', 'in', `(${currentDeviceIds.map(quotePostgrestListValue).join(',')})`);
      }
      const { data, error } = await query.select('id');

      if (isError(error)) {
        console.error('Error pruning device BIOS info:', error);
        throw error;
      }

      return (data as unknown[])?.length ?? 0;
    },
  },

  autopilotDeviceSnapshots: {
    async upsertMany(rows: Array<Omit<AutopilotDeviceSnapshotRecord, 'id'>>): Promise<void> {
      if (rows.length === 0) return;
      const supabase = createServerClient();

      const { error } = await supabase
        .from('autopilot_device_snapshots')
        .upsert(rows, { onConflict: 'tenant_id,device_id' });

      if (isError(error)) {
        console.error('Error upserting Autopilot device snapshots:', error);
        throw error;
      }
    },

    async getByTenantId(tenantId: string): Promise<AutopilotDeviceSnapshotRecord[]> {
      const supabase = createServerClient();

      try {
        return await fetchAllRows<AutopilotDeviceSnapshotRecord>((offset, limit) =>
          supabase
            .from('autopilot_device_snapshots')
            .select('*')
            .eq('tenant_id', tenantId)
            .range(offset, offset + limit - 1) as unknown as PromiseLike<{
            data: AutopilotDeviceSnapshotRecord[] | null;
            error: PostgrestError | null;
          }>
        );
      } catch (error) {
        console.error('Error fetching Autopilot device snapshots:', error);
        throw error;
      }
    },

    async pruneRemoved(tenantId: string, currentDeviceIds: string[]): Promise<number> {
      const supabase = createServerClient();

      let query = supabase.from('autopilot_device_snapshots').delete().eq('tenant_id', tenantId);
      if (currentDeviceIds.length > 0) {
        query = query.not('device_id', 'in', `(${currentDeviceIds.map(quotePostgrestListValue).join(',')})`);
      }
      const { data, error } = await query.select('id');

      if (isError(error)) {
        console.error('Error pruning Autopilot device snapshots:', error);
        throw error;
      }

      return (data as unknown[])?.length ?? 0;
    },
  },

  userOfficeLocations: {
    async upsertMany(rows: Array<Omit<UserOfficeLocationRecord, 'id'>>): Promise<void> {
      if (rows.length === 0) return;
      const supabase = createServerClient();

      const { error } = await supabase
        .from('user_office_locations')
        .upsert(rows, { onConflict: 'tenant_id,user_principal_name' });

      if (isError(error)) {
        console.error('Error upserting user office locations:', error);
        throw error;
      }
    },

    async getByTenantId(tenantId: string): Promise<UserOfficeLocationRecord[]> {
      const supabase = createServerClient();

      try {
        return await fetchAllRows<UserOfficeLocationRecord>((offset, limit) =>
          supabase
            .from('user_office_locations')
            .select('*')
            .eq('tenant_id', tenantId)
            .range(offset, offset + limit - 1) as unknown as PromiseLike<{
            data: UserOfficeLocationRecord[] | null;
            error: PostgrestError | null;
          }>
        );
      } catch (error) {
        console.error('Error fetching user office locations:', error);
        throw error;
      }
    },

    async pruneRemoved(tenantId: string, currentUserPrincipalNames: string[]): Promise<number> {
      const supabase = createServerClient();

      let query = supabase.from('user_office_locations').delete().eq('tenant_id', tenantId);
      if (currentUserPrincipalNames.length > 0) {
        query = query.not(
          'user_principal_name',
          'in',
          `(${currentUserPrincipalNames.map(quotePostgrestListValue).join(',')})`
        );
      }
      const { data, error } = await query.select('id');

      if (isError(error)) {
        console.error('Error pruning user office locations:', error);
        throw error;
      }

      return (data as unknown[])?.length ?? 0;
    },
  },

  deviceUpdateGroups: {
    async getByDeviceId(tenantId: string, deviceId: string): Promise<DeviceUpdateGroupRecord | null> {
      const supabase = createServerClient();

      const { data, error } = await supabase
        .from('device_update_groups')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('device_id', deviceId)
        .maybeSingle();

      if (isError(error)) {
        console.error('Error fetching device update group:', error);
        throw error;
      }

      return (data as unknown as DeviceUpdateGroupRecord) || null;
    },

    async upsert(row: Omit<DeviceUpdateGroupRecord, 'id' | 'created_at'>): Promise<DeviceUpdateGroupRecord> {
      const supabase = createServerClient();

      // A concurrent racer's insert must never overwrite an already-persisted
      // entra_group_id - the first writer's group must win so a losing
      // caller can detect the mismatch and clean up its own now-orphaned
      // Entra group (see ensureDeviceUpdateGroup). azure_ad_device_id can
      // legitimately change on the losing path (e.g. the device re-enrolled
      // and now reports a different Azure AD device id for the same
      // tenant/device_id) and should still be kept current - matching
      // lib/db/sqlite.ts's ON CONFLICT DO UPDATE SET azure_ad_device_id =
      // excluded.azure_ad_device_id. Plain upsert({ ignoreDuplicates: true })
      // can't express "update this one column, leave the rest" - Postgres
      // DO NOTHING skips azure_ad_device_id too - so a conflict is handled
      // as an explicit insert-then-targeted-update instead.
      const { data: inserted, error: insertError } = await supabase
        .from('device_update_groups')
        .insert(row)
        .select('*')
        .maybeSingle();

      if (!insertError && inserted) {
        return inserted as unknown as DeviceUpdateGroupRecord;
      }

      if (insertError && insertError.code !== '23505') {
        console.error('Error upserting device update group:', insertError);
        throw insertError;
      }

      const { data: updated, error: updateError } = await supabase
        .from('device_update_groups')
        .update({ azure_ad_device_id: row.azure_ad_device_id })
        .eq('tenant_id', row.tenant_id)
        .eq('device_id', row.device_id)
        .select('*')
        .maybeSingle();

      if (isError(updateError)) {
        console.error('Error updating device update group after conflict:', updateError);
        throw updateError;
      }

      if (!updated) {
        throw new Error('Device update group upsert conflicted but no existing row was found');
      }
      return updated as unknown as DeviceUpdateGroupRecord;
    },
  },
};
