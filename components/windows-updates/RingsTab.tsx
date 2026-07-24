'use client';

import { useState } from 'react';
import { Layers, Plus, Loader2 } from 'lucide-react';
import { T } from 'gt-next';
import { toast } from 'sonner';
import { AnimatedEmptyState } from '@/components/dashboard';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useUpdateRings, useCreateUpdateRing } from '@/hooks/use-windows-updates';
import { AssignmentSummaryLine } from '@/components/windows-updates/AssignmentSummaryLine';

export function RingsTab() {
  const { data, isLoading } = useUpdateRings();
  const createRing = useCreateUpdateRing();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [qualityDays, setQualityDays] = useState(0);
  const [featureDays, setFeatureDays] = useState(0);

  const rings = data?.rings || [];

  const handleCreate = async () => {
    if (!displayName.trim()) return;
    try {
      await createRing.mutateAsync({
        displayName: displayName.trim(),
        qualityUpdatesDeferralPeriodInDays: qualityDays,
        featureUpdatesDeferralPeriodInDays: featureDays,
      });
      toast.success(`Update ring "${displayName}" created`);
      setDialogOpen(false);
      setDisplayName('');
      setQualityDays(0);
      setFeatureDays(0);
    } catch (error) {
      toast.error('Failed to create update ring', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  };

  if (isLoading) {
    return <p className="text-sm text-text-muted px-2 py-8 text-center"><T>Loading update rings...</T></p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setDialogOpen(true)}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-accent-cyan hover:bg-accent-cyan-dim text-white transition-colors flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          <T>Create Update Ring</T>
        </button>
      </div>

      {rings.length === 0 ? (
        <AnimatedEmptyState
          icon={Layers}
          title={<T>No Update Rings yet</T>}
          description={<T>Create one to control quality and feature update deferral for your devices.</T>}
          color="cyan"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rings.map((ring) => (
            <div key={ring.id} className="glass-light border border-overlay/5 rounded-xl p-4">
              <h4 className="font-semibold text-text-primary mb-1">{ring.displayName}</h4>
              {ring.description && <p className="text-xs text-text-muted mb-3">{ring.description}</p>}
              <div className="space-y-1 text-sm text-text-secondary">
                <div>
                  <T>Quality deferral</T>: {ring.qualityUpdatesDeferralPeriodInDays} <T>days</T>
                </div>
                <div>
                  <T>Feature deferral</T>: {ring.featureUpdatesDeferralPeriodInDays} <T>days</T>
                </div>
              </div>
              <AssignmentSummaryLine assignments={ring.assignments} />
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle><T>Create Update Ring</T></DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1.5"><T>Name</T></label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Slow Ring"
                className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan/40"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1.5">
                  <T>Quality deferral (days)</T>
                </label>
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={qualityDays}
                  onChange={(e) => setQualityDays(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-cyan/40"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1.5">
                  <T>Feature deferral (days)</T>
                </label>
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={featureDays}
                  onChange={(e) => setFeatureDays(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-cyan/40"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={handleCreate}
              disabled={!displayName.trim() || createRing.isPending}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-accent-cyan hover:bg-accent-cyan-dim text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              {createRing.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              <T>Create</T>
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
