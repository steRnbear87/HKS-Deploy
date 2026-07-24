'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Package, Loader2, AlertTriangle, Clock } from 'lucide-react';
import { AnimatedEmptyState } from './AnimatedEmptyState';
import { useFleetAppInventory } from '@/hooks/use-fleet-app-inventory';

const MAX_APPS_SHOWN = 6;

function truncate(name: string, max = 14): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export function TopInstalledAppsWidget() {
  const { data, isLoading, error } = useFleetAppInventory();

  return (
    <div className="glass-light rounded-xl border border-overlay/5 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-accent-cyan" />
          <h2 className="text-lg font-semibold text-text-primary">Top Installed Apps</h2>
        </div>
        {data?.partial && (
          <span className="text-xs text-status-warning">Partial scan</span>
        )}
      </div>

      {isLoading && (
        <div className="h-[220px] flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-accent-cyan animate-spin" />
        </div>
      )}

      {!isLoading && error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-status-error/10 border border-status-error/20">
          <AlertTriangle className="w-4 h-4 text-status-error flex-shrink-0 mt-0.5" />
          <p className="text-xs text-text-secondary">{error.message}</p>
        </div>
      )}

      {!isLoading && !error && data && !data.hasHistory && (
        <AnimatedEmptyState
          icon={Clock}
          title="Building your fleet-wide app inventory"
          description="This takes one daily scan to complete - check back in a few hours."
          color="neutral"
          showOrbs={false}
        />
      )}

      {!isLoading && !error && data?.hasHistory && (
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data.apps.slice(0, MAX_APPS_SHOWN).map((app) => ({ ...app, name: truncate(app.displayName) }))}
              layout="vertical"
              margin={{ top: 5, right: 12, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" stroke="#94a3b8" fontSize={11} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} width={90} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  color: '#f8fafc',
                }}
                labelStyle={{ color: '#94a3b8' }}
                formatter={(value, _name, item) => [
                  `${value} devices`,
                  item?.payload?.publisher || 'Unknown publisher',
                ]}
              />
              <Bar dataKey="deviceCount" fill="#22d3ee" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
