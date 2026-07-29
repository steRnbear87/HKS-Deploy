'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { AutopilotGroupTagCount } from '@/types/autopilot';

interface AutopilotGroupTagChartProps {
  groupTags: AutopilotGroupTagCount[];
}

const MAX_TAGS_SHOWN = 10;

export function AutopilotGroupTagChart({ groupTags }: AutopilotGroupTagChartProps) {
  if (!groupTags || groupTags.length === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center text-text-muted text-sm">
        No group tag data available
      </div>
    );
  }

  const shown = groupTags.slice(0, MAX_TAGS_SHOWN);
  const hiddenCount = groupTags.length - shown.length;

  return (
    <div>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={shown} layout="vertical" margin={{ top: 5, right: 20, left: 90, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
            <XAxis type="number" stroke="#94a3b8" fontSize={12} tickLine={false} allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="groupTag"
              stroke="#94a3b8"
              fontSize={11}
              tickLine={false}
              width={90}
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
            <Bar dataKey="count" fill="#a78bfa" radius={[0, 4, 4, 0]} maxBarSize={30} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {hiddenCount > 0 && (
        <p className="text-xs text-text-muted mt-2">
          + {hiddenCount} more group tag{hiddenCount === 1 ? '' : 's'} not shown
        </p>
      )}
    </div>
  );
}
