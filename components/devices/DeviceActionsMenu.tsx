'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { RefreshCw, Power, PowerOff, Bell, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useDeviceAction } from '@/hooks/use-device-actions';

interface DeviceActionsMenuProps {
  deviceId: string;
  deviceName: string;
}

type ConfirmAction = 'reboot' | 'shutdown' | null;

const CONFIRM_COPY: Record<Exclude<ConfirmAction, null>, { title: string; description: string; confirmLabel: string }> = {
  reboot: {
    title: 'Restart this device?',
    description: 'The device will restart immediately with no save prompt for the signed-in user.',
    confirmLabel: 'Restart',
  },
  shutdown: {
    title: 'Shut down this device?',
    description: 'The device will power off immediately and stay off until someone turns it back on.',
    confirmLabel: 'Shut Down',
  },
};

export function DeviceActionsMenu({ deviceId, deviceName }: DeviceActionsMenuProps) {
  const action = useDeviceAction(deviceId);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyTitle, setNotifyTitle] = useState('');
  const [notifyBody, setNotifyBody] = useState('');

  const pendingAction = action.isPending ? action.variables?.action : undefined;

  const runSimpleAction = (kind: 'sync' | 'reboot' | 'shutdown') => {
    const labels: Record<typeof kind, string> = {
      sync: 'Sync requested',
      reboot: 'Restart command sent',
      shutdown: 'Shutdown command sent',
    };
    action.mutate(
      { action: kind },
      {
        onSuccess: () => toast.success(`${labels[kind]} for ${deviceName}`),
        onError: (err) => toast.error(err.message || 'Action failed'),
      }
    );
  };

  const handleConfirm = () => {
    if (!confirmAction) return;
    runSimpleAction(confirmAction);
    setConfirmAction(null);
  };

  const handleSendNotification = () => {
    if (!notifyTitle.trim() || !notifyBody.trim()) return;
    action.mutate(
      { action: 'notify', notificationTitle: notifyTitle.trim(), notificationBody: notifyBody.trim() },
      {
        onSuccess: () => {
          toast.success(`Notification sent to ${deviceName}`);
          setNotifyOpen(false);
          setNotifyTitle('');
          setNotifyBody('');
        },
        onError: (err) => toast.error(err.message || 'Failed to send notification'),
      }
    );
  };

  return (
    <>
      <Button
        variant="ghost"
        onClick={() => runSimpleAction('sync')}
        disabled={action.isPending}
        className="text-text-secondary hover:text-text-primary"
      >
        {pendingAction === 'sync' ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <RefreshCw className="w-4 h-4 mr-2" />
        )}
        Sync Device
      </Button>
      <Button
        variant="ghost"
        onClick={() => setConfirmAction('reboot')}
        disabled={action.isPending}
        className="text-text-secondary hover:text-text-primary"
      >
        {pendingAction === 'reboot' ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <Power className="w-4 h-4 mr-2" />
        )}
        Restart Device
      </Button>
      <Button
        variant="ghost"
        onClick={() => setConfirmAction('shutdown')}
        disabled={action.isPending}
        className="text-text-secondary hover:text-text-primary"
      >
        {pendingAction === 'shutdown' ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <PowerOff className="w-4 h-4 mr-2" />
        )}
        Shut Down Device
      </Button>
      <Button
        variant="ghost"
        onClick={() => setNotifyOpen(true)}
        disabled={action.isPending}
        className="text-text-secondary hover:text-text-primary"
      >
        {pendingAction === 'notify' ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <Bell className="w-4 h-4 mr-2" />
        )}
        Send Notification
      </Button>

      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          {confirmAction && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{CONFIRM_COPY[confirmAction].title}</AlertDialogTitle>
                <AlertDialogDescription>{CONFIRM_COPY[confirmAction].description}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleConfirm}>
                  {CONFIRM_COPY[confirmAction].confirmLabel}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={notifyOpen} onOpenChange={setNotifyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send notification to Company Portal</DialogTitle>
            <DialogDescription>
              Pushes a message to the Company Portal app on {deviceName} for the signed-in user.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder="Title"
              value={notifyTitle}
              onChange={(e) => setNotifyTitle(e.target.value)}
              maxLength={100}
            />
            <Input
              placeholder="Message"
              value={notifyBody}
              onChange={(e) => setNotifyBody(e.target.value)}
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-overlay/10" onClick={() => setNotifyOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSendNotification}
              disabled={!notifyTitle.trim() || !notifyBody.trim() || action.isPending}
            >
              {action.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
