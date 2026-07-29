/**
 * Windows Autopilot device identity + deployment reporting types.
 * Backed by Graph's deviceManagement/windowsAutopilotDeviceIdentities.
 * deploymentProfileAssignmentStatus is beta-only - confirmed empirically
 * against a live tenant (v1.0 rejects that $select field outright) - so the
 * capture job (lib/intune-reports/autopilot.ts) queries the beta endpoint.
 */

export type AutopilotEnrollmentState =
  | 'unknown'
  | 'enrolled'
  | 'pending'
  | 'failed'
  | 'notContacted';

export type AutopilotDeploymentProfileAssignmentStatus =
  | 'unknown'
  | 'assignedInSync'
  | 'assignedOutOfSync'
  | 'assignedUnkownSyncState'
  | 'notAssigned'
  | 'pending'
  | 'failed';

export interface AutopilotDevice {
  id: string;
  serialNumber: string | null;
  groupTag: string | null;
  manufacturer: string | null;
  model: string | null;
  enrollmentState: AutopilotEnrollmentState;
  deploymentProfileAssignmentStatus: AutopilotDeploymentProfileAssignmentStatus;
  lastContactedDateTime: string | null;
  capturedAt: string;
}

/**
 * Funnel is Registered -> Profile Assigned -> Enrolled. There is no
 * "provisioned"/ESP-completion signal available on this Graph resource -
 * enrollmentState only distinguishes unknown/enrolled/pending/failed/
 * notContacted, so "enrolled" is the last stage this endpoint can attest to.
 * A distinct ESP-outcome-per-device surface would require the separate
 * Autopilot deployment/ESP reporting APIs, out of scope here. `failed` is
 * reported as a separate terminal outcome, not a 4th sequential stage.
 */
export interface AutopilotFunnelCounts {
  registered: number;
  profileAssigned: number;
  enrolled: number;
  failed: number;
}

export interface AutopilotGroupTagCount {
  groupTag: string; // '(none)' for devices with an empty/null tag
  count: number;
}

export interface AutopilotFailureReasonCount {
  status: AutopilotDeploymentProfileAssignmentStatus;
  count: number;
}

export interface AutopilotSummary {
  funnel: AutopilotFunnelCounts;
  groupTags: AutopilotGroupTagCount[];
  failureReasons: AutopilotFailureReasonCount[];
  totalDevices: number;
  capturedAt: string | null;
}

export interface AutopilotReportResponse {
  configured: boolean;
  reason?: string;
  permissionRequired?: string;
  summary?: AutopilotSummary;
}
