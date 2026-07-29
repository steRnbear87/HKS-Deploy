'use client';

import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { AnimatedStatCard, StatCardGrid } from '@/components/dashboard/AnimatedStatCard';
import type { ReportResult } from '@/types/reports';

// Same recharts visual language as SuccessRateChart.tsx/AutopilotGroupTagChart.tsx.
const AXIS_COLOR = '#94a3b8';
const GRID_COLOR = '#334155';
const TOOLTIP_STYLE = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#f8fafc',
};
const PIE_COLORS = ['#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#f87171', '#60a5fa', '#f472b6', '#94a3b8'];

interface ReportRunnerProps {
  result: ReportResult;
}

function EmptyNote() {
  return <div className="py-8 text-center text-sm text-text-muted">No data available.</div>;
}

export function ReportRunner({ result }: ReportRunnerProps) {
  return (
    <div>
      <ReportBody result={result} />
      {result.partial && (
        <p className="text-xs text-status-warning mt-3">
          Partial data - the background scan for this data hasn&apos;t finished a full sweep yet.
        </p>
      )}
    </div>
  );
}

function ReportBody({ result }: ReportRunnerProps) {
  if (result.chartType === 'bar') {
    if (result.data.length === 0) return <EmptyNote />;
    return (
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={result.data} layout="vertical" margin={{ top: 5, right: 24, left: 110, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
            <XAxis type="number" stroke={AXIS_COLOR} fontSize={12} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="label" stroke={AXIS_COLOR} fontSize={11} tickLine={false} width={110} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey="value" fill="#22d3ee" radius={[0, 4, 4, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (result.chartType === 'pie') {
    if (result.data.length === 0) return <EmptyNote />;
    return (
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={result.data} dataKey="value" nameKey="label" innerRadius={60} outerRadius={95} paddingAngle={2}>
              {result.data.map((entry, i) => (
                <Cell key={entry.label} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 12, color: AXIS_COLOR }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (result.chartType === 'stat-grid') {
    if (result.stats.length === 0) return <EmptyNote />;
    const columns = Math.min(5, Math.max(2, result.stats.length)) as 2 | 3 | 4 | 5;
    return (
      <StatCardGrid columns={columns}>
        {result.stats.map((stat) => (
          <AnimatedStatCard key={stat.label} title={stat.label} value={stat.value} valueType="custom" customValue={
            <span className="text-3xl font-bold text-text-primary tabular-nums">{stat.value}</span>
          } color="neutral" />
        ))}
      </StatCardGrid>
    );
  }

  if (result.chartType !== 'table') return null;
  const table = result;
  if (table.rows.length === 0) return <EmptyNote />;
  return (
    <div className="overflow-x-auto rounded-lg border border-overlay/10">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-overlay/10 bg-overlay/[0.02]">
            {table.columns.map((col) => (
              <th key={col.key} className="text-left px-4 py-2 font-medium text-text-secondary whitespace-nowrap">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i} className="border-b border-overlay/5 last:border-0">
              {table.columns.map((col) => (
                <td key={col.key} className="px-4 py-2 text-text-primary whitespace-nowrap">
                  {row[col.key] ?? '-'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
