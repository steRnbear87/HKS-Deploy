/**
 * Analytics Stats API Route
 * Returns dashboard statistics for the current user
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { parseAccessToken } from '@/lib/auth-utils';

// Approximate "all" for stats aggregation (matches the scan limit used
// elsewhere for self-hosted SQLite installs).
const STATS_SCAN_LIMIT = 1000;

export async function GET(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    interface PackagingJobRecent {
      id: string;
      winget_id: string;
      display_name: string;
      status: string;
      created_at: string;
      intune_app_url: string | null;
    }

    // Get start of month in UTC for consistent timezone handling
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      1
    ));

    const db = getDatabase();
    const allJobs = await db.jobs.getByUserId(user.userId, STATS_SCAN_LIMIT);
    const recentJobs: PackagingJobRecent[] = allJobs.slice(0, 5);

    // Aggregate stats in memory
    let totalDeployed = 0;
    let thisMonth = 0;
    let pending = 0;
    let failed = 0;

    const pendingStatuses = ['queued', 'packaging', 'uploading'];

    for (const job of allJobs) {
      // 'deployed' is the final success status (uploaded to Intune)
      // 'completed' is used for packaging-only completion (less common)
      if (job.status === 'deployed' || job.status === 'completed') {
        totalDeployed++;
        // Check if completed this month (using UTC)
        if (job.completed_at) {
          const completedDate = new Date(job.completed_at);
          if (completedDate >= startOfMonth) {
            thisMonth++;
          }
        }
      } else if (job.status === 'failed') {
        failed++;
      } else if (pendingStatuses.includes(job.status)) {
        pending++;
      }
    }

    // Transform recent jobs to activity items
    interface RecentActivityItem {
      id: string;
      type: 'upload' | 'package' | 'error';
      displayName: string;
      description: string;
      timestamp: string;
      status: 'success' | 'pending' | 'failed';
      intuneAppUrl?: string;
    }

    const recentActivity: RecentActivityItem[] = recentJobs.map((job) => {
      let type: 'upload' | 'package' | 'error' = 'package';
      let status: 'success' | 'pending' | 'failed' = 'pending';
      let description = '';

      switch (job.status) {
        case 'deployed':
          // Final success state - app is in Intune
          type = 'upload';
          status = 'success';
          description = `Deployed ${job.display_name || job.winget_id}`;
          break;
        case 'completed':
          // Packaging completed but not yet uploaded to Intune
          type = 'package';
          status = 'success';
          description = `Packaged ${job.display_name || job.winget_id}`;
          break;
        case 'failed':
          type = 'error';
          status = 'failed';
          description = `Failed to deploy ${job.display_name || job.winget_id}`;
          break;
        case 'cancelled':
          type = 'error';
          status = 'failed';
          description = `Cancelled ${job.display_name || job.winget_id}`;
          break;
        case 'queued':
          type = 'package';
          status = 'pending';
          description = `Queued ${job.display_name || job.winget_id}`;
          break;
        case 'packaging':
          type = 'package';
          status = 'pending';
          description = `Packaging ${job.display_name || job.winget_id}`;
          break;
        case 'uploading':
          type = 'upload';
          status = 'pending';
          description = `Uploading ${job.display_name || job.winget_id}`;
          break;
        default:
          // Unknown status - show as pending
          description = `Processing ${job.display_name || job.winget_id}`;
      }

      return {
        id: job.id,
        type,
        displayName: job.display_name || job.winget_id,
        description,
        timestamp: job.created_at,
        status,
        intuneAppUrl: job.intune_app_url ?? undefined,
      };
    });

    return NextResponse.json({
      totalDeployed,
      thisMonth,
      pending,
      failed,
      recentActivity,
    });
  } catch (error) {
    console.error('[GET /api/analytics/stats] Unhandled error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch statistics' },
      { status: 500 }
    );
  }
}
