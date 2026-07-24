'use client';

import { useState, useEffect, useCallback } from 'react';
import { Shield, Copy, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';

const CONSENT_STORAGE_KEY = 'intuneget_consent_granted';
const CONSENT_CACHE_KEY = 'intuneget_consent_verified_at';
// Short cache prevents API spam during rapid navigation while ensuring stale state clears quickly.
// Previously 24h, which caused divergence when permissions changed or propagation was delayed.
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// Time-bounded hint that consent was just granted and Microsoft may still be
// propagating role claims into new tokens. While this flag is active, the
// client sends `justConsented=true` so the API can surface a "propagating"
// message instead of hard-failing with "insufficient permissions".
// Capped so a stuck client can't keep the user in the waiting state forever.
// Stored in localStorage so the flag survives tab close/reopen during the
// propagation window (otherwise a user who closes the tab after consent and
// reopens the app would incorrectly see "re-grant consent").
const CONSENT_PENDING_KEY = 'intuneget_consent_pending_at';
const CONSENT_PENDING_MAX_MS = 20 * 60 * 1000; // 20 minutes

interface AdminConsentBannerProps {
  onConsentGranted?: () => void;
}

type ConsentErrorType = 'missing_credentials' | 'network_error' | 'consent_not_granted' | 'insufficient_intune_permissions' | 'consent_propagating' | null;

interface ConsentVerificationResult {
  verified: boolean;
  tenantId: string;
  message: string;
  cachedResult?: boolean;
  error?: ConsentErrorType;
}

/**
 * Banner that shows when admin consent hasn't been granted yet.
 *
 * Admin consent is required for:
 * - The service principal to upload apps to the user's Intune tenant
 * - Only Global Admins or Privileged Role Admins can grant consent
 * - Intune Admins cannot grant consent (they can only use the app after consent)
 */
export function AdminConsentBanner({ onConsentGranted }: AdminConsentBannerProps) {
  const { user, getAccessToken, requestAdminConsent, getShareableConsentUrl } = useMicrosoftAuth();
  const [isVisible, setIsVisible] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showShareOption, setShowShareOption] = useState(false);
  const [errorType, setErrorType] = useState<ConsentErrorType>(null);

  /**
   * Verify consent via API.
   * Pass `justConsented: true` within the post-consent window so the API can
   * distinguish Microsoft's role-claim propagation delay from genuine
   * insufficient-permission failures.
   */
  const verifyConsentViaApi = useCallback(async (opts?: { justConsented?: boolean }): Promise<ConsentVerificationResult> => {
    try {
      const token = await getAccessToken();
      if (!token) return { verified: false, tenantId: '', message: 'No token', error: 'network_error' };

      const url = opts?.justConsented
        ? '/api/auth/verify-consent?justConsented=true'
        : '/api/auth/verify-consent';
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return { verified: false, tenantId: '', message: 'Request failed', error: 'network_error' };
      }

      const result: ConsentVerificationResult = await response.json();
      return result;
    } catch (error) {
      console.error('Error verifying consent:', error);
      return { verified: false, tenantId: '', message: 'Error', error: 'network_error' };
    }
  }, [getAccessToken]);

  /**
   * Check if we should verify consent
   */
  const shouldVerifyConsent = useCallback((): boolean => {
    // Check localStorage cache first
    const localConsent = localStorage.getItem(CONSENT_STORAGE_KEY);
    const cachedAt = localStorage.getItem(CONSENT_CACHE_KEY);

    if (localConsent === 'true' && cachedAt) {
      const cacheTime = parseInt(cachedAt, 10);
      if (Date.now() - cacheTime < CACHE_DURATION_MS) {
        // Cache is still valid
        return false;
      }
    }

    return true;
  }, []);

  useEffect(() => {
    if (!user) {
      setIsVisible(false);
      return;
    }

    // Quick check: if localStorage says we're good and cache is fresh, don't show
    if (!shouldVerifyConsent()) {
      setIsVisible(false);
      return;
    }

    // Verify via API. If consent was just granted, signal that to the API so
    // it returns the propagation-specific error instead of "insufficient".
    const checkConsent = async () => {
      setIsVerifying(true);
      const consentPending = isConsentPending();
      const result = await verifyConsentViaApi({ justConsented: consentPending });
      setIsVerifying(false);

      if (result.verified) {
        // Update localStorage cache and clear pending flag
        localStorage.setItem(CONSENT_STORAGE_KEY, 'true');
        localStorage.setItem(CONSENT_CACHE_KEY, Date.now().toString());
        if (consentPending) clearConsentPending();
        setIsVisible(false);
        setErrorType(null);
        onConsentGranted?.();
      } else {
        // Clear any stale cache
        localStorage.removeItem(CONSENT_STORAGE_KEY);
        localStorage.removeItem(CONSENT_CACHE_KEY);
        setErrorType(result.error || 'consent_not_granted');
        setIsVisible(true);
      }
    };

    checkConsent();
  }, [user, verifyConsentViaApi, shouldVerifyConsent, onConsentGranted]);

  const handleGrantConsent = () => {
    requestAdminConsent();
  };

  const handleCopyLink = async () => {
    const url = getShareableConsentUrl();
    if (url) {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDismiss = () => {
    // User chose to skip for now - hide banner but don't cache
    setIsVisible(false);
  };

  const handleAlreadyGranted = async () => {
    // User claims consent was already granted - verify via API.
    // Forward the pending hint so "Check Again" on the propagating banner
    // doesn't immediately flip to the amber "re-grant" UI just because
    // Microsoft hasn't propagated role claims yet.
    setIsVerifying(true);
    const consentPending = isConsentPending();
    const result = await verifyConsentViaApi({ justConsented: consentPending });
    setIsVerifying(false);

    if (result.verified) {
      localStorage.setItem(CONSENT_STORAGE_KEY, 'true');
      localStorage.setItem(CONSENT_CACHE_KEY, Date.now().toString());
      if (consentPending) clearConsentPending();
      setIsVisible(false);
      setErrorType(null);
      onConsentGranted?.();
    } else {
      // Set the error type to show appropriate message
      setErrorType(result.error || 'consent_not_granted');
    }
  };

  // Show loading state while verifying
  if (isVerifying && !isVisible) {
    return (
      <div className="bg-bg-elevated/50 border border-overlay/10 rounded-xl p-4 mb-6">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-accent-cyan animate-spin" />
          <span className="text-text-secondary">Verifying organization setup...</span>
        </div>
      </div>
    );
  }

  if (!isVisible) return null;

  // Special UI for consent propagation delay (consent just granted, roles not yet in token)
  if (errorType === 'consent_propagating') {
    return (
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-text-primary mb-1">
              Finalizing Setup
            </h3>
            <p className="text-sm text-text-secondary mb-4">
              Admin consent was granted successfully. Microsoft is still propagating the new permissions to your tokens - this typically takes <strong className="text-blue-400">5 to 15 minutes</strong>. Please click below to check again shortly.
            </p>
            <Button
              onClick={handleAlreadyGranted}
              size="sm"
              className="bg-blue-500 hover:bg-blue-600 text-white font-medium"
              disabled={isVerifying}
            >
              {isVerifying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Checking...
                </>
              ) : (
                'Check Again'
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Special UI for insufficient Intune permissions (existing users who need to re-consent)
  if (errorType === 'insufficient_intune_permissions') {
    return (
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-amber-500/20 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-text-primary mb-1">
              Intune Permissions Missing
            </h3>
            <p className="text-sm text-text-secondary mb-2">
              Admin consent was granted, but required Intune permissions are missing.
              The app needs <code className="text-amber-600 text-xs">DeviceManagementApps.ReadWrite.All</code>,
              <code className="text-amber-600 text-xs ml-1">DeviceManagementManagedDevices.Read.All</code>,
              <code className="text-amber-600 text-xs ml-1">DeviceManagementServiceConfig.ReadWrite.All</code> (for ESP profiles), and
              <code className="text-amber-600 text-xs ml-1">DeviceManagementConfiguration.Read.All</code> (for assignment filters).
              This can happen if permissions were updated after initial consent.
            </p>
            <p className="text-sm text-text-secondary mb-4">
              <strong className="text-amber-600">Your packaging jobs may be failing because of this.</strong> A Global Administrator needs to re-grant admin consent.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={handleGrantConsent}
                size="sm"
                className="bg-amber-500 hover:bg-amber-600 text-black font-medium"
              >
                <Shield className="w-4 h-4 mr-2" />
                Re-grant Admin Consent
              </Button>
              <Button
                onClick={handleAlreadyGranted}
                size="sm"
                variant="ghost"
                className="text-text-secondary hover:text-text-primary"
                disabled={isVerifying}
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Checking...
                  </>
                ) : (
                  'Check Again'
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-6">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-amber-500/20 rounded-lg">
          <Shield className="w-5 h-5 text-amber-600" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-text-primary mb-1">
            Organization Setup Required
          </h3>
          <p className="text-sm text-text-secondary mb-4">
            To deploy apps to your Intune tenant, a <strong className="text-amber-600">Global Administrator</strong> needs
            to grant permission for HKS App Deployment to access your organization.
          </p>

          {!showShareOption ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={handleGrantConsent}
                size="sm"
                className="bg-amber-500 hover:bg-amber-600 text-black font-medium"
              >
                <Shield className="w-4 h-4 mr-2" />
                Grant Admin Consent
              </Button>
              <Button
                onClick={() => setShowShareOption(true)}
                size="sm"
                variant="outline"
                className="border-overlay/10 text-text-primary hover:bg-overlay/5"
              >
                I'm not a Global Admin
              </Button>
              <Button
                onClick={handleAlreadyGranted}
                size="sm"
                variant="ghost"
                className="text-text-secondary hover:text-text-primary"
              >
                Already granted
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 bg-bg-elevated/50 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-text-primary">
                  <p className="mb-2">
                    <strong>Intune Administrators</strong> cannot grant admin consent.
                    Please share this link with your Global Administrator:
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <code className="flex-1 bg-bg-surface px-3 py-2 rounded text-xs text-text-secondary overflow-hidden text-ellipsis whitespace-nowrap">
                      {getShareableConsentUrl() || 'Loading...'}
                    </code>
                    <Button
                      onClick={handleCopyLink}
                      size="sm"
                      variant="outline"
                      className="border-overlay/10 flex-shrink-0"
                    >
                      {copied ? (
                        <Check className="w-4 h-4 text-green-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  onClick={() => setShowShareOption(false)}
                  size="sm"
                  variant="ghost"
                  className="text-text-secondary hover:text-text-primary"
                >
                  Back
                </Button>
                <Button
                  onClick={handleDismiss}
                  size="sm"
                  variant="ghost"
                  className="text-text-secondary hover:text-text-primary"
                >
                  I'll do this later
                </Button>
              </div>
            </div>
          )}

          <p className="text-xs text-text-muted mt-4">
            This is a one-time setup. After consent is granted, any user with Intune permissions can use HKS App Deployment.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Mark consent as granted (called from consent callback page)
 * This updates the localStorage cache with current timestamp
 */
export function markConsentGranted() {
  if (typeof window !== 'undefined') {
    localStorage.setItem(CONSENT_STORAGE_KEY, 'true');
    localStorage.setItem(CONSENT_CACHE_KEY, Date.now().toString());
  }
}

/**
 * Check if consent has been granted (checks localStorage cache)
 * Note: This is a quick check - actual verification should use the API
 */
export function isConsentGranted(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(CONSENT_STORAGE_KEY) === 'true';
}

/**
 * Clear consent status (for testing or re-authorization)
 */
export function clearConsentStatus() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(CONSENT_STORAGE_KEY);
    localStorage.removeItem(CONSENT_CACHE_KEY);
  }
}

/**
 * Mark consent as pending propagation. Call this right after an admin-consent
 * redirect returns but the verify-consent API reports role claims not yet
 * present in the client credentials token.
 */
export function markConsentPending() {
  if (typeof window !== 'undefined') {
    localStorage.setItem(CONSENT_PENDING_KEY, Date.now().toString());
  }
}

/**
 * Clear the pending flag (call after successful verification).
 */
export function clearConsentPending() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(CONSENT_PENDING_KEY);
  }
}

/**
 * Is consent currently awaiting Microsoft's propagation? Returns false and
 * self-clears after the max window so users aren't stuck on "please wait"
 * indefinitely if permissions were never really granted.
 */
export function isConsentPending(): boolean {
  if (typeof window === 'undefined') return false;
  const pendingAt = localStorage.getItem(CONSENT_PENDING_KEY);
  if (!pendingAt) return false;
  const elapsed = Date.now() - parseInt(pendingAt, 10);
  if (Number.isNaN(elapsed) || elapsed >= CONSENT_PENDING_MAX_MS) {
    localStorage.removeItem(CONSENT_PENDING_KEY);
    return false;
  }
  return true;
}

/**
 * Verify consent via API
 * This is the authoritative check - uses client credentials to verify
 */
export async function verifyConsentApi(
  accessToken: string,
  opts?: { justConsented?: boolean }
): Promise<boolean> {
  const result = await verifyConsentApiDetailed(accessToken, opts);
  return result.verified === true;
}

/**
 * Verify consent via API and return full result (including error type and message)
 */
export async function verifyConsentApiDetailed(
  accessToken: string,
  opts?: { justConsented?: boolean }
): Promise<ConsentVerificationResult> {
  try {
    const url = opts?.justConsented
      ? '/api/auth/verify-consent?justConsented=true'
      : '/api/auth/verify-consent';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return { verified: false, tenantId: '', message: 'Request failed', error: 'network_error' };
    }

    return await response.json();
  } catch {
    return { verified: false, tenantId: '', message: 'Error', error: 'network_error' };
  }
}
