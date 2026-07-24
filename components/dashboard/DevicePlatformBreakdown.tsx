'use client';

import { Laptop, Apple, Smartphone } from 'lucide-react';
import { AnimatedStatCard, StatCardGrid } from './AnimatedStatCard';
import type { DevicePlatformCounts } from '@/types/devices';

interface DevicePlatformBreakdownProps {
  counts: DevicePlatformCounts;
}

export function DevicePlatformBreakdown({ counts }: DevicePlatformBreakdownProps) {
  return (
    <StatCardGrid columns={3}>
      <AnimatedStatCard title="Microsoft" value={counts.microsoft} icon={Laptop} color="cyan" />
      <AnimatedStatCard title="Apple" value={counts.apple} icon={Apple} color="violet" />
      <AnimatedStatCard title="Google" value={counts.google} icon={Smartphone} color="success" />
    </StatCardGrid>
  );
}
