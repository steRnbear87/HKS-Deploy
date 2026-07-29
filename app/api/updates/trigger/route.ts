/**
 * Trigger Updates API Route
 * POST - Manually trigger update(s) for apps
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getDatabase } from '@/lib/db';
import { getCatalogSource } from '@/lib/catalog';
import { parseAccessToken } from '@/lib/auth-utils';
import {
  AutoUpdateTrigger,
  getLatestInstallerInfo,
} from '@/lib/auto-update/trigger';
import {
  isGitHubActionsConfigured,
  triggerPackagingWorkflow,
} from '@/lib/github-actions';
import { getAppConfig } from '@/lib/config';
import { getFeatureFlags } from '@/lib/features';
import { extractSilentSwitches } from '@/lib/msp/silent-switches';
import { buildIntuneAppDescription } from '@/lib/intune-description';
import { buildDeploymentConfigForApp } from '@/lib/update-policies/build-deployment-config';
import type { WorkflowInputs } from '@/lib/github-actions';
import type {
  TriggerUpdateRequest,
  TriggerUpdateResponse,
  AppUpdatePolicy,
  DeploymentConfig,
} from '@/types/update-policies';
import type { Json } from '@/types/database';
import { isSelfUpdatingApp } from '@/lib/self-updating-apps';

// Batches of up to 10 apps run sequentially (DB lookups, job creation, and a
// workflow dispatch each); the platform default duration times out mid-batch
// and returns a non-JSON error page to the client
export const maxDuration = 300;

/**
 * POST /api/updates/trigger
 * Manually trigger update deployment for one or more apps
 */
export async function POST(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body: TriggerUpdateRequest = await request.json();

    // Validate request - either single update or bulk
    let updateRequests: { winget_id: string; tenant_id: string }[] = [];

    if (body.updates && Array.isArray(body.updates) && body.updates.length > 0) {
      updateRequests = body.updates;
    } else if (body.winget_id && body.tenant_id) {
      updateRequests = [{ winget_id: body.winget_id, tenant_id: body.tenant_id }];
    } else {
      return NextResponse.json(
        { error: 'Either winget_id/tenant_id or updates array is required' },
        { status: 400 }
      );
    }

    // Limit bulk updates
    if (updateRequests.length > 10) {
      return NextResponse.json(
        { error: 'Maximum 10 updates can be triggered at once' },
        { status: 400 }
      );
    }

    const response: TriggerUpdateResponse = {
      success: true,
      triggered: 0,
      failed: 0,
      results: [],
    };

    // Self-hosted SQLite mode has no app_update_policies/auto_update_history/
    // tenant_consent tables to back the full policy-driven flow below, so it
    // gets a simplified path: build the deployment config straight from the
    // catalog/prior deployment and create the packaging job directly, with
    // no policy tracking, rate limiting, or history bookkeeping.
    if (!isSupabaseConfigured()) {
      for (const req of updateRequests) {
        try {
          if (isSelfUpdatingApp(req.winget_id)) {
            response.failed++;
            response.results.push({
              winget_id: req.winget_id,
              tenant_id: req.tenant_id,
              success: false,
              error: `${req.winget_id} keeps itself up to date on the device (Click-to-Run); IntuneGet does not deploy updates for it. Refresh the updates list to remove it.`,
            });
            continue;
          }

          const db = getDatabase();
          const updates = await db.updateCheckResults.getByUserId(user.userId, {
            tenantId: req.tenant_id,
          });
          const updateResult = updates.find((u) => u.winget_id === req.winget_id);

          if (!updateResult) {
            response.failed++;
            response.results.push({
              winget_id: req.winget_id,
              tenant_id: req.tenant_id,
              success: false,
              error: 'Update not found',
            });
            continue;
          }

          const built = await buildDeploymentConfigForApp(null, {
            userId: user.userId,
            tenantId: req.tenant_id,
            wingetId: req.winget_id,
            latestVersion: updateResult.latest_version,
            // No user_settings table in SQLite mode; assignment carryover
            // always defaults off for self-hosted manual triggers.
            globalCarryOver: false,
          });

          if (built.status === 'orphaned_job') {
            response.failed++;
            response.results.push({
              winget_id: req.winget_id,
              tenant_id: req.tenant_id,
              success: false,
              error: 'Could not retrieve deployment configuration',
            });
            continue;
          }

          if (built.status === 'unavailable') {
            const catalogRow = await getCatalogSource().appExists(req.winget_id);
            response.failed++;
            response.results.push({
              winget_id: req.winget_id,
              tenant_id: req.tenant_id,
              success: false,
              error: catalogRow
                ? `No installer data is available for ${req.winget_id} ${updateResult.latest_version} yet - the catalog has not synced this version's manifest. Try again after the next catalog sync.`
                : `${req.winget_id} is not in the app catalog, so a deployment configuration cannot be built for it.`,
            });
            continue;
          }

          const { deploymentConfig, currentIntuneAppId } = built;

          const installerInfo = await getLatestInstallerInfo(null, req.winget_id);
          if (!installerInfo) {
            response.failed++;
            response.results.push({
              winget_id: req.winget_id,
              tenant_id: req.tenant_id,
              success: false,
              error: 'Could not get installer information for latest version',
            });
            continue;
          }
          installerInfo.currentVersion = updateResult.current_version;
          installerInfo.currentIntuneAppId =
            currentIntuneAppId || updateResult.intune_app_id || undefined;

          const sourceIntuneAppId = installerInfo.currentIntuneAppId || null;
          const jobId = crypto.randomUUID();

          await db.jobs.create({
            id: jobId,
            user_id: user.userId,
            user_email: user.userEmail,
            tenant_id: req.tenant_id,
            winget_id: req.winget_id,
            version: installerInfo.latestVersion,
            display_name: deploymentConfig.displayName || installerInfo.displayName,
            publisher: deploymentConfig.publisher,
            architecture: deploymentConfig.architecture,
            installer_type: installerInfo.installerType || deploymentConfig.installerType,
            installer_url: installerInfo.installerUrl,
            installer_sha256: installerInfo.installerSha256,
            install_command: deploymentConfig.installCommand,
            uninstall_command: deploymentConfig.uninstallCommand,
            install_scope: deploymentConfig.installScope,
            detection_rules: deploymentConfig.detectionRules as unknown as Json,
            package_config: {
              assignments: deploymentConfig.assignments,
              categories: deploymentConfig.categories,
              requirementRules: deploymentConfig.requirementRules,
              relationships: deploymentConfig.relationships,
              psadtConfig: deploymentConfig.psadtConfig,
              nestedInstallerType: installerInfo.nestedInstallerType,
              nestedInstallerPath: installerInfo.nestedInstallerPath,
              forceCreate: deploymentConfig.forceCreateNewApp !== false,
              sourceIntuneAppId,
              // Self-hosted SQLite mode has no per-user carry-over preference to
              // read (no user_settings table), and no multi-tenant policy reason
              // not to clean up - always retire the previous app's assignment so
              // updates don't accumulate orphaned Win32 app objects in Intune.
              assignmentMigration: deploymentConfig.assignmentMigration || {
                carryOverAssignments: true,
                removeAssignmentsFromPreviousApp: true,
              },
              description: deploymentConfig.description,
              notes: deploymentConfig.notes,
            } as unknown as Json,
            status: 'queued',
            progress_percent: 0,
          });

          const features = getFeatureFlags();
          const isLocalPackagerMode = features.localPackager;

          if (!isLocalPackagerMode && isGitHubActionsConfigured()) {
            const appConfig = getAppConfig();
            const baseUrl = appConfig.app.url || (process.env.VERCEL_URL
              ? `https://${process.env.VERCEL_URL}`
              : 'http://localhost:3000');
            const callbackUrl = `${baseUrl}/api/package/callback`;

            const workflowInputs: WorkflowInputs = {
              jobId,
              tenantId: req.tenant_id,
              wingetId: req.winget_id,
              displayName: deploymentConfig.displayName || installerInfo.displayName,
              description: buildIntuneAppDescription({
                description: deploymentConfig.description,
                fallback: `Deployed via HKS App Deployment from Winget: ${req.winget_id}`,
              }),
              publisher: deploymentConfig.publisher || 'Unknown Publisher',
              version: installerInfo.latestVersion,
              architecture: deploymentConfig.architecture || 'x64',
              installerUrl: installerInfo.installerUrl,
              installerSha256: installerInfo.installerSha256 || '',
              installerType: installerInfo.installerType || deploymentConfig.installerType || 'exe',
              nestedInstallerType: installerInfo.nestedInstallerType,
              nestedInstallerPath: installerInfo.nestedInstallerPath,
              silentSwitches: extractSilentSwitches(
                deploymentConfig.installCommand || '',
                installerInfo.installerType || deploymentConfig.installerType || 'exe'
              ),
              uninstallCommand: deploymentConfig.uninstallCommand || '',
              callbackUrl,
              detectionRules: deploymentConfig.detectionRules
                ? JSON.stringify(deploymentConfig.detectionRules)
                : undefined,
              psadtConfig: deploymentConfig.psadtConfig
                ? JSON.stringify(deploymentConfig.psadtConfig)
                : undefined,
              assignments: deploymentConfig.assignments
                ? JSON.stringify(deploymentConfig.assignments)
                : undefined,
              categories: deploymentConfig.categories
                ? JSON.stringify(deploymentConfig.categories)
                : undefined,
              requirementRules: deploymentConfig.requirementRules
                ? JSON.stringify(deploymentConfig.requirementRules)
                : undefined,
              relationships: deploymentConfig.relationships && deploymentConfig.relationships.length > 0
                ? JSON.stringify(deploymentConfig.relationships)
                : undefined,
              installScope: (deploymentConfig.installScope === 'user' ? 'user' : 'machine') as 'machine' | 'user',
              forceCreate: deploymentConfig.forceCreateNewApp !== false,
              sourceIntuneAppId: sourceIntuneAppId || undefined,
              carryOverAssignments: true,
              removeAssignmentsFromPreviousApp: true,
              autoSupersede: true,
              supersedenceType: 'update',
            };

            const isBatch = updateRequests.length > 1;
            await triggerPackagingWorkflow(workflowInputs, undefined, {
              skipRunCapture: isBatch,
            });
          }
          // If local packager mode, the job stays in 'queued'/'packaging' for local pickup

          response.triggered++;
          response.results.push({
            winget_id: req.winget_id,
            tenant_id: req.tenant_id,
            success: true,
            packaging_job_id: jobId,
          });
        } catch (error) {
          response.failed++;
          response.results.push({
            winget_id: req.winget_id,
            tenant_id: req.tenant_id,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      response.success = response.failed === 0;
      return NextResponse.json(response);
    }

    const supabase = createServerClient();

    // Get Supabase config for trigger
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const autoUpdateTrigger = new AutoUpdateTrigger(supabaseUrl, supabaseServiceKey);

    // Read the user's global update settings once for the whole batch - they
    // do not change mid-request and per-item reads add up across 10 apps
    const { data: userSettingsRow, error: userSettingsError } = await (supabase as any)
      .from('user_settings')
      .select('settings')
      .eq('user_id', user.userId)
      .maybeSingle();
    if (userSettingsError) {
      console.warn(
        `Failed to read user_settings for ${user.userId}: ${userSettingsError.message}`
      );
    }
    const userSettings = (userSettingsRow?.settings as Record<string, unknown> | null) || null;
    const globalCarryOver = Boolean(userSettings?.carryOverAssignments);
    const supersedePrevious = Boolean(userSettings?.supersedePreviousApp);

    for (const req of updateRequests) {
      try {
        // Self-updating apps are excluded from update detection; guard here
        // too in case a stale check result from before the exclusion remains
        if (isSelfUpdatingApp(req.winget_id)) {
          response.failed++;
          response.results.push({
            winget_id: req.winget_id,
            tenant_id: req.tenant_id,
            success: false,
            error: `${req.winget_id} keeps itself up to date on the device (Click-to-Run); IntuneGet does not deploy updates for it. Refresh the updates list to remove it.`,
          });
          continue;
        }

        // Get the update check result for this app
        const { data: updateResult, error: updateError } = await supabase
          .from('update_check_results')
          .select('*')
          .eq('user_id', user.userId)
          .eq('tenant_id', req.tenant_id)
          .eq('winget_id', req.winget_id)
          .single();

        if (updateError || !updateResult) {
          response.failed++;
          response.results.push({
            winget_id: req.winget_id,
            tenant_id: req.tenant_id,
            success: false,
            error: 'Update not found',
          });
          continue;
        }

        // Get or create policy for this app
        let { data: policy } = await supabase
          .from('app_update_policies')
          .select('*')
          .eq('user_id', user.userId)
          .eq('tenant_id', req.tenant_id)
          .eq('winget_id', req.winget_id)
          .single();

        // If no policy exists, check for prior deployment to get config
        if (!policy) {
          const built = await buildDeploymentConfigForApp(supabase, {
            userId: user.userId,
            tenantId: req.tenant_id,
            wingetId: req.winget_id,
            latestVersion: updateResult.latest_version,
            globalCarryOver,
          });

          if (built.status === 'orphaned_job') {
            response.failed++;
            response.results.push({
              winget_id: req.winget_id,
              tenant_id: req.tenant_id,
              success: false,
              error: 'Could not retrieve deployment configuration',
            });
            continue;
          }

          if (built.status === 'unavailable') {
            // Distinguish missing installer data from a missing catalog
            // entry so the user knows whether waiting for the catalog
            // sync can help
            const catalogRow = await getCatalogSource().appExists(req.winget_id);
            response.failed++;
            response.results.push({
              winget_id: req.winget_id,
              tenant_id: req.tenant_id,
              success: false,
              error: catalogRow
                ? `No installer data is available for ${req.winget_id} ${updateResult.latest_version} yet - the catalog has not synced this version's manifest. Try again after the next catalog sync.`
                : `${req.winget_id} is not in the app catalog, so a deployment configuration cannot be built for it.`,
            });
            continue;
          }

          const { deploymentConfig, originalUploadHistoryId } = built;

          // Create a policy for this manual trigger
          const { data: newPolicy, error: policyError } = await supabase
            .from('app_update_policies')
            .insert({
              user_id: user.userId,
              tenant_id: req.tenant_id,
              winget_id: req.winget_id,
              policy_type: 'notify',
              deployment_config: deploymentConfig as unknown as Json,
              original_upload_history_id: originalUploadHistoryId,
              is_enabled: true,
            })
            .select()
            .single();

          if (policyError) {
            response.failed++;
            response.results.push({
              winget_id: req.winget_id,
              tenant_id: req.tenant_id,
              success: false,
              error: `Failed to create policy: ${policyError.message}`,
            });
            continue;
          }

          policy = newPolicy;
        }

        // Get installer info
        const installerInfo = await getLatestInstallerInfo(supabase, req.winget_id);

        if (!installerInfo) {
          response.failed++;
          response.results.push({
            winget_id: req.winget_id,
            tenant_id: req.tenant_id,
            success: false,
            error: 'Could not get installer information for latest version',
          });
          continue;
        }

        installerInfo.currentVersion = updateResult.current_version;

        // Look up the most recent upload_history record to get the current
        // Intune app ID. The update_check_results.intune_app_id can be stale
        // if the app was redeployed (forceCreate) since the last update check.
        const { data: latestUpload } = await supabase
          .from('upload_history')
          .select('intune_app_id')
          .eq('user_id', user.userId)
          .eq('intune_tenant_id', req.tenant_id)
          .eq('winget_id', req.winget_id)
          .order('deployed_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        installerInfo.currentIntuneAppId =
          latestUpload?.intune_app_id || updateResult.intune_app_id;

        // Trigger the update (creates packaging job + history record in DB)
        // Manual triggers skip rate limits since the user explicitly confirmed
        const triggerResult = await autoUpdateTrigger.triggerAutoUpdate(
          policy as AppUpdatePolicy,
          installerInfo,
          // skipPolicyGateCheck: the user explicitly clicked "Update Now" for
          // this app, which may have policy_type 'ignore'/'pin_version' or be
          // disabled - bypass the gate for this one call without ever
          // writing 'auto_update'/enabled to the DB row (a stored flip was
          // visible to the cron's own eligibility query and could trigger a
          // second, independent update for an app the user excluded).
          { skipRateLimits: true, skipPriorDeploymentCheck: true, skipPolicyGateCheck: true }
        );

        if (triggerResult.success && triggerResult.packagingJobId) {
          // Dispatch the GitHub Actions workflow to actually run the packaging
          const features = getFeatureFlags();
          const isLocalPackagerMode = features.localPackager;

          if (!isLocalPackagerMode && isGitHubActionsConfigured()) {
            const appConfig = getAppConfig();
            const baseUrl = appConfig.app.url || (process.env.VERCEL_URL
              ? `https://${process.env.VERCEL_URL}`
              : 'http://localhost:3000');
            const callbackUrl = `${baseUrl}/api/package/callback`;

            const deploymentConfig = policy.deployment_config as unknown as DeploymentConfig;

            // Global settings were read once before the loop; the stored
            // policy value may be stale, so the current setting wins
            const currentCarryOver = globalCarryOver;

            const workflowInputs: WorkflowInputs = {
              jobId: triggerResult.packagingJobId,
              tenantId: req.tenant_id,
              wingetId: req.winget_id,
              displayName: deploymentConfig.displayName || installerInfo.displayName,
              description: buildIntuneAppDescription({
                description: deploymentConfig.description,
                fallback: `Deployed via HKS App Deployment from Winget: ${req.winget_id}`,
              }),
              publisher: deploymentConfig.publisher || 'Unknown Publisher',
              version: installerInfo.latestVersion,
              architecture: deploymentConfig.architecture || 'x64',
              installerUrl: installerInfo.installerUrl,
              installerSha256: installerInfo.installerSha256 || '',
              installerType: installerInfo.installerType || deploymentConfig.installerType || 'exe',
              nestedInstallerType: installerInfo.nestedInstallerType,
              nestedInstallerPath: installerInfo.nestedInstallerPath,
              silentSwitches: extractSilentSwitches(
                deploymentConfig.installCommand || '',
                installerInfo.installerType || deploymentConfig.installerType || 'exe'
              ),
              uninstallCommand: deploymentConfig.uninstallCommand || '',
              callbackUrl,
              detectionRules: deploymentConfig.detectionRules
                ? JSON.stringify(deploymentConfig.detectionRules)
                : undefined,
              // PSADT settings from the original deployment; triggerAutoUpdate
              // backfills them onto the policy for pre-existing policies
              psadtConfig: deploymentConfig.psadtConfig
                ? JSON.stringify(deploymentConfig.psadtConfig)
                : undefined,
              assignments: deploymentConfig.assignments
                ? JSON.stringify(deploymentConfig.assignments)
                : undefined,
              categories: deploymentConfig.categories
                ? JSON.stringify(deploymentConfig.categories)
                : undefined,
              requirementRules: deploymentConfig.requirementRules
                ? JSON.stringify(deploymentConfig.requirementRules)
                : undefined,
              relationships: deploymentConfig.relationships && deploymentConfig.relationships.length > 0
                ? JSON.stringify(deploymentConfig.relationships)
                : undefined,
              installScope: (deploymentConfig.installScope === 'user' ? 'user' : 'machine') as 'machine' | 'user',
              forceCreate: deploymentConfig.forceCreateNewApp !== false,
              sourceIntuneAppId: installerInfo.currentIntuneAppId || undefined,
              carryOverAssignments: currentCarryOver,
              removeAssignmentsFromPreviousApp: currentCarryOver,
              autoSupersede: supersedePrevious,
              supersedenceType: supersedePrevious ? 'update' : undefined,
            };

            const isBatch = updateRequests.length > 1;
            await triggerPackagingWorkflow(workflowInputs, undefined, {
              skipRunCapture: isBatch,
            });
          }
          // If local packager mode, the job stays in 'queued'/'packaging' for local pickup

          response.triggered++;
          response.results.push({
            winget_id: req.winget_id,
            tenant_id: req.tenant_id,
            success: true,
            packaging_job_id: triggerResult.packagingJobId,
          });
        } else if (!triggerResult.success) {
          response.failed++;
          response.results.push({
            winget_id: req.winget_id,
            tenant_id: req.tenant_id,
            success: false,
            error: triggerResult.error || triggerResult.skipReason || 'Unknown error',
          });
        }
      } catch (error) {
        response.failed++;
        response.results.push({
          winget_id: req.winget_id,
          tenant_id: req.tenant_id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    response.success = response.failed === 0;

    return NextResponse.json(response);
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
