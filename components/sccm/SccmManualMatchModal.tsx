'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, X, Check, Loader2, Package, Link2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AppIcon } from '@/components/AppIcon';
import { cn } from '@/lib/utils';
import type { SccmAppRecord, SccmMatchStatus } from '@/types/sccm';
import type { NormalizedPackage } from '@/types/winget';
import type { PartialMatch } from '@/types/unmanaged';

interface SccmManualMatchModalProps {
  app: SccmAppRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onLink: (appId: string, wingetPackageId: string, wingetPackageName: string) => Promise<void>;
  onExclude?: (appId: string) => Promise<void>;
}

export function SccmManualMatchModal({
  app,
  isOpen,
  onClose,
  onLink,
  onExclude,
}: SccmManualMatchModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NormalizedPackage[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<NormalizedPackage | null>(null);
  const [isLinking, setIsLinking] = useState(false);
  const [isExcluding, setIsExcluding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize search with app name
  useEffect(() => {
    if (isOpen && app) {
      // Clean up the app name for initial search
      const initialQuery = app.displayName
        .replace(/\s*\(x64\)|\s*\(x86\)|\s*\(64-bit\)|\s*\(32-bit\)/gi, '')
        .replace(/\s+v?\d+(\.\d+)*(\.\d+)?/g, '')
        .replace(/\s*-\s*(Enterprise|Professional|Standard|Home|Pro|Ultimate)/gi, '')
        .trim();
      setSearchQuery(initialQuery);
      setSelectedPackage(null);
      setError(null);
    }
  }, [isOpen, app]);

  // Search for packages with debounce
  useEffect(() => {
    const controller = new AbortController();

    const searchPackages = async () => {
      if (!searchQuery || searchQuery.length < 2) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/winget/search?q=${encodeURIComponent(searchQuery)}&limit=15`,
          { signal: controller.signal }
        );

        if (controller.signal.aborted) return;

        if (response.ok) {
          const data = await response.json();
          if (controller.signal.aborted) return;
          setSearchResults(data.packages || []);
        } else {
          setError('Failed to search packages');
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('Search error:', err);
        setError('Search failed. Please try again.');
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    };

    // A slower earlier search (e.g. searchQuery "a") can otherwise resolve
    // after a faster later one (e.g. "ab") and overwrite its results -
    // abort the in-flight request, not just the pending debounce timer,
    // when a newer keystroke supersedes it.
    const debounce = setTimeout(searchPackages, 300);
    return () => {
      clearTimeout(debounce);
      controller.abort();
    };
  }, [searchQuery]);

  const handleLink = async () => {
    if (!selectedPackage || !app) return;

    setIsLinking(true);
    setError(null);

    try {
      await onLink(app.id, selectedPackage.id, selectedPackage.name);
      onClose();
    } catch (err) {
      console.error('Link error:', err);
      setError(err instanceof Error ? err.message : 'Failed to link package');
    } finally {
      setIsLinking(false);
    }
  };

  const handleExclude = async () => {
    if (!app || !onExclude) return;

    setIsExcluding(true);
    setError(null);

    try {
      await onExclude(app.id);
      onClose();
    } catch (err) {
      console.error('Exclude error:', err);
      setError(err instanceof Error ? err.message : 'Failed to exclude app');
    } finally {
      setIsExcluding(false);
    }
  };

  const handlePartialMatchClick = (match: PartialMatch) => {
    // Try to find in search results first
    const existingResult = searchResults.find(pkg => pkg.id === match.wingetId);
    if (existingResult) {
      setSelectedPackage(existingResult);
    } else {
      // Search for the package ID
      setSearchQuery(match.wingetId);
    }
  };

  if (!isOpen || !app) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl mx-4 bg-bg-surface rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-white">Link WinGet Package</h2>
            <p className="text-sm text-zinc-400 mt-1 truncate">
              Manually link &quot;{app.displayName}&quot; to a WinGet package
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white transition-colors p-1 ml-4"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* App Info */}
        <div className="px-6 py-3 bg-white/2 border-b border-white/5">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center">
              <Package className="w-5 h-5 text-zinc-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white font-medium truncate">{app.displayName}</p>
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                {app.manufacturer && <span>{app.manufacturer}</span>}
                {app.version && <span>v{app.version}</span>}
                {app.technology && (
                  <span className="px-1.5 py-0.5 bg-white/5 rounded">{app.technology}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="text-accent-cyan">{app.deploymentCount} deployments</span>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="px-6 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search WinGet packages..."
              className="pl-10 bg-bg-elevated border-white/10 focus:border-accent-cyan/50"
              autoFocus
            />
            {isSearching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400 animate-spin" />
            )}
          </div>
        </div>

        {/* Partial matches suggestion */}
        {app.partialMatches && app.partialMatches.length > 0 && (
          <div className="px-6 pb-4">
            <p className="text-xs text-zinc-500 mb-2">Suggested matches:</p>
            <div className="flex flex-wrap gap-2">
              {app.partialMatches.slice(0, 5).map((match) => (
                <button
                  key={match.wingetId}
                  onClick={() => handlePartialMatchClick(match)}
                  className={cn(
                    'text-xs px-3 py-1.5 rounded-lg transition-colors',
                    selectedPackage?.id === match.wingetId
                      ? 'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30'
                      : 'bg-bg-elevated text-zinc-300 hover:bg-white/10'
                  )}
                >
                  {match.name}
                  {match.confidence !== undefined && match.confidence !== null && (
                    <span className="ml-1 opacity-60">
                      ({Math.round(match.confidence * 100)}%)
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-6 pb-4">
            <div className="flex items-center gap-2 p-3 bg-status-error/10 border border-status-error/20 rounded-lg">
              <XCircle className="w-4 h-4 text-status-error flex-shrink-0" />
              <p className="text-sm text-status-error">{error}</p>
            </div>
          </div>
        )}

        {/* Results */}
        <div className="px-6 pb-4 max-h-80 overflow-y-auto">
          {searchResults.length === 0 && searchQuery.length >= 2 && !isSearching && (
            <div className="text-center py-8 text-zinc-500">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No packages found for &quot;{searchQuery}&quot;</p>
              <p className="text-xs mt-1">Try a different search term</p>
            </div>
          )}

          <div className="space-y-2">
            {searchResults.map((pkg) => (
              <button
                key={pkg.id}
                onClick={() => setSelectedPackage(pkg)}
                className={cn(
                  'w-full flex items-center gap-4 p-4 rounded-xl transition-all text-left',
                  selectedPackage?.id === pkg.id
                    ? 'bg-accent-cyan/10 border-accent-cyan/30 border'
                    : 'bg-bg-elevated hover:bg-white/5 border border-transparent'
                )}
              >
                <AppIcon
                  packageId={pkg.id}
                  packageName={pkg.name}
                  iconPath={pkg.iconPath}
                  size="md"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium truncate">{pkg.name}</p>
                  <p className="text-zinc-500 text-sm truncate">{pkg.publisher}</p>
                  <p className="text-zinc-600 text-xs font-mono truncate">{pkg.id}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-zinc-400 bg-bg-deepest px-2 py-1 rounded">
                    v{pkg.version}
                  </span>
                  {selectedPackage?.id === pkg.id && (
                    <Check className="w-5 h-5 text-accent-cyan" />
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-white/5 bg-bg-elevated/50">
          <div>
            {onExclude && (
              <Button
                variant="ghost"
                onClick={handleExclude}
                disabled={isExcluding || isLinking}
                className="text-zinc-400 hover:text-status-error hover:bg-status-error/10"
              >
                {isExcluding ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <XCircle className="w-4 h-4 mr-2" />
                )}
                Exclude App
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onClose} className="border-white/10">
              Cancel
            </Button>
            <Button
              onClick={handleLink}
              disabled={!selectedPackage || isLinking}
              className="bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90 text-white border-0"
            >
              {isLinking ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Link2 className="w-4 h-4 mr-2" />
              )}
              Link Package
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
