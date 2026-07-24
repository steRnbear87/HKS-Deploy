'use client';

import { useState } from 'react';
import { MonitorCog, Plus, Loader2 } from 'lucide-react';
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
import { useFeatureUpdateProfiles, useCreateFeatureUpdateProfile } from '@/hooks/use-windows-updates';
import { AssignmentSummaryLine } from '@/components/windows-updates/AssignmentSummaryLine';

export function FeatureUpdatesTab() {
  const { data, isLoading } = useFeatureUpdateProfiles();
  const createProfile = useCreateFeatureUpdateProfile();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [featureUpdateVersion, setFeatureUpdateVersion] = useState('');

  const profiles = data?.profiles || [];

  const handleCreate = async () => {
    if (!displayName.trim() || !featureUpdateVersion.trim()) return;
    try {
      await createProfile.mutateAsync({
        displayName: displayName.trim(),
        featureUpdateVersion: featureUpdateVersion.trim(),
      });
      toast.success(`Feature update profile "${displayName}" created`);
      setDialogOpen(false);
      setDisplayName('');
      setFeatureUpdateVersion('');
    } catch (error) {
      toast.error('Failed to create feature update profile', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  };

  if (isLoading) {
    return <p className="text-sm text-text-muted px-2 py-8 text-center"><T>Loading feature update profiles...</T></p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setDialogOpen(true)}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-accent-cyan hover:bg-accent-cyan-dim text-white transition-colors flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          <T>Create Feature Update Profile</T>
        </button>
      </div>

      {profiles.length === 0 ? (
        <AnimatedEmptyState
          icon={MonitorCog}
          title={<T>No Feature Update Profiles yet</T>}
          description={<T>Create one to pin devices to a specific Windows feature update version.</T>}
          color="cyan"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {profiles.map((profile) => (
            <div key={profile.id} className="glass-light border border-overlay/5 rounded-xl p-4">
              <h4 className="font-semibold text-text-primary mb-1">{profile.displayName}</h4>
              <p className="text-sm text-text-secondary">
                <T>Target version</T>: {profile.featureUpdateVersion}
              </p>
              <AssignmentSummaryLine assignments={profile.assignments} />
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle><T>Create Feature Update Profile</T></DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1.5"><T>Name</T></label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Windows 11 24H2 Rollout"
                className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan/40"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1.5">
                <T>Target feature update version</T>
              </label>
              <input
                type="text"
                value={featureUpdateVersion}
                onChange={(e) => setFeatureUpdateVersion(e.target.value)}
                placeholder="e.g. 24H2"
                className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan/40"
              />
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={handleCreate}
              disabled={!displayName.trim() || !featureUpdateVersion.trim() || createProfile.isPending}
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
