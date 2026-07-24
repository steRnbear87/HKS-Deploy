/**
 * Shared device-health bucketing logic. Extracted so the live Devices page,
 * the fleet-health snapshot job, and the stale/non-compliant banner all
 * agree on the exact same definitions of "stale" and "non-compliant" -
 * duplicating these thresholds risks the UI and the trend data silently
 * disagreeing.
 */

import type { DeviceComplianceState, DevicePlatform, DevicePlatformCounts, DeviceEncryptionCounts } from '@/types/devices';

export const STALE_DAYS = 7;

export function isStale(lastSyncDateTime: string, now: number = Date.now()): boolean {
  const staleCutoff = now - STALE_DAYS * 24 * 60 * 60 * 1000;
  return new Date(lastSyncDateTime).getTime() < staleCutoff;
}

export function isNonCompliant(complianceState: DeviceComplianceState): boolean {
  return (
    complianceState === 'noncompliant' ||
    complianceState === 'error' ||
    complianceState === 'conflict'
  );
}

export interface DeviceHealthCounts {
  total: number;
  compliant: number;
  nonCompliant: number;
  inGracePeriod: number;
  configManager: number;
  unknown: number;
  stale: number;
}

export function summarizeDeviceHealth(
  deviceStates: Array<{ complianceState: DeviceComplianceState; lastSyncDateTime: string }>
): DeviceHealthCounts {
  const now = Date.now();
  return {
    total: deviceStates.length,
    compliant: deviceStates.filter((d) => d.complianceState === 'compliant').length,
    nonCompliant: deviceStates.filter((d) => isNonCompliant(d.complianceState)).length,
    inGracePeriod: deviceStates.filter((d) => d.complianceState === 'inGracePeriod').length,
    configManager: deviceStates.filter((d) => d.complianceState === 'configManager').length,
    unknown: deviceStates.filter((d) => d.complianceState === 'unknown').length,
    stale: deviceStates.filter((d) => isStale(d.lastSyncDateTime, now)).length,
  };
}

/**
 * Ecosystem grouping derived from Graph's `operatingSystem` string. Confirmed
 * empirically for this tenant: "Windows", "macOS", "iOS" (no Android/Linux
 * observed) - matched case-insensitively with a real "other" fallback so an
 * unexpected platform never silently vanishes from the total.
 */
export function getDevicePlatform(operatingSystem: string): DevicePlatform {
  const os = operatingSystem.toLowerCase();
  if (os === 'windows') return 'microsoft';
  if (os === 'macos' || os === 'ios' || os === 'ipados') return 'apple';
  if (os === 'android') return 'google';
  return 'other';
}

export function summarizeDevicePlatforms(
  devices: Array<{ operatingSystem: string }>
): DevicePlatformCounts {
  const counts: DevicePlatformCounts = { total: devices.length, microsoft: 0, apple: 0, google: 0, other: 0 };
  for (const device of devices) {
    counts[getDevicePlatform(device.operatingSystem)]++;
  }
  return counts;
}

/**
 * BitLocker (Windows)/FileVault (macOS) rollup. iOS/Android are intentionally
 * excluded - neither platform has a BitLocker/FileVault equivalent, so
 * counting them as "unencrypted" would misrepresent risk.
 */
/**
 * Normalizes a Graph detectedApps displayName for grouping app+version
 * variants under one key. Shared by the fleet app-inventory snapshot job and
 * deployment-drift detection so both agree on the same app-matching rule.
 */
export function normalizeAppKey(displayName: string): string {
  return displayName.trim().toLowerCase();
}

export function summarizeDeviceEncryption(
  devices: Array<{ operatingSystem: string; isEncrypted: boolean | null }>
): DeviceEncryptionCounts {
  const counts: DeviceEncryptionCounts = {
    windowsEncrypted: 0,
    windowsUnencrypted: 0,
    windowsUnknown: 0,
    macEncrypted: 0,
    macUnencrypted: 0,
    macUnknown: 0,
  };
  for (const device of devices) {
    const platform = getDevicePlatform(device.operatingSystem);
    if (platform === 'microsoft') {
      if (device.isEncrypted === true) counts.windowsEncrypted++;
      else if (device.isEncrypted === false) counts.windowsUnencrypted++;
      else counts.windowsUnknown++;
    } else if (platform === 'apple' && device.operatingSystem.toLowerCase() === 'macos') {
      if (device.isEncrypted === true) counts.macEncrypted++;
      else if (device.isEncrypted === false) counts.macUnencrypted++;
      else counts.macUnknown++;
    }
  }
  return counts;
}
