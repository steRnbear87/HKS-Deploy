-- search_curated_apps's category_filter only ever accepted a single TEXT
-- value, so when a user multi-selected 2+ categories on the App Catalog
-- page, searchApps forwarded only the first selection and Supabase-mode
-- search silently dropped matches from every other selected category
-- (getPopularApps's browse path already correctly does category IN (...)
-- via the JS query builder - only this RPC-backed search path had the gap).
-- Adds an optional array param used when provided, falling back to the
-- original singular param for any existing caller that still passes it.

DROP FUNCTION IF EXISTS search_curated_apps(TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT[], TEXT[]);

CREATE OR REPLACE FUNCTION search_curated_apps(
  search_query TEXT,
  category_filter TEXT DEFAULT NULL,
  result_limit INTEGER DEFAULT 50,
  result_offset INTEGER DEFAULT 0,
  publisher_filter TEXT DEFAULT NULL,
  tag_filter TEXT DEFAULT NULL,
  app_source_filter TEXT[] DEFAULT NULL,
  license_ilike_patterns TEXT[] DEFAULT NULL,
  category_filters TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  id INTEGER,
  winget_id TEXT,
  name TEXT,
  publisher TEXT,
  latest_version TEXT,
  description TEXT,
  homepage TEXT,
  category TEXT,
  tags TEXT[],
  icon_path TEXT,
  popularity_rank INTEGER,
  rank REAL,
  app_source TEXT,
  store_package_id TEXT
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  fts_count INTEGER;
BEGIN
  -- First, try full-text search
  RETURN QUERY
  SELECT
    ca.id,
    ca.winget_id,
    ca.name,
    ca.publisher,
    ca.latest_version,
    ca.description,
    ca.homepage,
    ca.category,
    ca.tags,
    ca.icon_path,
    ca.popularity_rank,
    ts_rank_cd(ca.fts, websearch_to_tsquery('english', search_query)) AS rank,
    ca.app_source,
    ca.store_package_id
  FROM curated_apps ca
  WHERE
    ca.fts @@ websearch_to_tsquery('english', search_query)
    AND (
      (category_filters IS NOT NULL AND ca.category = ANY(category_filters))
      OR (category_filters IS NULL AND (category_filter IS NULL OR ca.category = category_filter))
    )
    AND (publisher_filter IS NULL OR ca.publisher ILIKE '%' || publisher_filter || '%')
    AND (tag_filter IS NULL OR ca.tags @> ARRAY[tag_filter])
    AND (app_source_filter IS NULL OR ca.app_source = ANY(app_source_filter))
    AND (license_ilike_patterns IS NULL OR ca.license ILIKE ANY(license_ilike_patterns))
    AND ca.is_verified = TRUE
    AND ca.is_locale_variant = FALSE
  ORDER BY
    CASE
      WHEN LOWER(ca.name) = LOWER(search_query) THEN 0
      WHEN LOWER(ca.winget_id) = LOWER(search_query) THEN 0
      WHEN ca.winget_id ILIKE '%.' || search_query THEN 0
      WHEN LOWER(ca.name) LIKE LOWER(search_query) || '%' THEN 1
      WHEN ca.winget_id ILIKE '%.' || search_query || '%' THEN 1
      ELSE 2
    END,
    rank DESC,
    ca.popularity_rank ASC NULLS LAST
  LIMIT result_limit
  OFFSET result_offset;

  -- Check if FTS returned any results
  GET DIAGNOSTICS fts_count = ROW_COUNT;

  -- If FTS returned no results, fallback to ILIKE pattern matching
  IF fts_count = 0 THEN
    RETURN QUERY
    SELECT
      ca.id,
      ca.winget_id,
      ca.name,
      ca.publisher,
      ca.latest_version,
      ca.description,
      ca.homepage,
      ca.category,
      ca.tags,
      ca.icon_path,
      ca.popularity_rank,
      0.0::REAL AS rank,
      ca.app_source,
      ca.store_package_id
    FROM curated_apps ca
    WHERE
      (
        ca.name ILIKE '%' || search_query || '%'
        OR ca.winget_id ILIKE '%' || search_query || '%'
        OR ca.publisher ILIKE '%' || search_query || '%'
      )
      AND (
        (category_filters IS NOT NULL AND ca.category = ANY(category_filters))
        OR (category_filters IS NULL AND (category_filter IS NULL OR ca.category = category_filter))
      )
      AND (publisher_filter IS NULL OR ca.publisher ILIKE '%' || publisher_filter || '%')
      AND (tag_filter IS NULL OR ca.tags @> ARRAY[tag_filter])
      AND (app_source_filter IS NULL OR ca.app_source = ANY(app_source_filter))
      AND (license_ilike_patterns IS NULL OR ca.license ILIKE ANY(license_ilike_patterns))
      AND ca.is_verified = TRUE
      AND ca.is_locale_variant = FALSE
    ORDER BY
      CASE
        WHEN LOWER(ca.name) = LOWER(search_query) THEN 1
        WHEN LOWER(ca.name) LIKE LOWER(search_query) || '%' THEN 2
        WHEN LOWER(ca.winget_id) LIKE '%' || LOWER(search_query) || '%' THEN 3
        ELSE 4
      END,
      ca.popularity_rank ASC NULLS LAST
    LIMIT result_limit
    OFFSET result_offset;
  END IF;
END;
$$;
