/**
 * Chocolatey App Helpers
 * Builds Win32 cart items for apps sourced from the Chocolatey Community
 * Repository catalog (curated_apps rows with app_source = 'chocolatey').
 *
 * Chocolatey packages reuse the existing win32 packaging pipeline the same
 * way custom apps do (see lib/custom-app.ts), but with a twist: there is no
 * real installer file to download and run. Instead, the "installer" is
 * always the official Chocolatey bootstrap script (a small, stable,
 * real file so the existing download/checksum/.intunewin steps need no
 * changes), and the actual work happens entirely in the install/uninstall
 * command override: bootstrap choco.exe if missing, then `choco
 * install`/`choco uninstall`. Detection is unchanged - the registry marker
 * PSADT writes after a successful install does not care how the install
 * happened underneath.
 */

import { generateDetectionRules } from '@/lib/detection-rules';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import type { NormalizedInstaller, WingetScope } from '@/types/winget';
import type { Win32CartItem } from '@/types/upload';

// The Chocolatey Community Repository's own installer, downloaded (not executed
// directly) so the existing packager download/checksum/.intunewin steps work
// unchanged even though there is no real payload for this "installer type".
export const CHOCOLATEY_BOOTSTRAP_URL = 'https://community.chocolatey.org/install.ps1';

export interface ChocolateyAppInput {
  packageId: string; // Chocolatey package id, e.g. "googlechrome"
  displayName: string;
  publisher: string;
  version: string;
  description?: string;
  iconUrl?: string;
}

export type ChocolateyAppCartItem = Omit<Win32CartItem, 'id' | 'addedAt'>;

/**
 * Chocolatey/NuGet package ids: letters, digits, dots, hyphens, underscores,
 * starting with an alphanumeric. Deliberately does not require the dotted
 * Publisher.Name shape winget ids use (isValidWingetId in lib/app-matching.ts) -
 * most Chocolatey ids are a single lowercase token (e.g. "7zip", "vscode").
 */
export function isValidChocolateyPackageId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}

function escapeForDoubleQuotedPowerShell(value: string): string {
  // These commands run inside a PowerShell double-quoted -Command string that
  // is itself embedded in a single-quoted cmd.exe /c argument (see
  // getCommandOverride in packager/src/job-processor.ts). Package ids/versions
  // are validated before reaching here, but strip quote characters defensively
  // so a malformed value can never break out of the command string.
  return value.replace(/["'`]/g, '');
}

/**
 * Bootstrap choco.exe if missing, then install the pinned version. Exit code
 * is propagated explicitly ($ErrorActionPreference='Stop' + `exit
 * $LASTEXITCODE`) so a failed install throws inside the PSADT script and the
 * detection marker is never written for a failed deployment - the install
 * strategy choice (bootstrap vs. embedding a real installer) has no bearing
 * on detection reliability, only on this exit-code plumbing.
 */
export function buildChocolateyInstallCommand(packageId: string, version: string): string {
  const id = escapeForDoubleQuotedPowerShell(packageId);
  const ver = escapeForDoubleQuotedPowerShell(version);
  return (
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ` +
    `"$ErrorActionPreference = 'Stop'; ` +
    `if (-not (Get-Command choco.exe -ErrorAction SilentlyContinue)) { ` +
    `[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; ` +
    `Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('${CHOCOLATEY_BOOTSTRAP_URL}')) }; ` +
    `choco install ${id} --version=${ver} -y --no-progress --limit-output; exit $LASTEXITCODE"`
  );
}

export function buildChocolateyUninstallCommand(packageId: string): string {
  const id = escapeForDoubleQuotedPowerShell(packageId);
  return (
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ` +
    `"$ErrorActionPreference = 'Stop'; choco uninstall ${id} -y --no-progress --limit-output; exit $LASTEXITCODE"`
  );
}

/**
 * Assemble a complete Win32 cart item from a Chocolatey catalog selection.
 * Throws on invalid input - callers should validate first and surface inline
 * errors; this acts as the final guard.
 */
export function buildChocolateyAppCartItem(input: ChocolateyAppInput): ChocolateyAppCartItem {
  const packageId = input.packageId.trim();
  const displayName = input.displayName.trim();
  const publisher = input.publisher.trim();
  const version = input.version.trim();

  if (!isValidChocolateyPackageId(packageId)) {
    throw new Error('Invalid Chocolatey package id');
  }
  if (!displayName || !publisher || !version) {
    throw new Error('Display name, publisher, and version are required');
  }

  // Chocolatey always installs machine-wide; there is no per-user mode.
  const installScope: WingetScope = 'machine';

  // A synthetic NormalizedInstaller just to drive generateDetectionRules()'s
  // registry-marker path (installer.type: 'chocolatey' hits its default case,
  // which uses the marker when wingetId + version are present - see
  // lib/detection-rules.ts). Never used to generate install commands.
  const installer: NormalizedInstaller = {
    architecture: 'x64',
    url: CHOCOLATEY_BOOTSTRAP_URL,
    sha256: '',
    type: 'chocolatey',
    scope: installScope,
  };

  const detectionRules = generateDetectionRules(installer, displayName, packageId, version);
  const installCommand = buildChocolateyInstallCommand(packageId, version);
  const uninstallCommand = buildChocolateyUninstallCommand(packageId);

  return {
    appSource: 'win32',
    sourceType: 'chocolatey',
    wingetId: packageId,
    displayName,
    publisher,
    description: input.description?.trim() || undefined,
    version,
    architecture: 'x64',
    installScope,
    installerType: 'chocolatey',
    installerUrl: CHOCOLATEY_BOOTSTRAP_URL,
    installerSha256: '',
    installCommand,
    uninstallCommand,
    detectionRules,
    iconPath: input.iconUrl?.trim() || undefined,
    psadtConfig: {
      ...DEFAULT_PSADT_CONFIG,
      detectionRules,
      installCommand,
      uninstallCommand,
    },
  };
}
