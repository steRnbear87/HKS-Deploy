'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { StatusBadge } from '@/components/ui/status-badge';
import type { DevicePlatformCounts } from '@/types/devices';

interface DevicesDonutChartProps {
  platformCounts: DevicePlatformCounts;
  nonCompliantCount: number;
}

const COLORS = {
  microsoft: '#22d3ee', // accent-cyan
  apple: '#a78bfa', // accent-violet
  google: '#22c55e', // status-success
  other: '#94a3b8', // neutral
};

export function DevicesDonutChart({ platformCounts, nonCompliantCount }: DevicesDonutChartProps) {
  const data = [
    { name: 'Microsoft', value: platformCounts.microsoft, color: COLORS.microsoft },
    { name: 'Apple', value: platformCounts.apple, color: COLORS.apple },
    { name: 'Google', value: platformCounts.google, color: COLORS.google },
    { name: 'Other', value: platformCounts.other, color: COLORS.other },
  ].filter((item) => item.value > 0);

  return (
    <div className="glass-light rounded-xl border border-overlay/5 p-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-text-primary">Devices</h2>
        {platformCounts.total > 0 && (
          <StatusBadge tone={nonCompliantCount > 0 ? 'warning' : 'success'}>
            {nonCompliantCount > 0 ? `${nonCompliantCount} non-compliant` : 'All compliant'}
          </StatusBadge>
        )}
      </div>

      {platformCounts.total === 0 ? (
        <div className="h-[220px] flex items-center justify-center text-text-muted text-sm">
          No device data available
        </div>
      ) : (
        <div className="h-[220px] relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={2} dataKey="value">
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  color: '#f8fafc',
                }}
                formatter={(value, name) => [value, name]}
              />
              <Legend
                verticalAlign="bottom"
                height={36}
                formatter={(value) => <span className="text-text-secondary">{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center -mt-4">
              <p className="text-3xl font-bold text-text-primary">{platformCounts.total.toLocaleString()}</p>
              <p className="text-sm text-text-muted">Total</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
