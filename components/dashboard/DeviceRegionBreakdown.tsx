'use client';

import { MapPin, HelpCircle } from 'lucide-react';
import { AnimatedStatCard, StatCardGrid } from './AnimatedStatCard';
import { REGION_ORDER, type DeviceRegionCounts } from '@/lib/intune/office-regions';

interface DeviceRegionBreakdownProps {
  counts: DeviceRegionCounts;
}

export function DeviceRegionBreakdown({ counts }: DeviceRegionBreakdownProps) {
  return (
    <StatCardGrid columns={5}>
      {REGION_ORDER.map((region) => (
        <AnimatedStatCard
          key={region}
          title={region}
          value={counts[region]}
          icon={region === 'Unknown region' ? HelpCircle : MapPin}
          color={region === 'Unknown region' ? 'neutral' : 'cyan'}
        />
      ))}
    </StatCardGrid>
  );
}
