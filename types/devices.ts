/**
 * Managed Devices Types
 * TypeScript interfaces for Intune managed devices (Graph deviceManagement/managedDevices)
 */

export type DeviceComplianceState =
  | 'compliant'
  | 'noncompliant'
  | 'conflict'
  | 'error'
  | 'inGracePeriod'
  | 'configManager'
  | 'unknown';

export type DeviceEnrollmentType =
  | 'userEnrollment'
  | 'deviceRestoreOrRetire'
  | 'appleBulkWithUser'
  | 'appleBulkWithoutUser'
  | 'windowsAzureADJoin'
  | 'windowsBulkUserless'
  | 'windowsAutoEnrollment'
  | 'windowsBulkAzureDomainJoin'
  | 'windowsCoManagement'
  | 'windowsAzureADJoinUsingDeviceAuth'
  | 'appleUserEnrollment'
  | 'appleUserEnrollmentWithServiceAccount'
  | 'unknown';

export interface ManagedDevice {
  id: string;
  deviceName: string;
  operatingSystem: string;
  osVersion: string | null;
  complianceState: DeviceComplianceState;
  lastSyncDateTime: string;
  model: string | null;
  manufacturer: string | null;
  managedDeviceOwnerType: 'company' | 'personal' | 'unknown';
  userPrincipalName: string | null;
  isEncrypted: boolean | null;
  /** Graph enum, e.g. 'mdm', 'eas', 'configurationManagerClientMdm' - render via a friendly-label map, don't show raw. */
  managementAgent: string;
  enrolledDateTime: string;
  serialNumber: string | null;
  /** Joined in from the device_bios_info cache table server-side (see app/api/intune/devices/route.ts) - not a Graph field on this endpoint. Null until the BIOS snapshot job has captured this device. */
  biosVersion: string | null;
  biosCapturedAt: string | null;
  /** Entra ID device object's `deviceId` GUID - needed to target this device with a dedicated Windows Update group (lib/intune/device-update-groups.ts). Null for devices with no Entra ID device record. */
  azureADDeviceId: string | null;
}

/** Ecosystem grouping for the Overview page's platform breakdown - not a Graph enum, derived from operatingSystem. */
export type DevicePlatform = 'microsoft' | 'apple' | 'google' | 'other';

export interface DevicePlatformCounts {
  total: number;
  microsoft: number;
  apple: number;
  google: number;
  other: number;
}

/**
 * BitLocker (Windows)/FileVault (macOS) encryption rollup. `*Unknown` is kept
 * distinct from `*Unencrypted` - `isEncrypted === null` means Intune hasn't
 * reported a value yet, which is a different security posture than a
 * confirmed-unencrypted device.
 */
export interface DeviceEncryptionCounts {
  windowsEncrypted: number;
  windowsUnencrypted: number;
  windowsUnknown: number;
  macEncrypted: number;
  macUnencrypted: number;
  macUnknown: number;
}

/** BitLocker/Secure Boot/TPM/VBS attestation summary; not all fields are populated for every device/platform. */
export interface DeviceHealthAttestationState {
  bitLockerStatus?: string | null;
  secureBoot?: string | null;
  bootManagerVersion?: string | null;
  tpmVersion?: string | null;
  attestationIdentityKey?: string | null;
  codeIntegrity?: string | null;
  virtualizationBasedSecurity?: string | null;
  memoryIntegrityProtection?: string | null;
  firmwareProtection?: string | null;
  systemManagementMode?: string | null;
  securedCorePC?: string | null;
}

/**
 * Graph's `hardwareInformation` complex property. Most fields are only
 * populated for Windows devices and only when this exact device was fetched
 * with `$select` (never populated on list responses) - null/empty on other
 * platforms or when Intune hasn't collected that particular value yet.
 */
export interface HardwareInformation {
  batterySerialNumber: string | null;
  batteryHealthPercentage: number | null;
  batteryChargeCycles: number | null;
  batteryLevelPercentage: number | null;
  tpmSpecificationVersion: string | null;
  tpmManufacturer: string | null;
  tpmVersion: string | null;
  operatingSystemEdition: string | null;
  operatingSystemLanguage: string | null;
  osBuildNumber: string | null;
  systemManagementBIOSVersion: string | null;
  ipAddressV4: string | null;
  subnetAddress: string | null;
  wiredIPv4Addresses: string[] | null;
  deviceFullQualifiedDomainName: string | null;
  productName: string | null;
  residentUsersCount: number | null;
}

export interface ConfigurationManagerClientHealthState {
  state: string | null;
  errorCode: number | null;
  lastSyncDateTime: string | null;
}

export interface ConfigurationManagerClientInformation {
  clientIdentifier: string | null;
  isBlocked: boolean | null;
  clientVersion: string | null;
}

export type DeviceChassisType =
  | 'unknown'
  | 'desktop'
  | 'laptop'
  | 'worksWorkstation'
  | 'enterpriseServer'
  | 'phone'
  | 'tablet'
  | 'mobileOther'
  | 'mobileUnknown';

export type DeviceJoinType =
  | 'unknown'
  | 'azureADJoined'
  | 'azureADRegistered'
  | 'hybridAzureADJoined';

export interface ManagedDeviceDetail extends ManagedDevice {
  imei: string | null;
  totalStorageSpaceInBytes: number | null;
  freeStorageSpaceInBytes: number | null;
  physicalMemoryInBytes: number | null;
  deviceEnrollmentType: DeviceEnrollmentType;
  managementState: string;
  /** Join key for Windows Update for Business reports (Log Analytics) lookups. */
  azureADDeviceId: string | null;
  deviceHealthAttestationState: DeviceHealthAttestationState | null;
  hardwareInformation: HardwareInformation | null;
  chassisType: DeviceChassisType | null;
  processorArchitecture: 'unknown' | 'x86' | 'x64' | 'arm' | 'arM64' | null;
  joinType: DeviceJoinType | null;
  ethernetMacAddress: string | null;
  wiFiMacAddress: string | null;
  skuFamily: string | null;
  skuNumber: number | null;
  deviceFirmwareConfigurationInterfaceManaged: boolean | null;
  configurationManagerClientHealthState: ConfigurationManagerClientHealthState | null;
  configurationManagerClientInformation: ConfigurationManagerClientInformation | null;
}

export interface ManagedDevicesResponse {
  devices: ManagedDevice[];
  total: number;
  /** True when Graph pagination was cut short by the scan budget. */
  partial?: boolean;
}

export interface ManagedDeviceDetailResponse {
  device: ManagedDeviceDetail;
}

/**
 * A full diagnostic log collection request/response for a device
 * (Graph deviceLogCollectionResponse - the "Collect diagnostics" flow).
 */
export type DeviceLogCollectionStatus = 'pending' | 'completed' | 'failed' | 'unknownFutureValue';

export interface DeviceLogCollectionRequest {
  id: string;
  status: DeviceLogCollectionStatus;
  requestedDateTimeUTC: string;
  receivedDateTimeUTC: string | null;
  expirationDateTimeUTC: string | null;
  sizeInKB: number | null;
  initiatedByUserPrincipalName: string | null;
}

export interface DeviceLogCollectionListResponse {
  requests: DeviceLogCollectionRequest[];
}

export interface DeviceLogDownloadUrlResponse {
  url: string;
}

/**
 * Windows Update for Business reports (Azure Log Analytics), per device.
 * Not a per-KB installed/missing checklist - Graph/WUfB don't expose that -
 * but real per-device update-event status plus OS-level compliance summary.
 */
export interface WindowsUpdateDeviceSummary {
  osBuild: string | null;
  osVersion: string | null;
  featureUpdateComplianceStatus: string | null;
  qualityUpdateComplianceStatus: string | null;
  securityUpdateComplianceStatus: string | null;
  qualityUpdateStatus: string | null;
  securityUpdateStatus: string | null;
  lastWuScanTime: string | null;
}

export interface WindowsUpdateEvent {
  updateDisplayName: string | null;
  kbNumber: string | null;
  category: string | null;
  classification: string | null;
  clientSubstate: string | null;
  furthestClientSubstate: string | null;
  updateInstalledTime: string | null;
  /** Set when the device first reported entering RebootRequired/RebootPending for this update. */
  restartRequiredTime: string | null;
  timeGenerated: string | null;
}

export interface WindowsUpdatesResponse {
  configured: boolean;
  /** Present only when configured is true. */
  summary?: WindowsUpdateDeviceSummary | null;
  events?: WindowsUpdateEvent[];
  /**
   * Best-effort signal derived from the most recently reported update event
   * that had a RestartRequiredTime set - not a live/authoritative reboot
   * state, just what WUfB reports last observed.
   */
  pendingReboot?: boolean;
  rebootRequiredSince?: string | null;
  /** Human-readable reason when configured is false, for the empty state. */
  reason?: string;
}

/**
 * Installed-app inventory for a device (Graph's `detectedApps` nav property
 * on `managedDevices/{id}`). Confirmed empirically: 404s on v1.0 ("Resource
 * not found for the segment"), works on beta with real data. `sizeInByte`
 * has been observed to always come back as 0 for every app on this tenant -
 * treat it as unreliable rather than a real value.
 */
export interface DetectedApp {
  id: string;
  displayName: string;
  version: string | null;
  publisher: string | null;
}

export interface DeviceAppInventoryResponse {
  configured: boolean;
  apps?: DetectedApp[];
  total?: number;
  /** True if the MAX_APPS cap was hit and results were truncated. */
  truncated?: boolean;
  reason?: string;
  permissionRequired?: string;
}

/**
 * Per-policy/per-profile compliance state for a device (Graph's
 * `deviceCompliancePolicyStates`/`deviceConfigurationStates` nav properties
 * on `managedDevices/{id}`). Confirmed empirically working on v1.0 with real
 * state values (compliant/nonCompliant/unknown observed). The Graph response
 * has been observed to contain duplicate rows (same `id` twice) for some
 * devices - dedupe by `id` when consuming.
 */
export type DevicePolicyComplianceState =
  | 'unknown'
  | 'notApplicable'
  | 'compliant'
  | 'remediated'
  | 'nonCompliant'
  | 'error'
  | 'conflict'
  | 'notAssigned';

export interface DeviceCompliancePolicyState {
  id: string;
  displayName: string | null;
  state: DevicePolicyComplianceState;
  platformType: string | null;
  version: number | null;
}

export interface DeviceConfigurationState {
  id: string;
  displayName: string | null;
  state: DevicePolicyComplianceState;
  platformType: string | null;
  version: number | null;
  settingCount: number | null;
}

export interface DeviceComplianceStatusResponse {
  configured: boolean;
  compliancePolicyStates?: DeviceCompliancePolicyState[];
  configurationStates?: DeviceConfigurationState[];
  reason?: string;
  permissionRequired?: string;
}

/**
 * Fleet-wide (tenant-wide, not per-device) Windows Update for Business
 * status, backed by the same Azure Log Analytics workspace as the per-device
 * feature. Deliberately narrower than the per-device summary - confirmed
 * empirically that `OSQualityUpdateComplianceStatus` (and its Feature/Security
 * siblings) report "NotApplicable" for every device on this tenant, so an
 * Installed/Available split can't be built from real data here. Only
 * pendingRestartCount/devicesScanned/asOf carry real signal.
 */
export interface FleetWindowsUpdateSummary {
  configured: boolean;
  pendingRestartCount?: number;
  devicesScanned?: number;
  asOf?: string | null;
  reason?: string;
}
