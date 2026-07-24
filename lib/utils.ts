import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Extract a first name for greetings from a display name. Handles the
 * "Prefix LastName, FirstName" convention (e.g. Entra ID names like
 * "ADM Dzekashu, Bernard") by taking the name after the last comma;
 * otherwise falls back to the first whitespace-separated word.
 */
export function getFirstName(name: string | null | undefined, fallback = 'there'): string {
  if (!name) return fallback;
  const trimmed = name.trim();
  if (!trimmed) return fallback;

  const afterComma = trimmed.includes(',') ? trimmed.split(',').pop()?.trim() : null;
  const source = afterComma || trimmed;

  return source.split(' ')[0] || fallback;
}

/**
 * Format a timestamp as relative time (e.g., "Just now", "5m ago", "2h ago")
 */
export function formatRelativeTime(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return 'Just now';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  // For older dates, show formatted date
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}
