'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { T } from 'gt-next';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader, AnimatedEmptyState } from '@/components/dashboard';
import { ReportRunner } from '@/components/reports/ReportRunner';
import { CustomReportBody } from '@/components/reports/CustomReportBody';
import { useReport } from '@/hooks/use-report';
import { getReportDefinition } from '@/lib/reports/registry';

export default function ReportDetailPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = use(params);
  const router = useRouter();
  const report = getReportDefinition(reportId);

  const backToReports = () => router.push('/dashboard/reports');

  if (!report) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={<T>Report not found</T>}
          breadcrumbs={[{ label: 'Reports', onClick: backToReports }]}
        />
        <AnimatedEmptyState
          icon={AlertCircle}
          title={<T>This report doesn't exist</T>}
          description={<T>It may have been removed. Head back to the report catalog to pick another one.</T>}
          color="neutral"
          action={{ label: 'Back to Reports', onClick: backToReports, variant: 'secondary' }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={report.title}
        description={report.description}
        breadcrumbs={[{ label: 'Reports', onClick: backToReports }, { label: report.title }]}
        badge={{ text: report.category }}
      />

      <div className="glass-light rounded-xl border border-overlay/5 p-6">
        {report.status === 'coming-soon' ? (
          <AnimatedEmptyState
            icon={AlertCircle}
            title={<T>Coming soon</T>}
            description={report.comingSoonReason ?? 'This report needs a new data integration.'}
            color="neutral"
          />
        ) : report.custom ? (
          <CustomReportBody reportId={report.id} />
        ) : (
          <ReadyReportBody reportId={report.id} />
        )}
      </div>
    </div>
  );
}

function ReadyReportBody({ reportId }: { reportId: string }) {
  const { data, isLoading, error, refetch } = useReport(reportId, { enabled: true });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-text-muted gap-2 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        <T>Running report...</T>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-10">
        <p className="text-sm text-status-error">{(error as Error).message}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-3">
          <T>Retry</T>
        </Button>
      </div>
    );
  }

  if (!data) return null;

  return <ReportRunner result={data} />;
}
