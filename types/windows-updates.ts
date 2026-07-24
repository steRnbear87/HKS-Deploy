/**
 * Windows Update management types
 *
 * Covers Intune's Windows Update policy Graph resources (update rings,
 * feature/quality/driver update profiles). All of these assign to groups
 * only - there is no per-device target type in Graph - so per-device
 * targeting is implemented via lib/intune/device-update-groups.ts's
 * auto-managed single-device groups. See DeviceUpdateGroup below.
 */

import type { AssignmentTarget } from './intune';

export type WindowsUpdatePolicyType = 'ring' | 'feature' | 'quality' | 'driver' | 'm365Apps';

/** windowsUpdateForBusinessConfiguration (v1.0) */
export interface UpdateRing {
  id: string;
  displayName: string;
  description?: string;
  qualityUpdatesDeferralPeriodInDays: number;
  featureUpdatesDeferralPeriodInDays: number;
  qualityUpdatesPaused: boolean;
  featureUpdatesPaused: boolean;
  deadlineForQualityUpdatesInDays?: number;
  deadlineForFeatureUpdatesInDays?: number;
  deadlineGracePeriodInDays?: number;
  automaticUpdateMode?: string;
  businessReadyUpdatesOnly?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  assignments?: PolicyAssignmentSummary;
}

/** windowsFeatureUpdateProfile (beta) */
export interface FeatureUpdateProfile {
  id: string;
  displayName: string;
  description?: string;
  featureUpdateVersion: string; // e.g. "24H2"
  installLatestWindows10OnWindows11IneligibleDevice?: boolean;
  installFeatureUpdatesOptional?: boolean;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  assignments?: PolicyAssignmentSummary;
}

/** windowsQualityUpdateProfile (beta), including expedited settings */
export interface QualityUpdateProfile {
  id: string;
  displayName: string;
  description?: string;
  releaseDateDisplayName?: string;
  deployableContentDisplayName?: string;
  expedited?: {
    qualityUpdateRelease?: string;
    daysUntilForcedReboot?: number;
  };
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  assignments?: PolicyAssignmentSummary;
}

/** windowsDriverUpdateProfile (beta) */
export interface DriverUpdateProfile {
  id: string;
  displayName: string;
  description?: string;
  approvalType?: 'manual' | 'automatic';
  deploymentDeferralInDays?: number;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  assignments?: PolicyAssignmentSummary;
}

/** windowsDriverUpdateInventory - a specific driver within a driver update profile */
export interface DriverInventoryItem {
  id: string;
  name: string;
  version: string;
  manufacturer?: string;
  category?: string;
  approvalStatus: 'needsReview' | 'declined' | 'approved' | 'suspended';
  applicableDeviceCount?: number;
  deployDateTime?: string | null;
}

/** A DriverInventoryItem tagged with which profile it came from - used by the
 * fleet-wide aggregate across all Driver Update Profiles. */
export interface DriverInventoryItemWithProfile extends DriverInventoryItem {
  profileId: string;
  profileName: string;
}

/** M365 Apps update channel policy - Settings Catalog backed (empirically
 * unconfirmed against Graph docs, verify setting definition id before use). */
export interface M365AppsUpdateProfile {
  id: string;
  displayName: string;
  description?: string;
  updateChannel: 'current' | 'monthlyEnterprise' | 'semiAnnual' | 'semiAnnualPreview' | 'beta';
  createdDateTime?: string;
  lastModifiedDateTime?: string;
}

/** windowsFeatureUpdateCatalogItem - a Microsoft-published feature update
 * release (Windows version), from the shared deviceManagement/
 * windowsUpdateCatalogItems collection. Read-only reference data, not
 * tenant-specific config. */
export interface FeatureUpdateCatalogItem {
  id: string;
  displayName: string;
  version: string;
  releaseDateTime: string;
  endOfSupportDate: string | null;
}

/** One Windows version's build/KB info within a quality update release - a
 * single release (e.g. "2026.07 B Security Update") ships a different build
 * number and KB article per Windows version it applies to. */
export interface QualityUpdateProductRevision {
  versionName: string; // e.g. "24H2", "22H2"
  productName: string; // e.g. "Windows 11", "Windows 10"
  buildNumber: number; // e.g. 26100 - matches the 3rd segment of a device's osVersion
  updateBuildRevision: number; // the "UBR" - 4th segment of osVersion, increases with each cumulative update
  kbArticleId: string | null; // the real KB number, e.g. "KB5101650"
  kbArticleUrl: string | null;
}

/** windowsQualityUpdateCatalogItem - a Microsoft-published quality update
 * release (a specific KB/cumulative update), from the same shared catalog
 * collection as feature updates. Note: the top-level `kbArticleId` field is
 * NOT a real KB number (confirmed empirically it comes back as a build
 * string like "10.0.26200.8893" or empty) - real per-version KB numbers live
 * in `productRevisions[].kbArticleId`. */
export interface QualityUpdateCatalogItem {
  id: string;
  displayName: string;
  releaseDateTime: string;
  endOfSupportDate: string | null;
  kbArticleId: string | null;
  classification: string | null;
  qualityUpdateCadence?: string;
  isExpeditable: boolean;
  productRevisions: QualityUpdateProductRevision[];
  cveSeverityInformation?: {
    maxSeverityLevel: string | null;
    maxBaseScore: number | null;
    exploitedCves: string[];
  };
}

/** Fleet adoption count for a single catalog release, computed client-side by
 * joining against ManagedDevice.osVersion - see lib/intune/windows-update-compliance.ts. */
export interface UpdateAdoptionStats {
  compliant: number;
  applicable: number;
}

/** Per-device quality update status - which releases (for this device's OS
 * branch) it already has vs. is missing, derived from its osVersion build
 * number. Both lists are sorted newest-first, same order as the catalog. */
export interface DeviceQualityUpdateStatus {
  installed: QualityUpdateCatalogItem[];
  missing: QualityUpdateCatalogItem[];
}

/** Per-device feature update status - the catalog entry matching the
 * device's current version (if any), and any newer feature versions
 * released since. */
export interface DeviceFeatureUpdateStatus {
  current: FeatureUpdateCatalogItem | null;
  available: FeatureUpdateCatalogItem[];
}

/** The tool-managed single-device group mapping (device_update_groups table). */
export interface DeviceUpdateGroup {
  deviceId: string;
  azureADDeviceId: string;
  entraGroupId: string;
  createdAt: string;
}

/** A generic assignment as returned by a policy's /assignments nav property. */
export interface WindowsUpdatePolicyAssignment {
  id: string;
  target: AssignmentTarget;
}

/** Display-ready assignment summary for a policy - Graph's assign action
 * only ever returns raw group ids, never names, so list routes resolve them
 * server-side (see lib/intune/windows-update-assignments.ts) before this
 * reaches the client. */
export interface PolicyAssignmentSummary {
  groups: Array<{ id: string; displayName: string }>;
  allDevices: boolean;
  allUsers: boolean;
}

/** Response shape for GET /api/intune/windows-updates/device/[deviceId] -
 * this device's current effective assignment across all 5 policy types. */
export interface DeviceWindowsUpdateAssignments {
  deviceId: string;
  updateGroup: DeviceUpdateGroup | null;
  ring: UpdateRing | null;
  feature: FeatureUpdateProfile | null;
  quality: QualityUpdateProfile | null;
  driver: DriverUpdateProfile | null;
  m365Apps: M365AppsUpdateProfile | null;
}
