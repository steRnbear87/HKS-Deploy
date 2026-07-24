'use client';

import { useMemo, useState } from 'react';
import { MonitorCog, Search, Laptop, Layers, ShieldCheck, HardDrive, AppWindow } from 'lucide-react';
import { T } from 'gt-next';
import { PageHeader, AnimatedEmptyState } from '@/components/dashboard';
import { WindowsUpdatePermissionNudge } from '@/components/WindowsUpdatePermissionNudge';
import { DeviceUpdatePanel } from '@/components/windows-updates/DeviceUpdatePanel';
import { RingsTab } from '@/components/windows-updates/RingsTab';
import { FeatureUpdatesTab } from '@/components/windows-updates/FeatureUpdatesTab';
import { QualityUpdatesTab } from '@/components/windows-updates/QualityUpdatesTab';
import { DriverUpdatesTab } from '@/components/windows-updates/DriverUpdatesTab';
import { ReleaseCatalogSection } from '@/components/windows-updates/ReleaseCatalogSection';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDevices } from '@/hooks/use-devices';
import type { ManagedDevice } from '@/types/devices';

/**
 * Windows Update management - foundation shell (slice 1 of the build plan).
 *
 * "By Device" is the actual per-device ask: search/select a device, then
 * (in later slices) configure its Update Ring / Feature / Quality / Driver /
 * M365 Apps assignment in one place via the auto-managed single-device
 * group (lib/intune/device-update-groups.ts). The five policy-list tabs
 * manage the underlying Graph objects directly and land in later slices.
 */
export default function WindowsUpdatesPage() {
  const [deviceSearch, setDeviceSearch] = useState('');
  const [selectedDevice, setSelectedDevice] = useState<ManagedDevice | null>(null);
  const { data: devicesData, isLoading: isLoadingDevices } = useDevices();

  const filteredDevices = useMemo(() => {
    const devices = devicesData?.devices || [];
    const query = deviceSearch.trim().toLowerCase();
    if (!query) return devices.slice(0, 25);
    return devices
      .filter(
        (d) =>
          d.deviceName.toLowerCase().includes(query) ||
          d.userPrincipalName?.toLowerCase().includes(query) ||
          d.model?.toLowerCase().includes(query)
      )
      .slice(0, 25);
  }, [devicesData, deviceSearch]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={<T>Windows Updates</T>}
        description={
          <T>Manage quality, feature, and driver updates per device, all in one place.</T>
        }
        icon={MonitorCog}
        gradient
        gradientColors="cyan"
      />

      <WindowsUpdatePermissionNudge />

      <ReleaseCatalogSection />

      <Tabs defaultValue="by-device">
        <TabsList className="glass-light border border-overlay/5 flex-wrap h-auto">
          <TabsTrigger value="by-device" className="data-[state=active]:bg-overlay/10">
            <Laptop className="w-4 h-4 mr-1.5" />
            <T>By Device</T>
          </TabsTrigger>
          <TabsTrigger value="rings" className="data-[state=active]:bg-overlay/10">
            <Layers className="w-4 h-4 mr-1.5" />
            <T>Update Rings</T>
          </TabsTrigger>
          <TabsTrigger value="feature" className="data-[state=active]:bg-overlay/10">
            <MonitorCog className="w-4 h-4 mr-1.5" />
            <T>Feature Updates</T>
          </TabsTrigger>
          <TabsTrigger value="quality" className="data-[state=active]:bg-overlay/10">
            <ShieldCheck className="w-4 h-4 mr-1.5" />
            <T>Quality Updates</T>
          </TabsTrigger>
          <TabsTrigger value="driver" className="data-[state=active]:bg-overlay/10">
            <HardDrive className="w-4 h-4 mr-1.5" />
            <T>Driver Updates</T>
          </TabsTrigger>
          <TabsTrigger value="m365" className="data-[state=active]:bg-overlay/10">
            <AppWindow className="w-4 h-4 mr-1.5" />
            <T>M365 Apps</T>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="by-device" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
            <div className="glass-light border border-overlay/5 rounded-xl p-3 space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input
                  type="text"
                  placeholder="Search devices..."
                  value={deviceSearch}
                  onChange={(e) => setDeviceSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-bg-elevated border border-overlay/10 rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan/40"
                />
              </div>
              <div className="max-h-[500px] overflow-y-auto space-y-1">
                {isLoadingDevices ? (
                  <p className="text-sm text-text-muted px-2 py-4 text-center"><T>Loading devices...</T></p>
                ) : filteredDevices.length === 0 ? (
                  <p className="text-sm text-text-muted px-2 py-4 text-center"><T>No devices found</T></p>
                ) : (
                  filteredDevices.map((device) => (
                    <button
                      key={device.id}
                      onClick={() => setSelectedDevice(device)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                        selectedDevice?.id === device.id
                          ? 'bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20'
                          : 'text-text-primary hover:bg-overlay/5 border border-transparent'
                      }`}
                    >
                      <div className="font-medium truncate">{device.deviceName}</div>
                      {device.userPrincipalName && (
                        <div className="text-xs text-text-muted truncate">{device.userPrincipalName}</div>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="glass-light border border-overlay/5 rounded-xl p-6">
              {selectedDevice ? (
                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-1">{selectedDevice.deviceName}</h3>
                  <p className="text-sm text-text-muted mb-6">
                    {selectedDevice.operatingSystem} {selectedDevice.osVersion}
                  </p>
                  <DeviceUpdatePanel device={selectedDevice} />
                </div>
              ) : (
                <AnimatedEmptyState
                  icon={Laptop}
                  title={<T>Select a device</T>}
                  description={<T>Choose a device from the list to manage its Windows Updates.</T>}
                  showOrbs={false}
                  color="neutral"
                />
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="rings" className="mt-4">
          <RingsTab />
        </TabsContent>
        <TabsContent value="feature" className="mt-4">
          <FeatureUpdatesTab />
        </TabsContent>
        <TabsContent value="quality" className="mt-4">
          <QualityUpdatesTab />
        </TabsContent>
        <TabsContent value="driver" className="mt-4">
          <DriverUpdatesTab />
        </TabsContent>
        <TabsContent value="m365" className="mt-4">
          <AnimatedEmptyState
            icon={AppWindow}
            title={<T>M365 Apps Update Channel</T>}
            description={<T>Coming soon.</T>}
            color="cyan"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
