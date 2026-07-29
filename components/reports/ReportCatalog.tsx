'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, BarChart3, PieChart, Table2, LayoutGrid, Play, Clock } from 'lucide-react';
import { T } from 'gt-next';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CATEGORY_ORDER, getReportsByCategory } from '@/lib/reports/registry';
import type { ReportCategory, ReportChartType, ReportDefinition } from '@/types/reports';

const CHART_ICONS: Record<ReportChartType, typeof BarChart3> = {
  bar: BarChart3,
  pie: PieChart,
  table: Table2,
  'stat-grid': LayoutGrid,
};

const ALL_REPORTS = 'All Reports' as const;
type CategoryFilter = ReportCategory | typeof ALL_REPORTS;

export function ReportCatalog() {
  const [category, setCategory] = useState<CategoryFilter>(ALL_REPORTS);
  const [search, setSearch] = useState('');

  const byCategory = useMemo(() => getReportsByCategory(), []);
  const totalCount = useMemo(
    () => Array.from(byCategory.values()).reduce((sum, reports) => sum + reports.length, 0),
    [byCategory]
  );

  const visibleReports = useMemo(() => {
    const pool = category === ALL_REPORTS ? Array.from(byCategory.values()).flat() : byCategory.get(category) ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter(
      (r) => r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)
    );
  }, [byCategory, category, search]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col lg:flex-row gap-6">
        <CategoryRail
          byCategory={byCategory}
          totalCount={totalCount}
          selected={category}
          onSelect={setCategory}
        />

        <div className="flex-1 min-w-0 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reports..."
              className="pl-9 bg-bg-elevated border-overlay/10 focus:border-accent-cyan/50"
            />
          </div>

          {visibleReports.length === 0 ? (
            <div className="glass-light rounded-xl border border-overlay/5 p-10 text-center">
              <p className="text-text-secondary font-medium"><T>No reports here yet</T></p>
              <p className="text-sm text-text-muted mt-1">
                <T>This category doesn&apos;t have any reports defined yet.</T>
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleReports.map((report) => (
                <ReportCard key={report.id} report={report} />
              ))}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

function CategoryRail({
  byCategory,
  totalCount,
  selected,
  onSelect,
}: {
  byCategory: Map<ReportCategory, ReportDefinition[]>;
  totalCount: number;
  selected: CategoryFilter;
  onSelect: (c: CategoryFilter) => void;
}) {
  return (
    <nav className="lg:w-64 flex-shrink-0">
      <div className="glass-light rounded-xl border border-overlay/5 p-2 lg:sticky lg:top-4">
        <RailButton
          label="All Reports"
          count={totalCount}
          active={selected === ALL_REPORTS}
          onClick={() => onSelect(ALL_REPORTS)}
        />
        <div className="my-1 border-t border-overlay/5" />
        {CATEGORY_ORDER.map((c) => (
          <RailButton
            key={c}
            label={c}
            count={byCategory.get(c)?.length ?? 0}
            active={selected === c}
            onClick={() => onSelect(c)}
          />
        ))}
      </div>
    </nav>
  );
}

function RailButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors',
        active ? 'bg-accent-cyan/10 text-accent-cyan font-medium' : 'text-text-secondary hover:bg-overlay/[0.04] hover:text-text-primary'
      )}
    >
      <span className="truncate"><T>{label}</T></span>
      <span className={cn('text-xs tabular-nums flex-shrink-0', active ? 'text-accent-cyan' : 'text-text-muted')}>
        {count}
      </span>
    </button>
  );
}

function ReportCard({ report }: { report: ReportDefinition }) {
  const ChartIcon = CHART_ICONS[report.chartType];
  const isComingSoon = report.status === 'coming-soon';

  return (
    <div
      className={cn(
        'glass-light rounded-xl border p-5 transition-colors flex flex-col',
        'border-overlay/5',
        isComingSoon && 'opacity-70'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <ChartIcon className="w-4 h-4 text-text-muted flex-shrink-0" />
            <h3 className="font-semibold text-text-primary text-sm truncate">{report.title}</h3>
          </div>
          <p className="text-xs text-text-secondary">{report.description}</p>
        </div>
        <StatusBadge tone={isComingSoon ? 'muted' : 'accent'} className="flex-shrink-0">
          {report.category}
        </StatusBadge>
      </div>

      <div className="mt-4">
        {isComingSoon ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-block">
                <Button variant="secondary" size="sm" disabled className="gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  <T>Coming soon</T>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {report.comingSoonReason ?? 'This report needs a new data integration.'}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Button asChild variant="default" size="sm" className="gap-1.5">
            <Link href={`/dashboard/reports/${report.id}`}>
              <Play className="w-3.5 h-3.5" />
              <T>Run</T>
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
