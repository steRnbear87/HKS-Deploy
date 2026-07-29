'use client';

import { T } from 'gt-next';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/dashboard';
import { ReportCatalog } from '@/components/reports';

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title={<T>Reports</T>}
        description={<T>Browse pre-built reports by category, or run your own</T>}
        gradient
        gradientColors="mixed"
        actions={
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-block">
                  <Button disabled className="gap-1.5">
                    <Sparkles className="w-4 h-4" />
                    <T>Build Custom Report</T>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <T>Coming soon</T>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        }
      />

      <ReportCatalog />
    </div>
  );
}
