'use client';

import { T } from 'gt-next';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import {
  LayoutDashboard,
  Package,
  Rocket,
  Radar,
  Server,
  ArrowUpCircle,
  BarChart3,
  Settings,
  Laptop,
  Lightbulb,
  Search,
  Keyboard,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { SHORTCUT_HINTS } from '@/hooks/useKeyboardShortcuts';
import { useDevices } from '@/hooks/use-devices';
import { useDebounce } from '@/hooks/use-debounce';

const NAVIGATION_ITEMS = [
  { name: 'Overview', href: '/dashboard', icon: LayoutDashboard, keywords: 'home dashboard overview' },
  { name: 'App Catalog', href: '/dashboard/apps', icon: Package, keywords: 'apps packages browse search winget' },
  { name: 'Deployments', href: '/dashboard/uploads', icon: Rocket, keywords: 'uploads deploy jobs status' },
  { name: 'Discovered Apps', href: '/dashboard/unmanaged', icon: Radar, keywords: 'unmanaged discovered scan' },
  { name: 'Inventory', href: '/dashboard/inventory', icon: Server, keywords: 'deployed inventory intune' },
  { name: 'Devices', href: '/dashboard/devices', icon: Laptop, keywords: 'devices intune managed laptops' },
  { name: 'App Updates', href: '/dashboard/updates', icon: ArrowUpCircle, keywords: 'updates upgrade versions' },
  { name: 'Reports', href: '/dashboard/reports', icon: BarChart3, keywords: 'analytics reports charts' },
  { name: 'App Requests', href: '/dashboard/app-requests', icon: Lightbulb, keywords: 'suggestions requests vote' },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings, keywords: 'settings preferences permissions' },
];

const DEVICE_SEARCH_MIN_LENGTH = 2;
const MAX_DEVICE_RESULTS = 8;

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) {
      setSearch('');
      return;
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChange(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onOpenChange]);

  const handleSelect = useCallback(
    (href: string) => {
      onOpenChange(false);
      router.push(href);
    },
    [onOpenChange, router]
  );

  const debouncedSearch = useDebounce(search, 200);
  const shouldSearchDevices = open && debouncedSearch.trim().length >= DEVICE_SEARCH_MIN_LENGTH;
  const { data: devicesData, isLoading: devicesLoading } = useDevices({ enabled: shouldSearchDevices });

  const matchedDevices = useMemo(() => {
    if (!shouldSearchDevices || !devicesData?.devices) return [];
    const q = debouncedSearch.toLowerCase();
    return devicesData.devices
      .filter(
        (d) =>
          d.deviceName.toLowerCase().includes(q) ||
          d.userPrincipalName?.toLowerCase().includes(q)
      )
      .slice(0, MAX_DEVICE_RESULTS);
  }, [devicesData, debouncedSearch, shouldSearchDevices]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* Command dialog */}
      <div className="absolute inset-0 flex items-start justify-center pt-[20vh] px-4">
        <Command
          className="w-full max-w-lg rounded-xl border border-overlay/10 bg-bg-surface shadow-2xl overflow-hidden"
          loop
        >
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 border-b border-overlay/5">
            <Search className="w-4 h-4 text-text-muted flex-shrink-0" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Type a command or search..."
              className="flex-1 py-3 text-sm bg-transparent text-text-primary placeholder:text-text-muted outline-none"
            />
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-text-muted bg-overlay/10 rounded border border-overlay/5">
              ESC
            </kbd>
          </div>

          <Command.List className="max-h-[300px] overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-text-muted">
              <T>No results found</T>
            </Command.Empty>

            {/* Navigation group */}
            <Command.Group
              heading={<T>Navigation</T>}
              className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.1em] [&_[cmdk-group-heading]]:text-text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
            >
              {NAVIGATION_ITEMS.map((item) => (
                <Command.Item
                  key={item.href}
                  value={`${item.name} ${item.keywords}`}
                  onSelect={() => handleSelect(item.href)}
                  className="flex items-center gap-3 px-2 py-2 text-sm text-text-secondary rounded-lg cursor-pointer data-[selected=true]:bg-overlay/5 data-[selected=true]:text-text-primary transition-colors"
                >
                  <item.icon className="w-4 h-4 flex-shrink-0" />
                  <span><T>{item.name}</T></span>
                </Command.Item>
              ))}
            </Command.Group>

            {/* Devices group - live search, only once the query is long enough */}
            {shouldSearchDevices && (
              <Command.Group
                heading={<T>Devices</T>}
                className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.1em] [&_[cmdk-group-heading]]:text-text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:mt-2"
              >
                {devicesLoading && matchedDevices.length === 0 && (
                  <div className="flex items-center gap-2 px-2 py-2 text-xs text-text-muted">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <T>Searching devices...</T>
                  </div>
                )}
                {!devicesLoading && matchedDevices.length === 0 && (
                  <div className="px-2 py-2 text-xs text-text-muted">
                    <T>No matching devices</T>
                  </div>
                )}
                {matchedDevices.map((device) => (
                  <Command.Item
                    key={device.id}
                    value={`device ${device.deviceName} ${device.userPrincipalName ?? ''}`}
                    onSelect={() => handleSelect(`/dashboard/devices/${device.id}`)}
                    className="flex items-center gap-3 px-2 py-2 text-sm text-text-secondary rounded-lg cursor-pointer data-[selected=true]:bg-overlay/5 data-[selected=true]:text-text-primary transition-colors"
                  >
                    <Laptop className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate">{device.deviceName}</span>
                    {device.complianceState === 'noncompliant' && (
                      <ShieldAlert className="w-3 h-3 text-red-400 ml-auto flex-shrink-0" />
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Keyboard shortcuts group */}
            {!search && (
              <Command.Group
                heading={<T>Keyboard Shortcuts</T>}
                className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.1em] [&_[cmdk-group-heading]]:text-text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:mt-2"
              >
                {SHORTCUT_HINTS.map((hint) => (
                  <Command.Item
                    key={hint.description}
                    value={hint.description}
                    className="flex items-center justify-between px-2 py-2 text-sm text-text-muted rounded-lg cursor-default data-[selected=true]:bg-overlay/5"
                    disabled
                  >
                    <div className="flex items-center gap-3">
                      <Keyboard className="w-4 h-4 flex-shrink-0" />
                      <span><T>{hint.description}</T></span>
                    </div>
                    <div className="flex items-center gap-1">
                      {hint.keys.map((key) => (
                        <kbd
                          key={key}
                          className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-overlay/10 rounded border border-overlay/5"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
