/**
 * Fleet-compliance join for the Release Catalog - answers "how many of our
 * devices have this update?" by comparing each device's reported osVersion
 * against the catalog release's known build numbers. Pure client-safe
 * functions only (no Graph calls) - importable directly from 'use client'
 * components, same as windows-update-catalog.ts's kbArticleUrl was.
 */

import type {
  FeatureUpdateCatalogItem,
  QualityUpdateCatalogItem,
  UpdateAdoptionStats,
  DeviceQualityUpdateStatus,
  DeviceFeatureUpdateStatus,
} from '@/types/windows-updates';

export interface ParsedOsVersion {
  buildNumber: number;
  revision: number;
}

/** Parses a Graph osVersion string ("10.0.26200.8655") into its build/UBR
 * segments. Returns null for anything that doesn't look like a Windows build
 * string (e.g. macOS/iOS versions, or a missing value). */
export function parseOsVersion(osVersion: string | null | undefined): ParsedOsVersion | null {
  if (!osVersion) return null;
  const parts = osVersion.split('.');
  if (parts.length < 4) return null;
  const buildNumber = Number(parts[2]);
  const revision = Number(parts[3]);
  if (!Number.isFinite(buildNumber) || !Number.isFinite(revision)) return null;
  return { buildNumber, revision };
}

/** For a quality update release, how many fleet devices are on this update or
 * later. "Applicable" is scoped to devices whose build branch this specific
 * release actually targets (a release doesn't always cover every supported
 * Windows version), not the whole fleet. */
export function computeQualityAdoption(
  devices: Array<{ osVersion: string | null }>,
  item: QualityUpdateCatalogItem
): UpdateAdoptionStats {
  const requiredRevisionByBuild = new Map<number, number>();
  for (const revision of item.productRevisions) {
    requiredRevisionByBuild.set(revision.buildNumber, revision.updateBuildRevision);
  }

  let applicable = 0;
  let compliant = 0;
  for (const device of devices) {
    const parsed = parseOsVersion(device.osVersion);
    if (!parsed) continue;
    const requiredRevision = requiredRevisionByBuild.get(parsed.buildNumber);
    if (requiredRevision === undefined) continue;
    applicable++;
    if (parsed.revision >= requiredRevision) compliant++;
  }
  return { compliant, applicable };
}

/** Windows has no Graph-exposed "version name -> build number" table for
 * feature updates, so this derives one empirically from the quality
 * catalog's productRevisions (which do carry both) rather than hardcoding a
 * static, easily stale mapping. */
export function buildFeatureVersionMap(qualityItems: QualityUpdateCatalogItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of qualityItems) {
    for (const revision of item.productRevisions) {
      if (revision.versionName && !map.has(revision.versionName)) {
        map.set(revision.versionName, revision.buildNumber);
      }
    }
  }
  return map;
}

/** Which quality releases (for this device's own OS branch) it already has
 * vs. is missing, derived purely from its osVersion build/UBR - no Log
 * Analytics/WUfB reporting required. Catalog arrays are already sorted
 * newest-first, so both output lists preserve that order. */
export function computeDeviceQualityStatus(
  osVersion: string | null | undefined,
  qualityItems: QualityUpdateCatalogItem[]
): DeviceQualityUpdateStatus | null {
  const parsed = parseOsVersion(osVersion);
  if (!parsed) return null;

  const installed: QualityUpdateCatalogItem[] = [];
  const missing: QualityUpdateCatalogItem[] = [];
  for (const item of qualityItems) {
    const revision = item.productRevisions.find((r) => r.buildNumber === parsed.buildNumber);
    if (!revision) continue; // release doesn't target this device's branch
    if (parsed.revision >= revision.updateBuildRevision) {
      installed.push(item);
    } else {
      missing.push(item);
    }
  }
  return { installed, missing };
}

const VERSION_NAME_PATTERN = /(\d{2}H\d)/;

/** The device's current feature version (matched against the catalog) and
 * any newer feature versions released since. */
export function computeDeviceFeatureStatus(
  osVersion: string | null | undefined,
  featureItems: FeatureUpdateCatalogItem[],
  versionBuildMap: Map<string, number>
): DeviceFeatureUpdateStatus | null {
  const parsed = parseOsVersion(osVersion);
  if (!parsed) return null;

  let currentVersionName: string | null = null;
  for (const [versionName, build] of versionBuildMap) {
    if (build === parsed.buildNumber) {
      currentVersionName = versionName;
      break;
    }
  }

  const current = currentVersionName
    ? featureItems.find((item) => item.version.match(VERSION_NAME_PATTERN)?.[1] === currentVersionName) ?? null
    : null;

  const available = current
    ? featureItems.filter((item) => item.releaseDateTime > current.releaseDateTime)
    : [];

  return { current, available };
}

/** For a feature update release, how many fleet devices currently report
 * that exact build (i.e. are on this version right now) - not "or later",
 * since major Windows versions/product lines aren't in a single numeric
 * order the way quality-update builds within one branch are. */
export function computeFeatureAdoption(
  devices: Array<{ osVersion: string | null }>,
  item: FeatureUpdateCatalogItem,
  versionBuildMap: Map<string, number>
): UpdateAdoptionStats {
  const versionName = item.version.match(VERSION_NAME_PATTERN)?.[1];
  const targetBuild = versionName ? versionBuildMap.get(versionName) : undefined;

  let applicable = 0;
  let compliant = 0;
  for (const device of devices) {
    const parsed = parseOsVersion(device.osVersion);
    if (!parsed) continue;
    applicable++;
    if (targetBuild !== undefined && parsed.buildNumber === targetBuild) compliant++;
  }
  return { compliant, applicable };
}
