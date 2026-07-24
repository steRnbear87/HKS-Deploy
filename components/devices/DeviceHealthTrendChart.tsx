'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { TrendingUp, Loader2 } from 'lucide-react';
import { useDeviceHealthTrend } from '@/hooks/use-device-health-trend';

export function DeviceHealthTrendChart() {
  const { data, isLoading } = useDeviceHealthTrend(30);

  return (
    <div className="glass-light rounded-xl border border-overlay/5 p-6">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-4 h-4 text-accent-cyan" />
        <h2 className="text-lg font-semibold text-text-primary">Fleet Health Trend</h2>
        <span className="text-xs text-text-muted">Last 30 days</span>
      </div>

      {isLoading && (
        <div className="h-[220px] flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-accent-cyan animate-spin" />
        </div>
      )}

      {!isLoading && !data?.hasHistory && (
        <div className="h-[220px] flex flex-col items-center justify-center text-center px-6">
          <p className="text-sm text-text-primary font-medium mb-1">History starts accumulating from today</p>
          <p className="text-xs text-text-muted">
            Fleet health is captured once a day - check back tomorrow to see a trend.
          </p>
        </div>
      )}

      {!isLoading && data?.hasHistory && (
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data.points.map((p) => ({
                ...p,
                displayDate: new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
              }))}
              margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="displayDate" stroke="#94a3b8" fontSize={12} tickLine={false} interval="preserveStartEnd" />
              <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  color: '#f8fafc',
                }}
                labelStyle={{ color: '#94a3b8' }}
                formatter={(value, name) => [
                  value,
                  name === 'compliantCount' ? 'Compliant' : name === 'noncompliantCount' ? 'Non-compliant' : 'Stale',
                ]}
              />
              <Legend
                verticalAlign="top"
                height={36}
                formatter={(value) =>
                  value === 'compliantCount' ? 'Compliant' : value === 'noncompliantCount' ? 'Non-compliant' : 'Stale'
                }
              />
              <Line type="monotone" dataKey="compliantCount" stroke="#22c55e" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#22c55e' }} />
              <Line type="monotone" dataKey="noncompliantCount" stroke="#ef4444" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#ef4444' }} />
              <Line type="monotone" dataKey="staleCount" stroke="#94a3b8" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#94a3b8' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
