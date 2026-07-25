import type { CatalogFilterOptions, LicenseBucket } from './types';

const LICENSE_BUCKETS: LicenseBucket[] = ['open-source', 'freeware', 'proprietary', 'unknown'];

function parseList(value: string | null): string[] | null {
  if (!value) return null;
  const items = value.split(',').map((v) => v.trim()).filter(Boolean);
  return items.length > 0 ? items : null;
}

/** Shared between /api/winget/popular and /api/winget/search - builds the facet filters from query params. */
export function parseCatalogFilters(searchParams: URLSearchParams): CatalogFilterOptions {
  const categories = parseList(searchParams.get('categories'));
  const licenseBuckets =
    parseList(searchParams.get('license'))?.filter((v): v is LicenseBucket =>
      LICENSE_BUCKETS.includes(v as LicenseBucket)
    ) ?? null;

  return {
    categories,
    needsCategorization: searchParams.get('needsCategorization') === 'true',
    publisher: searchParams.get('publisher')?.trim() || null,
    tag: searchParams.get('tag')?.trim() || null,
    licenseBuckets,
    appSources: parseList(searchParams.get('source')),
    includeLocaleVariants: searchParams.get('includeVariants') === 'true',
    installerTypes: parseList(searchParams.get('installerType')),
  };
}
