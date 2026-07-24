'use client';

import { Lock, Laptop, Apple } from 'lucide-react';
import { StatusBadge } from '@/components/ui/status-badge';
import type { DeviceEncryptionCounts } from '@/types/devices';

interface DeviceEncryptionRollupProps {
  counts: DeviceEncryptionCounts;
}

function EncryptionRow({
  icon: Icon,
  label,
  encrypted,
  unencrypted,
  unknown,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  encrypted: number;
  unencrypted: number;
  unknown: number;
}) {
  return (
    <div className="py-3 border-b border-overlay/10 last:border-b-0">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-accent-cyan" />
        <span className="text-sm font-medium text-text-primary">{label}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge tone="success">{encrypted} encrypted</StatusBadge>
        {unencrypted > 0 && <StatusBadge tone="error">{unencrypted} not encrypted</StatusBadge>}
        {unknown > 0 && <StatusBadge tone="neutral">{unknown} unknown</StatusBadge>}
      </div>
    </div>
  );
}

export function DeviceEncryptionRollup({ counts }: DeviceEncryptionRollupProps) {
  return (
    <div className="glass-light rounded-xl border border-overlay/5 p-6">
      <div className="flex items-center gap-2 mb-2">
        <Lock className="w-4 h-4 text-accent-cyan" />
        <h2 className="text-lg font-semibold text-text-primary">Encryption Compliance</h2>
      </div>
      <div>
        <EncryptionRow
          icon={Laptop}
          label="BitLocker"
          encrypted={counts.windowsEncrypted}
          unencrypted={counts.windowsUnencrypted}
          unknown={counts.windowsUnknown}
        />
        <EncryptionRow
          icon={Apple}
          label="FileVault"
          encrypted={counts.macEncrypted}
          unencrypted={counts.macUnencrypted}
          unknown={counts.macUnknown}
        />
      </div>
    </div>
  );
}
