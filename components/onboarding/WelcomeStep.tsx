'use client';

import { Rocket, Shield, Package, ArrowRight } from 'lucide-react';
import { T, Var } from "gt-next";
import { Button } from '@/components/ui/button';
import { getFirstName } from '@/lib/utils';

interface WelcomeStepProps {
  userName: string | null | undefined;
  onNext: () => void;
}

export function WelcomeStep({ userName, onNext }: WelcomeStepProps) {
  const firstName = getFirstName(userName);

  return (
    <div className="text-center max-w-2xl mx-auto">
      {/* Icon */}
      <div className="mb-8">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-accent-cyan/10 rounded-2xl">
          <Rocket className="w-10 h-10 text-accent-cyan" />
        </div>
      </div>

      {/* Heading */}
      <h1 className="text-2xl sm:text-3xl font-bold text-text-primary mb-4">
        <T>Welcome, <Var>{firstName}</Var>!</T>
      </h1>

      <p className="text-lg text-text-muted mb-8">
        <T>Let's get your organization set up to deploy apps to Intune in minutes.</T>
      </p>

      {/* What IntuneGet does */}
      <div className="bg-bg-elevated border border-overlay/10 rounded-xl p-6 mb-8 text-left shadow-soft">
        <h2 className="text-lg font-semibold text-text-primary mb-4">
          <T>What HKS App Deployment does</T>
        </h2>
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-accent-cyan/10 rounded-lg flex-shrink-0">
              <Package className="w-5 h-5 text-accent-cyan" />
            </div>
            <div>
              <h3 className="font-medium text-text-primary"><T>Browse Apps</T></h3>
              <p className="text-sm text-text-muted">
                <T>Search and browse thousands of applications from the Windows
                Package Manager (winget) repository.</T>
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="p-2 bg-accent-violet/10 rounded-lg flex-shrink-0">
              <Shield className="w-5 h-5 text-accent-violet" />
            </div>
            <div>
              <h3 className="font-medium text-text-primary"><T>Deploy to Intune</T></h3>
              <p className="text-sm text-text-muted">
                <T>One-click deployment directly to your Microsoft Intune tenant.
                No manual packaging required.</T>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Setup info */}
      <div className="bg-overlay/[0.04] border border-overlay/10 rounded-xl p-4 mb-8">
        <p className="text-sm text-text-secondary">
          <T><Var><strong className="text-text-primary">Quick setup:</strong></Var> We need admin
          consent to upload apps to your organization. This is a one-time step.</T>
        </p>
      </div>

      {/* CTA */}
      <Button
        onClick={onNext}
        size="lg"
        className="bg-accent-cyan hover:bg-accent-cyan-dim text-white px-8 shadow-glow-cyan"
      >
        <T>Get Started</T>
        <ArrowRight className="w-5 h-5 ml-2" />
      </Button>
    </div>
  );
}
