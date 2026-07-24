import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page Not Found | HKS App Deployment",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="min-h-screen bg-bg-deepest flex items-center justify-center px-4">
      <div className="text-center max-w-lg">
        <p className="font-mono text-sm text-accent-cyan mb-4">404</p>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl mb-4">
          Page Not Found
        </h1>
        <p className="text-text-secondary mb-8 leading-relaxed">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center gap-2 px-8 py-3 text-base font-semibold text-white bg-accent-cyan rounded-xl hover:bg-accent-cyan-dim transition-all"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
