'use client';

import { useState } from 'react';
import { ShieldCheck, Plus, Loader2, Zap } from 'lucide-react';
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
import { useQualityUpdateProfiles, useCreateQualityUpdateProfile } from '@/hooks/use-windows-updates';
import { AssignmentSummaryLine } from '@/components/windows-updates/AssignmentSummaryLine';

export function QualityUpdatesTab() {
  const { data, isLoading } = useQualityUpdateProfiles();
  const createProfile = useCreateQualityUpdateProfile();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [expedited, setExpedited] = useState(false);
  const [qualityUpdateRelease, setQualityUpdateRelease] = useState('');
  const [daysUntilForcedReboot, setDaysUntilForcedReboot] = useState(2);

  const profiles = data?.profiles || [];

  const handleCreate = async () => {
    if (!displayName.trim()) return;
    if (expedited && !qualityUpdateRelease.trim()) return;
    try {
      await createProfile.mutateAsync({
        displayName: displayName.trim(),
        expedited: expedited
          ? { qualityUpdateRelease: qualityUpdateRelease.trim(), daysUntilForcedReboot }
          : undefined,
      });
      toast.success(`Quality update profile "${displayName}" created`);
      setDialogOpen(false);
      setDisplayName('');
      setExpedited(false);
      setQualityUpdateRelease('');
      setDaysUntilForcedReboot(2);
    } catch (error) {
      toast.error('Failed to create quality update profile', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  };

  if (isLoading) {
    return <p className="text-sm text-text-muted px-2 py-8 text-center"><T>Loading quality update profiles...</T></p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setDialogOpen(true)}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-accent-cyan hover:bg-accent-cyan-dim text-white transition-colors flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          <T>Create Quality Update Profile</T>
        </button>
      </div>

      {profiles.length === 0 ? (
        <AnimatedEmptyState
          icon={ShieldCheck}
          title={<T>No Quality Update Profiles yet</T>}
          description={<T>Create one to push a specific cumulative update, optionally expedited for urgent patches.</T>}
          color="cyan"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {profiles.map((profile) => (
            <div key={profile.id} className="glass-light border border-overlay/5 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-semibold text-text-primary">{profile.displayName}</h4>
                {profile.expedited && <Zap className="w-3.5 h-3.5 text-amber-400" />}
              </div>
              {profile.expedited ? (
                <p className="text-sm text-text-secondary">
                  <T>Expedited</T>: {profile.expedited.qualityUpdateRelease} (
                  {profile.expedited.daysUntilForcedReboot} <T>days until forced reboot</T>)
                </p>
              ) : (
                <p className="text-sm text-text-secondary">{profile.releaseDateDisplayName || <T>Standard</T>}</p>
              )}
              <AssignmentSummaryLine assignments={profile.assignments} />
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle><T>Create Quality Update Profile</T></DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1.5"><T>Name</T></label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. July 2026 Security Update"
                className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan/40"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={expedited}
                onChange={(e) => setExpedited(e.target.checked)}
                className="rounded border-overlay/20"
              />
              <T>Expedite (for urgent security patches)</T>
            </label>
            {expedited && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1.5">
                    <T>Release id</T>
                  </label>
                  <input
                    type="text"
                    value={qualityUpdateRelease}
                    onChange={(e) => setQualityUpdateRelease(e.target.value)}
                    placeholder="e.g. 2026-07 Cumulative Update"
                    className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan/40"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1.5">
                    <T>Days until forced reboot</T>
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={2}
                    value={daysUntilForcedReboot}
                    onChange={(e) => setDaysUntilForcedReboot(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-cyan/40"
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <button
              onClick={handleCreate}
              disabled={!displayName.trim() || (expedited && !qualityUpdateRelease.trim()) || createProfile.isPending}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-accent-cyan hover:bg-accent-cyan-dim text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              {createProfile.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              <T>Create</T>
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
