/**
 * Packager Jobs API
 * Provides endpoints for the local packager to claim and update jobs
 */

import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, verifyPackagerApiKey } from '@/lib/db';
import { getFeatureFlags } from '@/lib/features';
import { callbackStatuses, shouldApplyCallback } from '@/lib/package-callback';
import { handleAutoUpdateJobCompletion } from '@/lib/auto-update/cleanup';

const packagerJobUpdateSchema = z.object({
  jobId: z.string().uuid(),
  packagerId: z.string().trim().min(1).max(128),
  // Only the statuses a packager would ever legitimately report - not the
  // full job-lifecycle set (e.g. 'queued'/'cancelled' are set by other
  // flows, never by a packager PATCH).
  status: z.enum(callbackStatuses).optional(),
  progressPercent: z.number().min(0).max(100).optional(),
  progressMessage: z.string().max(2_000).optional(),
  error: z.string().max(2_000).optional(),
  intuneAppId: z.string().trim().min(1).max(128).optional(),
  intuneAppUrl: z.string().url().max(2_048).optional(),
  duplicateInfo: z.object({
    matchType: z.enum(['exact', 'partial']),
    existingAppId: z.string().trim().min(1).max(128),
    existingVersion: z.string().max(128).optional(),
    createdAt: z.string().datetime({ offset: true }).optional(),
  }).optional(),
});

// Verify the packager auth key (API key for SQLite, service role key for Supabase)
function verifyPackagerAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return false;
  }

  const providedKey = authHeader.slice(7);
  return verifyPackagerApiKey(providedKey);
}

/**
 * GET /api/packager/jobs
 * Get queued jobs for the packager to claim
 */
export async function GET(request: NextRequest) {
  const features = getFeatureFlags();

  if (!features.localPackager) {
    return NextResponse.json(
      { error: 'Local packager mode is not enabled' },
      { status: 400 }
    );
  }

  if (!verifyPackagerAuth(request)) {
    return NextResponse.json(
      { error: 'Unauthorized - invalid packager credentials' },
      { status: 401 }
    );
  }

  try {
    const db = getDatabase();
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50);
    const status = searchParams.get('status') || 'queued';

    const jobs = await db.jobs.getByStatus(status, limit, true);

    return NextResponse.json({ jobs: jobs || [] });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/packager/jobs
 * Claim a job for processing (atomic operation)
 */
export async function POST(request: NextRequest) {
  const features = getFeatureFlags();

  if (!features.localPackager) {
    return NextResponse.json(
      { error: 'Local packager mode is not enabled' },
      { status: 400 }
    );
  }

  if (!verifyPackagerAuth(request)) {
    return NextResponse.json(
      { error: 'Unauthorized - invalid packager credentials' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { jobId, packagerId } = body;

    if (!jobId || !packagerId) {
      return NextResponse.json(
        { error: 'jobId and packagerId are required' },
        { status: 400 }
      );
    }

    const db = getDatabase();

    // Atomically claim the job (only if still queued)
    const job = await db.jobs.claim(jobId, packagerId);

    if (!job) {
      // Job was already claimed or doesn't exist
      return NextResponse.json(
        { error: 'Job not available for claiming', claimed: false },
        { status: 409 }
      );
    }

    return NextResponse.json({
      claimed: true,
      job,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/packager/jobs
 * Update job status and progress (heartbeat and status updates)
 */
export async function PATCH(request: NextRequest) {
  const features = getFeatureFlags();

  if (!features.localPackager) {
    return NextResponse.json(
      { error: 'Local packager mode is not enabled' },
      { status: 400 }
    );
  }

  if (!verifyPackagerAuth(request)) {
    return NextResponse.json(
      { error: 'Unauthorized - invalid packager credentials' },
      { status: 401 }
    );
  }

  try {
    const rawBody = await request.json();
    const parsed = packagerJobUpdateSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid job update payload', issues: parsed.error.issues },
        { status: 400 }
      );
    }
    const { jobId, packagerId, status, progressPercent, progressMessage, error: errorMessage, intuneAppId, intuneAppUrl, duplicateInfo } = parsed.data;

    const db = getDatabase();
    const existingJob = await db.jobs.getById(jobId);
    const now = new Date().toISOString();

    // Same monotonic status-rank + terminal-state guard the public GitHub
    // Actions callback route uses: without it, a reordered/retried PATCH
    // (e.g. a delayed heartbeat arriving after a newer status) can regress
    // a job backwards and cause a later resend of the newer status to
    // re-run its side effects (a second upload_history row, a repeated
    // update_check_results cleanup) a second time.
    const statusChangeAllowed =
      !status || !existingJob || shouldApplyCallback(existingJob.status, status, existingJob.updated_at);

    if (status && !statusChangeAllowed) {
      console.warn(
        `[Packager Jobs API] Ignoring out-of-order status "${status}" for job ${jobId} (current: ${existingJob?.status})`
      );
    }

    // Build update object
    const updateData: Record<string, unknown> = {
      packager_heartbeat_at: now,
    };

    if (status && statusChangeAllowed) {
      updateData.status = status;
    }

    // Guard against a reordered/retried heartbeat regressing the displayed
    // progress backward - this route has no sequence/heartbeat-timestamp
    // field to order by (unlike the hosted callback route's
    // shouldApplyCallback heartbeatAt check), so the stored value itself is
    // the only ordering signal: never move it backward.
    if (progressPercent !== undefined && (!existingJob || progressPercent >= existingJob.progress_percent)) {
      updateData.progress_percent = progressPercent;
    }

    if (progressMessage) {
      updateData.progress_message = progressMessage;
    }

    // Handle status transitions (only for a status change that actually passed the guard above)
    if (statusChangeAllowed) {
      if (status === 'uploading') {
        updateData.upload_started_at = now;
        updateData.packaging_completed_at = now;
      } else if (status === 'deployed') {
        updateData.completed_at = now;
        if (intuneAppId) updateData.intune_app_id = intuneAppId;
        if (intuneAppUrl) updateData.intune_app_url = intuneAppUrl;
      } else if (status === 'failed') {
        updateData.completed_at = now;
        if (errorMessage) updateData.error_message = errorMessage;
      } else if (status === 'duplicate_skipped') {
        // Same handling as the hosted callback route: link the existing app and
        // keep duplicateInfo in error_details for the uploads UI; no
        // upload_history record is written for a skip.
        updateData.completed_at = now;
        if (intuneAppId) updateData.intune_app_id = intuneAppId;
        if (intuneAppUrl) updateData.intune_app_url = intuneAppUrl;
        if (duplicateInfo) updateData.error_details = duplicateInfo;
      }
    }

    // Update the job (only if owned by this packager)
    const job = await db.jobs.update(jobId, updateData, { packager_id: packagerId });

    if (!job) {
      return NextResponse.json(
        { error: 'Failed to update job or job not owned by this packager' },
        { status: 400 }
      );
    }

    // Record deployments in upload_history so update checks can track versions.
    if (status === 'deployed' && existingJob?.status !== 'deployed' && job.intune_app_id) {
      try {
        await db.uploadHistory.create({
          packaging_job_id: job.id,
          user_id: job.user_id,
          winget_id: job.winget_id,
          version: job.version,
          display_name: job.display_name,
          publisher: job.publisher,
          intune_app_id: job.intune_app_id,
          intune_app_url: job.intune_app_url,
          intune_tenant_id: job.tenant_id,
        });
      } catch (historyError) {
        console.error(
          `[Packager Jobs API] Failed to write upload_history for job ${job.id}:`,
          historyError
        );
      }

      // Clean up stale update_check_results so the Updates page no longer
      // shows "update available" for the app that was just deployed.
      if (job.tenant_id && job.winget_id) {
        try {
          await getDatabase().updateCheckResults.deleteByUserTenantWinget(
            job.user_id,
            job.tenant_id,
            job.winget_id
          );
        } catch (cleanupError) {
          console.error(
            `[Packager Jobs API] Failed to clean up update_check_results for job ${job.id}:`,
            cleanupError
          );
        }
      }
    }

    // Unlike the GitHub Actions callback route, this endpoint never called
    // handleAutoUpdateJobCompletion - so a local-packager auto-update job
    // that failed kept last_auto_update_version set (looking "up to date")
    // until the periodic stale-job sweep eventually cleared it, instead of
    // reflecting the failure right away.
    if (statusChangeAllowed && (status === 'deployed' || status === 'failed' || status === 'duplicate_skipped')) {
      handleAutoUpdateJobCompletion(job.id, status, errorMessage).catch((err) => {
        console.error(`[Packager Jobs API] Auto-update cleanup error for job ${job.id}:`, err);
      });
    }

    return NextResponse.json({ updated: true, job });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/packager/jobs
 * Release a claimed job (allows re-claiming by another packager)
 */
export async function DELETE(request: NextRequest) {
  const features = getFeatureFlags();

  if (!features.localPackager) {
    return NextResponse.json(
      { error: 'Local packager mode is not enabled' },
      { status: 400 }
    );
  }

  if (!verifyPackagerAuth(request)) {
    return NextResponse.json(
      { error: 'Unauthorized - invalid packager credentials' },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');
    const packagerId = searchParams.get('packagerId');

    if (!jobId || !packagerId) {
      return NextResponse.json(
        { error: 'jobId and packagerId query parameters are required' },
        { status: 400 }
      );
    }

    const db = getDatabase();

    // Release the job back to queued state
    const job = await db.jobs.release(jobId, packagerId);

    if (!job) {
      return NextResponse.json(
        { error: 'Failed to release job or job not owned by this packager' },
        { status: 400 }
      );
    }

    return NextResponse.json({ released: true, job });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
