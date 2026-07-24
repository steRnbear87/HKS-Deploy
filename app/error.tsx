"use client";

import Link from "next/link";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-bg-deepest flex items-center justify-center px-4">
      <div className="text-center max-w-lg">
        <p className="font-mono text-sm text-red-400 mb-4">Error</p>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl mb-4">
          Something Went Wrong
        </h1>
        <p className="text-text-secondary mb-8 leading-relaxed">
          An unexpected error occurred. You can try again or navigate back to a
          working page.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            onClick={() => reset()}
            className="inline-flex items-center justify-center gap-2 px-8 py-3 text-base font-semibold text-white bg-accent-cyan rounded-xl hover:bg-accent-cyan-dim transition-all"
          >
            Try Again
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-2 px-8 py-3 text-base font-semibold text-text-secondary bg-bg-elevated border border-overlay/10 rounded-xl hover:bg-overlay/[0.04] transition-all"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
