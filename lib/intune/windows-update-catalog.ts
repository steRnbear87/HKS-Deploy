/**
 * Windows Update release catalog (deviceManagement/windowsUpdateCatalogItems)
 *
 * Microsoft-maintained, read-only reference data - a polymorphic collection
 * of published feature and quality update releases (confirmed empirically
 * against a real tenant; not documented as a distinct top-level resource in
 * public Graph docs at the time this was built). Distinct from the
 * tenant-specific policy resources in windows-update-rings.ts /
 * windows-feature-updates.ts / windows-quality-updates.ts - this is "what
 * updates exist", not "what this tenant has configured".
 *
 * The API does not allow $orderby on this collection (confirmed empirically -
 * returns 400), so callers sort client-side by releaseDateTime.
 */

import { fetchWithRetry } from './graph-client';
import type {
  FeatureUpdateCatalogItem,
  QualityUpdateCatalogItem,
  QualityUpdateProductRevision,
} from '@/types/windows-updates';

const GRAPH_API_BASE_BETA = 'https://graph.microsoft.com/beta';
const RESOURCE = 'deviceManagement/windowsUpdateCatalogItems';
// Catalog spans years of releases; cap what we pull per list call rather than
// paginating the entire history for a UI that only shows recent releases.
const FETCH_TOP = 200;

function toFeatureUpdateCatalogItem(raw: Record<string, unknown>): FeatureUpdateCatalogItem {
  return {
    id: raw.id as string,
    displayName: raw.displayName as string,
    version: raw.version as string,
    releaseDateTime: raw.releaseDateTime as string,
    endOfSupportDate: (raw.endOfSupportDate as string | null) ?? null,
  };
}

function toProductRevision(raw: Record<string, unknown>): QualityUpdateProductRevision {
  const osBuild = raw.osBuild as { buildNumber?: number; updateBuildRevision?: number } | undefined;
  const kb = raw.knowledgeBaseArticle as { articleId?: string; articleUrl?: string } | undefined;
  return {
    versionName: (raw.versionName as string) || '',
    productName: (raw.productName as string) || '',
    buildNumber: osBuild?.buildNumber ?? 0,
    updateBuildRevision: osBuild?.updateBuildRevision ?? 0,
    kbArticleId: kb?.articleId || null,
    kbArticleUrl: kb?.articleUrl || null,
  };
}

function toQualityUpdateCatalogItem(raw: Record<string, unknown>): QualityUpdateCatalogItem {
  const cve = raw.cveSeverityInformation as
    | { maxSeverityLevel?: string | null; maxBaseScore?: number | null; exploitedCves?: string[] }
    | undefined;
  return {
    id: raw.id as string,
    displayName: raw.displayName as string,
    releaseDateTime: raw.releaseDateTime as string,
    endOfSupportDate: (raw.endOfSupportDate as string | null) ?? null,
    kbArticleId: (raw.kbArticleId as string) || null,
    classification: (raw.classification as string) || null,
    qualityUpdateCadence: raw.qualityUpdateCadence as string | undefined,
    isExpeditable: Boolean(raw.isExpeditable),
    productRevisions: ((raw.productRevisions as Array<Record<string, unknown>>) || []).map(toProductRevision),
    cveSeverityInformation: cve
      ? {
          maxSeverityLevel: cve.maxSeverityLevel ?? null,
          maxBaseScore: cve.maxBaseScore ?? null,
          exploitedCves: cve.exploitedCves || [],
        }
      : undefined,
  };
}

export async function listFeatureUpdateCatalog(token: string): Promise<FeatureUpdateCatalogItem[]> {
  const url = `${GRAPH_API_BASE_BETA}/${RESOURCE}?$filter=${encodeURIComponent(
    "isof('microsoft.graph.windowsFeatureUpdateCatalogItem')"
  )}&$top=${FETCH_TOP}`;
  const response = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }, 3);

  if (!response.ok) {
    throw new Error(`Failed to list feature update catalog: ${response.status}`);
  }

  const data: { value?: Array<Record<string, unknown>> } = await response.json();
  const items = (data.value || []).map(toFeatureUpdateCatalogItem);
  return items.sort((a, b) => b.releaseDateTime.localeCompare(a.releaseDateTime));
}

export async function listQualityUpdateCatalog(token: string): Promise<QualityUpdateCatalogItem[]> {
  const url = `${GRAPH_API_BASE_BETA}/${RESOURCE}?$filter=${encodeURIComponent(
    "isof('microsoft.graph.windowsQualityUpdateCatalogItem')"
  )}&$top=${FETCH_TOP}`;
  const response = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }, 3);

  if (!response.ok) {
    throw new Error(`Failed to list quality update catalog: ${response.status}`);
  }

  const data: { value?: Array<Record<string, unknown>> } = await response.json();
  const items = (data.value || []).map(toQualityUpdateCatalogItem);
  return items.sort((a, b) => b.releaseDateTime.localeCompare(a.releaseDateTime));
}

/** Distinct real KB articles referenced by a quality update release, one per
 * Windows version it applies to (a single release often spans several KBs -
 * e.g. Windows 10 22H2 and Windows 11 24H2 can ship different KB numbers in
 * the same monthly rollup). Dedupes by article id since sibling versions
 * frequently share the same KB. */
export function distinctKbLinks(
  item: QualityUpdateCatalogItem
): Array<{ articleId: string; articleUrl: string }> {
  const seen = new Map<string, { articleId: string; articleUrl: string }>();
  for (const revision of item.productRevisions) {
    if (revision.kbArticleId && revision.kbArticleUrl && !seen.has(revision.kbArticleId)) {
      seen.set(revision.kbArticleId, { articleId: revision.kbArticleId, articleUrl: revision.kbArticleUrl });
    }
  }
  return Array.from(seen.values());
}
