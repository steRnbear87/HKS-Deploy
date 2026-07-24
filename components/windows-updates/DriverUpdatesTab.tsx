'use client';

import { useState } from 'react';
import { HardDrive, Plus, Loader2, Check, X, RotateCcw } from 'lucide-react';
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
import {
  useDriverUpdateProfiles,
  useCreateDriverUpdateProfile,
  useDriverInventory,
  useSetDriverApprovalStatus,
} from '@/hooks/use-windows-updates';
import { AssignmentSummaryLine } from '@/components/windows-updates/AssignmentSummaryLine';
import type { DriverInventoryItem } from '@/types/windows-updates';

const STATUS_STYLES: Record<DriverInventoryItem['approvalStatus'], string> = {
  needsReview: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  approved: 'bg-green-500/10 text-green-400 border-green-500/20',
  declined: 'bg-red-500/10 text-red-400 border-red-500/20',
  suspended: 'bg-overlay/10 text-text-muted border-overlay/20',
};

function DriverInventoryTable({ profileId }: { profileId: string }) {
  const { data, isLoading } = useDriverInventory(profileId);
  const setApproval = useSetDriverApprovalStatus();

  const handleSetStatus = async (driverId: string, status: DriverInventoryItem['approvalStatus']) => {
    try {
      await setApproval.mutateAsync({ profileId, driverId, approvalStatus: status });
    } catch (error) {
      toast.error('Failed to update driver', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  };

  if (isLoading) {
    return <p className="text-sm text-text-muted px-2 py-4 text-center"><T>Loading driver inventory...</T></p>;
  }

  const drivers = data?.drivers || [];
  if (drivers.length === 0) {
    return <p className="text-sm text-text-muted px-2 py-4 text-center"><T>No drivers reported for this profile yet.</T></p>;
  }

  return (
    <div className="space-y-2">
      {drivers.map((driver) => (
        <div
          key={driver.id}
          className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-overlay/5 bg-bg-elevated/50"
        >
          <div className="min-w-0">
            <div className="text-sm font-medium text-text-primary truncate">{driver.name}</div>
            <div className="text-xs text-text-muted">
              {driver.manufacturer} &middot; v{driver.version}
              {driver.applicableDeviceCount != null && ` · ${driver.applicableDeviceCount} devices`}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`px-2 py-0.5 rounded text-xs font-medium border ${STATUS_STYLES[driver.approvalStatus]}`}>
              {driver.approvalStatus}
            </span>
            <button
              title="Approve"
              onClick={() => handleSetStatus(driver.id, 'approved')}
              disabled={setApproval.isPending || driver.approvalStatus === 'approved'}
              className="p-1.5 rounded-md text-green-400 hover:bg-green-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              title="Decline"
              onClick={() => handleSetStatus(driver.id, 'declined')}
              disabled={setApproval.isPending || driver.approvalStatus === 'declined'}
              className="p-1.5 rounded-md text-red-400 hover:bg-red-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <button
              title="Reset to needs review"
              onClick={() => handleSetStatus(driver.id, 'needsReview')}
              disabled={setApproval.isPending || driver.approvalStatus === 'needsReview'}
              className="p-1.5 rounded-md text-text-muted hover:bg-overlay/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function DriverUpdatesTab() {
  const { data, isLoading } = useDriverUpdateProfiles();
  const createProfile = useCreateDriverUpdateProfile();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  const profiles = data?.profiles || [];

  const handleCreate = async () => {
    if (!displayName.trim()) return;
    try {
      await createProfile.mutateAsync({ displayName: displayName.trim() });
      toast.success(`Driver update profile "${displayName}" created`);
      setDialogOpen(false);
      setDisplayName('');
    } catch (error) {
      toast.error('Failed to create driver update profile', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  };

  if (isLoading) {
    return <p className="text-sm text-text-muted px-2 py-8 text-center"><T>Loading driver update profiles...</T></p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setDialogOpen(true)}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-accent-cyan hover:bg-accent-cyan-dim text-white transition-colors flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          <T>Create Driver Update Profile</T>
        </button>
      </div>

      {profiles.length === 0 ? (
        <AnimatedEmptyState
          icon={HardDrive}
          title={<T>No Driver Update Profiles yet</T>}
          description={<T>Create one to approve or decline specific driver updates.</T>}
          color="cyan"
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          <div className="glass-light border border-overlay/5 rounded-xl p-3 space-y-1">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                onClick={() => setSelectedProfileId(profile.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedProfileId === profile.id
                    ? 'bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20'
                    : 'text-text-primary hover:bg-overlay/5 border border-transparent'
                }`}
              >
                <div>{profile.displayName}</div>
                <AssignmentSummaryLine assignments={profile.assignments} />
              </button>
            ))}
          </div>
          <div className="glass-light border border-overlay/5 rounded-xl p-4">
            {selectedProfileId ? (
              <DriverInventoryTable profileId={selectedProfileId} />
            ) : (
              <p className="text-sm text-text-muted px-2 py-8 text-center">
                <T>Select a profile to view and approve its driver inventory.</T>
              </p>
            )}
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle><T>Create Driver Update Profile</T></DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1.5"><T>Name</T></label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Manual Driver Approval"
                className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan/40"
              />
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={handleCreate}
              disabled={!displayName.trim() || createProfile.isPending}
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
