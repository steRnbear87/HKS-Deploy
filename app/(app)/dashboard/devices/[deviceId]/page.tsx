'use client';

import { use } from 'react';
import { T } from 'gt-next';
import { AlertCircle, RefreshCw, HardDrive, ShieldCheck, BatteryMedium, Network, Info, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusTone } from '@/components/ui/status-badge';
import { PageHeader, AnimatedEmptyState, SkeletonGrid } from '@/components/dashboard';
import { useDeviceDetails } from '@/hooks/use-devices';
import { DeviceLogsSection } from '@/components/devices/DeviceLogsSection';
import { DeviceWindowsUpdatesSection } from '@/components/devices/DeviceWindowsUpdatesSection';
import { DeviceAppInventorySection } from '@/components/devices/DeviceAppInventorySection';
import { DeviceComplianceStatusSection } from '@/components/devices/DeviceComplianceStatusSection';
import { DeviceActionsMenu } from '@/components/devices/DeviceActionsMenu';
import type { DeviceComplianceState } from '@/types/devices';

const complianceTone: Record<DeviceComplianceState, StatusTone> = {
  compliant: 'success',
  noncompliant: 'error',
  conflict: 'error',
  error: 'error',
  inGracePeriod: 'warning',
  configManager: 'info',
  unknown: 'neutral',
};

const complianceLabel: Record<DeviceComplianceState, string> = {
  compliant: 'Compliant',
  noncompliant: 'Non-compliant',
  conflict: 'Conflict',
  error: 'Error',
  inGracePeriod: 'Grace period',
  configManager: 'Config Manager',
  unknown: 'Unknown',
};

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return 'Unknown';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return 'Unknown';
  const gb = bytes / 1024 ** 3;
  return `${gb.toFixed(1)} GB`;
}

function MetadataItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-text-muted mb-1">{label}</p>
      <p className="text-sm text-text-primary">{value ?? '—'}</p>
    </div>
  );
}

/** True if at least one value is a non-null, non-empty-string, non-undefined value - used to skip rendering a whole section when Intune hasn't collected anything for it. */
function hasAny(values: Array<string | number | boolean | null | undefined>): boolean {
  return values.some((v) => v !== null && v !== undefined && v !== '');
}

export default function DeviceDetailPage({ params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = use(params);
  const { data, isLoading, error, refetch, isFetching } = useDeviceDetails(deviceId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={<T>Device</T>}
          breadcrumbs={[{ label: 'Devices', href: '/dashboard/devices' }, { label: 'Loading...' }]}
        />
        <SkeletonGrid count={2} columns={2} variant="content" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={<T>Device</T>}
          breadcrumbs={[{ label: 'Devices', href: '/dashboard/devices' }]}
        />
        <AnimatedEmptyState
          icon={AlertCircle}
          title={<T>Failed to load device</T>}
          description={error.message}
          color="neutral"
          action={{ label: 'Try Again', onClick: () => refetch(), variant: 'secondary' }}
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={<T>Device</T>}
          breadcrumbs={[{ label: 'Devices', href: '/dashboard/devices' }]}
        />
        <SkeletonGrid count={2} columns={2} variant="content" />
      </div>
    );
  }

  const device = data.device;

  return (
    <div className="space-y-6">
      <PageHeader
        title={device.deviceName}
        breadcrumbs={[{ label: 'Devices', href: '/dashboard/devices' }, { label: device.deviceName }]}
        badge={{
          text: complianceLabel[device.complianceState],
          variant:
            device.complianceState === 'compliant'
              ? 'success'
              : device.complianceState === 'noncompliant' || device.complianceState === 'error'
                ? 'error'
                : 'default',
        }}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => refetch()}
              disabled={isFetching}
              className="text-text-secondary hover:text-text-primary"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
              <T>Refresh</T>
            </Button>
            <DeviceActionsMenu deviceId={deviceId} deviceName={device.deviceName} />
          </div>
        }
      />

      {/* Hardware overview */}
      <div className="glass-light rounded-xl border border-overlay/5 p-6">
        <div className="flex items-center gap-2 mb-4">
          <HardDrive className="w-4 h-4 text-accent-cyan" />
          <h2 className="text-lg font-semibold text-text-primary"><T>Hardware</T></h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetadataItem label="Operating System" value={`${device.operatingSystem} ${device.osVersion || ''}`} />
          <MetadataItem label="Model" value={device.model} />
          <MetadataItem label="Manufacturer" value={device.manufacturer} />
          <MetadataItem label="Serial Number" value={device.serialNumber} />
          <MetadataItem label="Storage" value={`${formatBytes(device.freeStorageSpaceInBytes)} free of ${formatBytes(device.totalStorageSpaceInBytes)}`} />
          <MetadataItem label="Memory" value={formatBytes(device.physicalMemoryInBytes)} />
          <MetadataItem label="Management Agent" value={device.managementAgent} />
          <MetadataItem label="Management State" value={device.managementState} />
          {device.chassisType && device.chassisType !== 'unknown' && (
            <MetadataItem label="Chassis Type" value={device.chassisType} />
          )}
          {device.processorArchitecture && device.processorArchitecture !== 'unknown' && (
            <MetadataItem label="Processor Architecture" value={device.processorArchitecture} />
          )}
          {device.hardwareInformation?.systemManagementBIOSVersion && (
            <MetadataItem label="BIOS Version" value={device.hardwareInformation.systemManagementBIOSVersion} />
          )}
        </div>
      </div>

      {/* Enrollment & compliance */}
      <div className="glass-light rounded-xl border border-overlay/5 p-6">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck className="w-4 h-4 text-accent-cyan" />
          <h2 className="text-lg font-semibold text-text-primary"><T>Enrollment &amp; Compliance</T></h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetadataItem
            label="Compliance State"
            value={<StatusBadge tone={complianceTone[device.complianceState]}>{complianceLabel[device.complianceState]}</StatusBadge>}
          />
          <MetadataItem label="Last Sync" value={formatDate(device.lastSyncDateTime)} />
          <MetadataItem label="Enrolled" value={formatDate(device.enrolledDateTime)} />
          <MetadataItem label="Enrollment Type" value={device.deviceEnrollmentType} />
          <MetadataItem label="Primary User" value={device.userPrincipalName} />
          <MetadataItem label="Owner Type" value={device.managedDeviceOwnerType} />
          {device.joinType && device.joinType !== 'unknown' && (
            <MetadataItem label="Join Type" value={device.joinType} />
          )}
          {device.isEncrypted !== null && (
            <MetadataItem label="Encrypted" value={device.isEncrypted ? 'Yes' : 'No'} />
          )}
          {device.deviceFirmwareConfigurationInterfaceManaged !== null && (
            <MetadataItem label="DFCI Managed" value={device.deviceFirmwareConfigurationInterfaceManaged ? 'Yes' : 'No'} />
          )}
          {device.deviceHealthAttestationState?.bitLockerStatus && (
            <MetadataItem label="BitLocker" value={device.deviceHealthAttestationState.bitLockerStatus} />
          )}
          {device.deviceHealthAttestationState?.secureBoot && (
            <MetadataItem label="Secure Boot" value={device.deviceHealthAttestationState.secureBoot} />
          )}
          {device.deviceHealthAttestationState?.tpmVersion && (
            <MetadataItem label="TPM Version" value={device.deviceHealthAttestationState.tpmVersion} />
          )}
          {device.hardwareInformation?.tpmSpecificationVersion && (
            <MetadataItem label="TPM Specification" value={device.hardwareInformation.tpmSpecificationVersion} />
          )}
          {device.hardwareInformation?.tpmManufacturer && (
            <MetadataItem label="TPM Manufacturer" value={device.hardwareInformation.tpmManufacturer} />
          )}
          {device.deviceHealthAttestationState?.virtualizationBasedSecurity && (
            <MetadataItem label="Virtualization-Based Security" value={device.deviceHealthAttestationState.virtualizationBasedSecurity} />
          )}
          {device.deviceHealthAttestationState?.memoryIntegrityProtection && (
            <MetadataItem label="Memory Integrity" value={device.deviceHealthAttestationState.memoryIntegrityProtection} />
          )}
          {device.deviceHealthAttestationState?.firmwareProtection && (
            <MetadataItem label="Firmware Protection" value={device.deviceHealthAttestationState.firmwareProtection} />
          )}
          {device.deviceHealthAttestationState?.securedCorePC && (
            <MetadataItem label="Secured-Core PC" value={device.deviceHealthAttestationState.securedCorePC} />
          )}
        </div>
      </div>

      {/* Battery - only for devices Intune has reported battery data for */}
      {hasAny([
        device.hardwareInformation?.batteryLevelPercentage,
        device.hardwareInformation?.batteryHealthPercentage,
        device.hardwareInformation?.batteryChargeCycles,
        device.hardwareInformation?.batterySerialNumber,
      ]) && (
        <div className="glass-light rounded-xl border border-overlay/5 p-6">
          <div className="flex items-center gap-2 mb-4">
            <BatteryMedium className="w-4 h-4 text-accent-cyan" />
            <h2 className="text-lg font-semibold text-text-primary"><T>Battery</T></h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {device.hardwareInformation?.batteryLevelPercentage != null && (
              <MetadataItem label="Charge Level" value={`${device.hardwareInformation.batteryLevelPercentage}%`} />
            )}
            {device.hardwareInformation?.batteryHealthPercentage != null && (
              <MetadataItem label="Health" value={`${device.hardwareInformation.batteryHealthPercentage}%`} />
            )}
            {device.hardwareInformation?.batteryChargeCycles != null && (
              <MetadataItem label="Charge Cycles" value={device.hardwareInformation.batteryChargeCycles} />
            )}
            {device.hardwareInformation?.batterySerialNumber && (
              <MetadataItem label="Serial Number" value={device.hardwareInformation.batterySerialNumber} />
            )}
          </div>
        </div>
      )}

      {/* Network - only when Intune has reported at least one network-related value */}
      {hasAny([
        device.ethernetMacAddress,
        device.wiFiMacAddress,
        device.hardwareInformation?.ipAddressV4,
        device.hardwareInformation?.subnetAddress,
        device.hardwareInformation?.deviceFullQualifiedDomainName,
      ]) && (
        <div className="glass-light rounded-xl border border-overlay/5 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Network className="w-4 h-4 text-accent-cyan" />
            <h2 className="text-lg font-semibold text-text-primary"><T>Network</T></h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {device.hardwareInformation?.ipAddressV4 && (
              <MetadataItem label="IPv4 Address" value={device.hardwareInformation.ipAddressV4} />
            )}
            {device.hardwareInformation?.subnetAddress && (
              <MetadataItem label="Subnet" value={device.hardwareInformation.subnetAddress} />
            )}
            {device.wiFiMacAddress && <MetadataItem label="Wi-Fi MAC" value={device.wiFiMacAddress} />}
            {device.ethernetMacAddress && <MetadataItem label="Ethernet MAC" value={device.ethernetMacAddress} />}
            {device.hardwareInformation?.deviceFullQualifiedDomainName && (
              <MetadataItem label="FQDN" value={device.hardwareInformation.deviceFullQualifiedDomainName} />
            )}
          </div>
        </div>
      )}

      {/* System Info - only when Intune has reported at least one of these values */}
      {hasAny([
        device.hardwareInformation?.operatingSystemEdition,
        device.hardwareInformation?.osBuildNumber,
        device.hardwareInformation?.operatingSystemLanguage,
        device.hardwareInformation?.productName,
        device.hardwareInformation?.residentUsersCount,
        device.skuFamily,
        device.skuNumber,
      ]) && (
        <div className="glass-light rounded-xl border border-overlay/5 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Info className="w-4 h-4 text-accent-cyan" />
            <h2 className="text-lg font-semibold text-text-primary"><T>System Info</T></h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {device.hardwareInformation?.operatingSystemEdition && (
              <MetadataItem label="OS Edition" value={device.hardwareInformation.operatingSystemEdition} />
            )}
            {device.hardwareInformation?.osBuildNumber && (
              <MetadataItem label="OS Build" value={device.hardwareInformation.osBuildNumber} />
            )}
            {device.hardwareInformation?.operatingSystemLanguage && (
              <MetadataItem label="OS Language" value={device.hardwareInformation.operatingSystemLanguage} />
            )}
            {device.hardwareInformation?.productName && (
              <MetadataItem label="Product Name" value={device.hardwareInformation.productName} />
            )}
            {device.hardwareInformation?.residentUsersCount != null && (
              <MetadataItem label="Resident Users" value={device.hardwareInformation.residentUsersCount} />
            )}
            {device.skuFamily && <MetadataItem label="SKU Family" value={device.skuFamily} />}
            {device.skuNumber != null && <MetadataItem label="SKU Number" value={device.skuNumber} />}
          </div>
        </div>
      )}

      {/* Configuration Manager - only for co-managed devices */}
      {hasAny([
        device.configurationManagerClientInformation?.clientVersion,
        device.configurationManagerClientInformation?.clientIdentifier,
        device.configurationManagerClientHealthState?.state,
      ]) && (
        <div className="glass-light rounded-xl border border-overlay/5 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Server className="w-4 h-4 text-accent-cyan" />
            <h2 className="text-lg font-semibold text-text-primary"><T>Configuration Manager</T></h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {device.configurationManagerClientInformation?.clientVersion && (
              <MetadataItem label="Client Version" value={device.configurationManagerClientInformation.clientVersion} />
            )}
            {device.configurationManagerClientInformation?.clientIdentifier && (
              <MetadataItem label="Client ID" value={device.configurationManagerClientInformation.clientIdentifier} />
            )}
            {device.configurationManagerClientInformation?.isBlocked !== null && device.configurationManagerClientInformation?.isBlocked !== undefined && (
              <MetadataItem label="Blocked" value={device.configurationManagerClientInformation.isBlocked ? 'Yes' : 'No'} />
            )}
            {device.configurationManagerClientHealthState?.state && (
              <MetadataItem label="Client Health" value={device.configurationManagerClientHealthState.state} />
            )}
            {device.configurationManagerClientHealthState?.lastSyncDateTime && (
              <MetadataItem label="Last ConfigMgr Sync" value={formatDate(device.configurationManagerClientHealthState.lastSyncDateTime)} />
            )}
          </div>
        </div>
      )}

      <DeviceAppInventorySection deviceId={deviceId} />
      <DeviceComplianceStatusSection deviceId={deviceId} />
      <DeviceLogsSection deviceId={deviceId} />
      <DeviceWindowsUpdatesSection deviceId={deviceId} azureADDeviceId={device.azureADDeviceId} />
    </div>
  );
}
