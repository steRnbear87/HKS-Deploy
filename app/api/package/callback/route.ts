/**
 * Package Callback API Route
 * Receives results from GitHub Actions packaging workflow
 * Protected by HMAC-SHA256 signature verification
 */

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { verifyCallbackSignature } from '@/lib/callback-signature';
import { onJobCompleted } from '@/lib/msp/batch-orchestrator';
import { handleAutoUpdateJobCompletion } from '@/lib/auto-update/cleanup';
import { quarantineInstaller } from '@/lib/installer-preflight';
import {
  packageCallbackSchema,
  sanitizeErrorDetails,
  shouldApplyCallback,
} from '@/lib/package-callback';

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('X-Signature');
    const callbackSecret = process.env.CALLBACK_SECRET;

    // Fail closed in every environment, not just when NODE_ENV is literally
    // "production" - self-hosted Docker entrypoints frequently don't set
    // NODE_ENV at all, which previously skipped signature verification
    // entirely and let anyone who knew a job UUID forge callbacks.
    if (!callbackSecret) {
      console.error('[Callback] CALLBACK_SECRET is not configured; rejecting callback');
      return NextResponse.json({ error: 'Callback verification is unavailable' }, { status: 503 });
    }

    if (!verifyCallbackSignature(body, signature, callbackSecret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(body);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = packageCallbackSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid callback payload', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const data = parsed.data;
    const db = getDatabase();
    const currentJob = await db.jobs.getById(data.jobId);
    if (!currentJob) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (!shouldApplyCallback(currentJob.status, data.status, currentJob.updated_at, data.heartbeatAt)) {
      return NextResponse.json({
        success: true,
        ignored: true,
        reason: 'stale_or_terminal_callback',
        job: currentJob,
      });
    }

    const updateData: Partial<typeof currentJob> = {
      status: data.status,
      status_message: data.message ?? currentJob.status_message,
    };

    if (data.progress !== undefined) {
      updateData.progress_percent = data.progress;
    }

    if (data.runId) {
      updateData.github_run_id = String(data.runId);
    }
    if (data.runUrl) {
      updateData.github_run_url = data.runUrl;
    }
    if (data.installerSha256) {
      updateData.installer_sha256 = data.installerSha256.toUpperCase();
    }

    // Handle deployed status
    if (data.status === 'deployed') {
      updateData.intune_app_id = data.intuneAppId;
      updateData.intune_app_url = data.intuneAppUrl;
      updateData.completed_at = new Date().toISOString();
      updateData.progress_percent = 100;

      if (data.warnings && data.warnings.length > 0) {
        updateData.warnings = data.warnings;
      }
    }

    // Handle duplicate_skipped status
    if (data.status === 'duplicate_skipped') {
      updateData.intune_app_id = data.intuneAppId;
      updateData.intune_app_url = data.intuneAppUrl;
      updateData.completed_at = new Date().toISOString();
      updateData.progress_percent = 100;

      if (data.duplicateInfo) {
        updateData.error_details = data.duplicateInfo;
      }
    }

    // Handle failure
    if (data.status === 'failed') {
      updateData.error_message = data.message || 'Unknown error';
      updateData.completed_at = new Date().toISOString();

      if (data.errorStage) {
        updateData.error_stage = data.errorStage;
      }
      if (data.errorCategory) {
        updateData.error_category = data.errorCategory;
      }
      if (data.errorCode) {
        updateData.error_code = data.errorCode;
      }
      if (data.errorDetails) {
        updateData.error_details = {
          ...sanitizeErrorDetails(data.errorDetails),
          retryable: data.retryable,
          retryAfterSeconds: data.retryAfterSeconds,
        };
      }

      console.error(`Job ${data.jobId} failed: ${data.message}`, {
        stage: data.errorStage,
        category: data.errorCategory,
        code: data.errorCode,
      });
    }

    // Optimistic status condition prevents a cancellation or another terminal
    // callback from being overwritten between the read and the update.
    const updatedJob = await db.jobs.update(data.jobId, updateData, { status: currentJob.status });

    if (!updatedJob) {
      const latestJob = await db.jobs.getById(data.jobId);
      return NextResponse.json({
        success: true,
        ignored: true,
        reason: 'job_changed_during_callback',
        job: latestJob,
      });
    }

    // Side effects run only after the state transition succeeds, making callback
    // retries idempotent and preventing duplicate history rows - quarantine is a
    // global, catalog-wide side effect, so it must not fire for a callback that
    // just lost the race above (updatedJob null) even though this specific job
    // never actually reached the failed state.
    if (data.status === 'failed' && data.errorCode === 'HASH_MISMATCH') {
      const packageConfig = currentJob.package_config && typeof currentJob.package_config === 'object'
        && !Array.isArray(currentJob.package_config)
        ? currentJob.package_config as Record<string, unknown>
        : {};
      const actualHash = data.errorDetails && typeof data.errorDetails.actualHash === 'string'
        ? data.errorDetails.actualHash
        : undefined;
      try {
        await quarantineInstaller({
          wingetId: currentJob.winget_id,
          version: currentJob.version,
          architecture: currentJob.architecture || 'x64',
          installerUrl: currentJob.installer_url || '',
          installerSha256: currentJob.installer_sha256 || '',
          installerType: currentJob.installer_type || undefined,
          installScope: currentJob.install_scope === 'user' ? 'user' : 'machine',
          sourceType: packageConfig.sourceType === 'custom' ? 'custom' : 'winget',
        }, actualHash, 'HASH_MISMATCH', data.message || 'The installer failed SHA256 verification');
      } catch (quarantineError) {
        console.error('Could not persist installer quarantine from callback:', quarantineError);
      }
    }

    if (data.status === 'deployed' && data.intuneAppId) {
      try {
        await db.uploadHistory.create({
          packaging_job_id: data.jobId,
          user_id: currentJob.user_id,
          winget_id: currentJob.winget_id,
          version: currentJob.version,
          display_name: currentJob.display_name,
          publisher: currentJob.publisher,
          intune_app_id: data.intuneAppId,
          intune_app_url: data.intuneAppUrl,
          intune_tenant_id: currentJob.tenant_id,
        });
      } catch (historyError) {
        // The terminal job state is authoritative. Do not ask the workflow to
        // retry a callback that can no longer repeat this side effect.
        console.error(`[Callback] Failed to create upload history for ${data.jobId}:`, historyError);
      }

      // Clean up stale update_check_results so the Updates page no longer
      // shows "update available" for the app that was just deployed - same
      // cleanup the standalone packager's job-update route performs.
      if (currentJob.tenant_id && currentJob.winget_id) {
        try {
          await db.updateCheckResults.deleteByUserTenantWinget(
            currentJob.user_id,
            currentJob.tenant_id,
            currentJob.winget_id
          );
        } catch (cleanupError) {
          console.error(`[Callback] Failed to clean up update_check_results for ${data.jobId}:`, cleanupError);
        }
      }
    }

    // Check if this job belongs to a batch deployment item.
    if (data.status === 'deployed' || data.status === 'failed' || data.status === 'duplicate_skipped') {
      const jobStatus = data.status === 'failed' ? 'failed' : 'completed';
      onJobCompleted(data.jobId, jobStatus, data.message).catch((err) => {
        console.error('[Callback] Batch orchestrator error:', err);
      });

      handleAutoUpdateJobCompletion(data.jobId, data.status, data.message).catch((err) => {
        console.error('[Callback] Auto-update cleanup error:', err);
      });
    }

    return NextResponse.json({
      success: true,
      job: updatedJob,
    });
  } catch (error) {
    console.error('[Callback] Unhandled callback error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET handler for health check / verification
 */
/**
 * True only if the request presents the CALLBACK_SECRET as a bearer token.
 * Fails closed when the secret isn't configured, so an unset secret never
 * makes the detailed branch below universally accessible.
 */
function isAuthorizedHealthCheck(request: NextRequest): boolean {
  const callbackSecret = process.env.CALLBACK_SECRET;
  if (!callbackSecret) {
    return false;
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return false;
  }

  const expected = Buffer.from(`Bearer ${callbackSecret}`);
  const actual = Buffer.from(authHeader);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export async function GET(request: NextRequest) {
  // Configuration flags, the public URL, and job stats are operational
  // detail an anonymous caller shouldn't get for free - only expose them to
  // a caller that can already prove it knows CALLBACK_SECRET. Everyone else
  // (e.g. a plain uptime monitor) gets just enough to know the route is up.
  if (!isAuthorizedHealthCheck(request)) {
    return NextResponse.json({
      status: 'ok',
      message: 'Package callback endpoint is active',
      timestamp: new Date().toISOString(),
    });
  }

  const databaseMode = process.env.DATABASE_MODE || 'supabase';

  const healthInfo: Record<string, unknown> = {
    status: 'ok',
    message: 'Package callback endpoint is active',
    signatureRequired: Boolean(process.env.CALLBACK_SECRET),
    databaseMode,
    timestamp: new Date().toISOString(),
  };

  // Check configuration status
  const configStatus = {
    callbackSecret: Boolean(process.env.CALLBACK_SECRET),
    databaseMode,
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    packagerApiKey: Boolean(process.env.PACKAGER_API_KEY),
    publicUrl: process.env.NEXT_PUBLIC_URL || process.env.VERCEL_URL || 'not configured',
  };
  healthInfo.configuration = configStatus;

  // Try to get job stats from database
  try {
    const db = getDatabase();
    const stats = await db.jobs.getStats();

    healthInfo.jobStats = stats;
    healthInfo.databaseConnected = true;
  } catch {
    healthInfo.databaseConnected = false;
  }

  return NextResponse.json(healthInfo);
}
