'use client';

import { useState, useEffect, useCallback } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useMspOptional } from '@/hooks/useMspOptional';

// Persisted dismissal so the nudge does not reappear on every dashboard load.
const DISMISS_KEY = 'intuneget_filter_consent_dismissed';

/**
 * Non-blocking nudge shown when core admin consent is in place but the
 * DeviceManagementConfiguration.Read.All permission (required to read Intune
 * assignment filters) has not been consented yet. This permission was added
 * after some tenants had already granted consent, so they will not be prompted
 * for it on sign-in - re-running admin consent grants the full current set.
 *
 * Deliberately does not block anything: deployment works without filters, so
 * this only surfaces the opportunity and offers a one-click re-consent.
 */
export function FilterPermissionNudge() {
  const { user, getAccessToken, requestAdminConsent } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();
  const [visible, setVisible] = useState(false);

  const check = useCallback(async () => {
    if (typeof window !== 'undefined' && localStorage.getItem(DISMISS_KEY) === 'true') {
      return;
    }

    const token = await getAccessToken();
    if (!token) return;

    try {
      const response = await fetch('/api/auth/verify-consent', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
        },
      });
      if (!response.ok) return;

      const data = await response.json();
      // Only nudge when core consent is verified but the filters permission is
      // explicitly missing (false, not null/unknown), so we never contradict the
      // primary consent banner or show a nudge on transient/unknown states.
      if (data?.verified === true && data?.permissions?.deviceManagementConfiguration === false) {
        setVisible(true);
      }
    } catch {
      // Best-effort: the nudge is optional, so swallow errors silently.
    }
  }, [getAccessToken, isMspUser, selectedTenantId]);

  useEffect(() => {
    if (!user) {
      setVisible(false);
      return;
    }
    check();
  }, [user, check]);

  const handleDismiss = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(DISMISS_KEY, 'true');
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-6">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-amber-500/20 rounded-lg">
          <SlidersHorizontal className="w-5 h-5 text-amber-400" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-text-primary mb-1">
            Enable Intune assignment filters
          </h3>
          <p className="text-sm text-text-secondary mb-4">
            To use assignment filters when deploying apps, HKS App Deployment needs the{' '}
            <code className="text-amber-600 bg-amber-500/10 px-1 rounded">
              DeviceManagementConfiguration.Read.All
            </code>{' '}
            permission. Re-grant admin consent to enable it - everything else keeps working without it.
          </p>
          <Button
            onClick={() => requestAdminConsent()}
            size="sm"
            className="bg-amber-500 hover:bg-amber-600 text-white font-medium"
          >
            Re-grant consent
          </Button>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-text-muted hover:text-text-primary transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
