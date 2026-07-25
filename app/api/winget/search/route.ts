import { NextRequest, NextResponse } from 'next/server';
import { getCatalogSource } from '@/lib/catalog';
import type { CatalogFilterOptions } from '@/lib/catalog/types';
import { parseCatalogFilters } from '@/lib/catalog/filter-params';

export const fetchCache = 'force-no-store';

interface CuratedAppResult {
  id: number;
  winget_id: string;
  name: string;
  publisher: string;
  latest_version: string;
  description: string | null;
  homepage: string | null;
  category: string | null;
  tags: string[] | null;
  icon_path: string | null;
  popularity_rank: number | null;
  installer_type: string | null;
  rank: number;
  app_source: string | null;
  store_package_id: string | null;
  winget_last_update?: string | null;
  license_bucket?: string | null;
}

// Search curated apps
async function searchCachedPackages(
  query: string,
  limit: number,
  category?: string | null,
  sort: string = 'popular',
  filters?: CatalogFilterOptions
) {
  const { data: curatedData, error: curatedError } = await getCatalogSource().searchApps(
    query,
    { limit, category: category || null, filters }
  );

  if (curatedError) {
    return null;
  }

  if (curatedData && curatedData.length > 0) {
    let results = curatedData as CuratedAppResult[];

    // Apply secondary sorting if requested
    if (sort === 'name') {
      results = results.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'newest') {
      results = results.sort((a, b) => {
        const aTime = a.winget_last_update ? Date.parse(a.winget_last_update) : -Infinity;
        const bTime = b.winget_last_update ? Date.parse(b.winget_last_update) : -Infinity;
        return bTime - aTime;
      });
    }
    // 'popular' keeps the RPC's default relevance + popularity ordering

    return {
      source: 'curated',
      data: results,
    };
  }

  return null;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q') || searchParams.get('query');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const category = searchParams.get('category');
    const sort = searchParams.get('sort') || 'popular';

    if (!query || query.trim().length < 2) {
      return NextResponse.json(
        {
          error:
            'Query parameter "q" is required and must be at least 2 characters',
        },
        { status: 400, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    const sanitizedLimit = Math.min(limit, 100);
    const filters = parseCatalogFilters(searchParams);

    // Try curated apps search first
    const cachedResults = await searchCachedPackages(
      query,
      sanitizedLimit,
      category,
      sort,
      filters
    );

    if (cachedResults && cachedResults.data.length > 0) {
      const curatedData = cachedResults.data;
      return NextResponse.json({
        query,
        count: curatedData.length,
        packages: curatedData.map((p) => ({
          id: p.winget_id,
          name: p.name,
          publisher: p.publisher,
          version: p.latest_version || '',
          description: p.description,
          homepage: p.homepage,
          tags: p.tags || [],
          category: p.category,
          iconPath: p.icon_path,
          popularityRank: p.popularity_rank,
          installerType: p.installer_type,
          appSource: p.app_source === 'store' ? 'store' : p.app_source === 'chocolatey' ? 'chocolatey' : 'win32',
          packageIdentifier: p.store_package_id || undefined,
          lastUpdated: p.winget_last_update || undefined,
          licenseBucket: p.license_bucket || undefined,
        })),
        source: 'curated',
      }, {
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      });
    }

    // No results found - the enhanced search_curated_apps function already tried
    // both FTS and ILIKE fallback, so return empty results
    return NextResponse.json({
      query,
      count: 0,
      packages: [],
      source: 'curated',
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to search packages' },
      { status: 500, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
}
