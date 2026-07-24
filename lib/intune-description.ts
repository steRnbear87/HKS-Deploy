/**
 * Utilities for building Intune app descriptions.
 */

export const INTUNE_APP_SOURCE_MARKER = 'Source: HKS App Deployment';

export interface IntuneDescriptionParams {
  description?: string;
  fallback: string;
  sourceMarker?: string;
}

export function buildIntuneAppDescription({
  description,
  fallback,
  sourceMarker = INTUNE_APP_SOURCE_MARKER,
}: IntuneDescriptionParams): string {
  const trimmedDescription = description?.trim();
  const baseDescription = trimmedDescription || fallback.trim();
  const hasSourceMarker = baseDescription
    .toLowerCase()
    .includes(sourceMarker.toLowerCase());

  if (hasSourceMarker) {
    return baseDescription;
  }

  return `${baseDescription}\n${sourceMarker}`;
}
