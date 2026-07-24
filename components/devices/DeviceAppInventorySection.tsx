'use client';

import { useState, useMemo } from 'react';
import { RefreshCw, Loader2, AlertTriangle, ShieldQuestion, Package, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDeviceAppInventory } from '@/hooks/use-device-app-inventory';

interface DeviceAppInventorySectionProps {
  deviceId: string;
}

export function DeviceAppInventorySection({ deviceId }: DeviceAppInventorySectionProps) {
  const { data, isLoading, error, refetch } = useDeviceAppInventory(deviceId);
  const [filter, setFilter] = useState('');

  const apps = data?.apps ?? [];
  const filteredApps = useMemo(() => {
    if (!filter.trim()) return apps;
    const q = filter.toLowerCase();
    return apps.filter(
      (app) =>
        app.displayName.toLowerCase().includes(q) ||
        app.publisher?.toLowerCase().includes(q)
    );
  }, [apps, filter]);

  return (
    <div className="glass-light rounded-xl border border-overlay/5 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-accent-cyan" />
          <h2 className="text-lg font-semibold text-text-primary">Installed Apps</h2>
          {data?.configured && (
            <span className="text-xs text-text-muted">({data.total ?? apps.length})</span>
          )}
        </div>
        {data?.configured && (
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-text-secondary hover:text-text-primary">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-accent-cyan animate-spin" />
        </div>
      )}

      {!isLoading && error && (
        <div className="flex flex-col items-center py-8 text-center">
          <AlertTriangle className="w-8 h-8 text-amber-400 mb-2" />
          <p className="text-sm text-text-secondary mb-3">{error.message}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="border-overlay/10">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !error && data && !data.configured && (
        <div className="flex flex-col items-center py-8 text-center max-w-lg mx-auto">
          <ShieldQuestion className="w-8 h-8 text-text-muted mb-3" />
          <p className="text-sm text-text-primary font-medium mb-1">Not available for this device</p>
          <p className="text-sm text-text-muted">{data.reason}</p>
        </div>
      )}

      {!isLoading && !error && data?.configured && apps.length === 0 && (
        <p className="text-sm text-text-muted">
          No installed apps have been reported for this device yet. It can take a scan cycle after
          enrollment before app inventory appears.
        </p>
      )}

      {!isLoading && !error && data?.configured && apps.length > 0 && (
        <div className="space-y-3">
          <div className="relative max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter apps..."
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-bg-elevated/50 border border-overlay/10 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-cyan/50"
            />
          </div>

          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full min-w-[500px]">
              <thead>
                <tr className="border-b border-overlay/15">
                  <th className="text-left py-2 px-3 text-sm font-medium text-text-muted">Name</th>
                  <th className="text-left py-2 px-3 text-sm font-medium text-text-muted">Version</th>
                  <th className="text-left py-2 px-3 text-sm font-medium text-text-muted">Publisher</th>
                </tr>
              </thead>
              <tbody>
                {filteredApps.map((app) => (
                  <tr key={app.id} className="border-b border-overlay/10 hover:bg-bg-elevated/30 transition-colors">
                    <td className="py-2 px-3 text-sm text-text-primary">{app.displayName}</td>
                    <td className="py-2 px-3 text-sm text-text-muted">{app.version || '—'}</td>
                    <td className="py-2 px-3 text-sm text-text-muted">{app.publisher || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredApps.length === 0 && (
            <p className="text-sm text-text-muted">No apps match &quot;{filter}&quot;.</p>
          )}

          {data.truncated && (
            <p className="text-xs text-text-muted">
              Showing the first {apps.length} apps; this device reports more than that.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
