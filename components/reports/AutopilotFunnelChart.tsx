'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { StatusBadge } from '@/components/ui/status-badge';
import type { AutopilotFunnelCounts } from '@/types/autopilot';

interface AutopilotFunnelChartProps {
  funnel: AutopilotFunnelCounts;
}

const STAGE_COLORS = ['#22d3ee', '#38bdf8', '#22c55e']; // accent-cyan -> sky -> status-success

/**
 * Registered -> Profile Assigned -> Enrolled. There is no "provisioned"/
 * ESP-completion stage available from windowsAutopilotDeviceIdentities (see
 * types/autopilot.ts's AutopilotFunnelCounts doc comment) - Failed is shown
 * as a separate badge rather than a 4th funnel bar, since it's an off-path
 * terminal outcome, not a sequential stage every device passes through.
 */
export function AutopilotFunnelChart({ funnel }: AutopilotFunnelChartProps) {
  const data = [
    { stage: 'Registered', count: funnel.registered },
    { stage: 'Profile Assigned', count: funnel.profileAssigned },
    { stage: 'Enrolled', count: funnel.enrolled },
  ];

  if (funnel.registered === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center text-text-muted text-sm">
        No Autopilot devices registered for this tenant
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-text-muted">Enrollment funnel</p>
        {funnel.failed > 0 && (
          <StatusBadge tone="error">
            {funnel.failed} failed
          </StatusBadge>
        )}
      </div>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 100, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
            <XAxis type="number" stroke="#94a3b8" fontSize={12} tickLine={false} allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="stage"
              stroke="#94a3b8"
              fontSize={12}
              tickLine={false}
              width={100}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#f8fafc',
              }}
              formatter={(value) => [value, 'Devices']}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={36}>
              {data.map((entry, index) => (
                <Cell key={entry.stage} fill={STAGE_COLORS[index]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
