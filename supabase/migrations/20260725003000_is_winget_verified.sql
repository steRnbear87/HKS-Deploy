-- build-app-list.yml has set curated_apps.is_winget_verified on every winget
-- import since that workflow was written, but no migration ever created the
-- column - like curated_excluded_apps and user_profiles, it only exists in
-- the original hosted project because someone added it out-of-band. Column
-- is currently write-only (distinguishes winget-sourced verification from
-- the general is_verified flag, which is also set for store/chocolatey apps).
ALTER TABLE curated_apps
  ADD COLUMN IF NOT EXISTS is_winget_verified BOOLEAN NOT NULL DEFAULT FALSE;
