/**
 * Webhook Service
 * Handles webhook delivery with retry logic and circuit breaker pattern
 */

import { createHmac } from 'crypto';
import { promises as dns } from 'node:dns';
import net from 'node:net';
// Node's global fetch bundles its own internal undici build; passing a
// dispatcher created by the separately-installed undici package to it can
// throw ("invalid onRequestStart method") on a version mismatch between the
// two. Using undici's own fetch alongside its own Agent keeps both on the
// same build, so there's nothing to mismatch.
import { Agent, fetch as undiciFetch } from 'undici';
import type {
  WebhookConfiguration,
  NotificationPayload,
  WebhookTestPayload,
  WebhookType,
} from '@/types/notifications';
import {
  formatSlackMessage,
  formatTeamsMessage,
  formatDiscordMessage,
  formatCustomPayload,
  formatSlackTestMessage,
  formatTeamsTestMessage,
  formatDiscordTestMessage,
} from './formatters';

// Circuit breaker thresholds
const MAX_FAILURES = 5;
const CIRCUIT_BREAKER_RESET_MINUTES = 30;

export interface WebhookDeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  retryable?: boolean;
}

export interface WebhookDeliveryOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

const DEFAULT_OPTIONS: WebhookDeliveryOptions = {
  timeout: 10000, // 10 seconds
  retries: 3,
  retryDelay: 1000, // 1 second
};

/**
 * Check if webhook is in circuit breaker state
 */
export function isCircuitBreakerOpen(webhook: WebhookConfiguration): boolean {
  if (webhook.failure_count < MAX_FAILURES) {
    return false;
  }

  // Check if enough time has passed to retry
  if (webhook.last_failure_at) {
    const lastFailure = new Date(webhook.last_failure_at);
    const resetTime = new Date(lastFailure.getTime() + CIRCUIT_BREAKER_RESET_MINUTES * 60 * 1000);
    return new Date() < resetTime;
  }

  return true;
}

/**
 * Generate HMAC signature for webhook payload
 */
export function generateWebhookSignature(payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Format payload based on webhook type
 */
export function formatPayload(
  webhookType: WebhookType,
  payload: NotificationPayload
): unknown {
  switch (webhookType) {
    case 'slack':
      return formatSlackMessage(payload);
    case 'teams':
      return formatTeamsMessage(payload);
    case 'discord':
      return formatDiscordMessage(payload);
    case 'custom':
    default:
      return formatCustomPayload(payload);
  }
}

/**
 * Format test payload based on webhook type
 */
export function formatTestPayload(
  webhookType: WebhookType,
  webhookName: string
): unknown {
  const testPayload: WebhookTestPayload = {
    event: 'test',
    timestamp: new Date().toISOString(),
    message: 'This is a test notification from IntuneGet to verify your webhook configuration.',
    webhook_name: webhookName,
  };

  switch (webhookType) {
    case 'slack':
      return formatSlackTestMessage(testPayload);
    case 'teams':
      return formatTeamsTestMessage(testPayload);
    case 'discord':
      return formatDiscordTestMessage(testPayload);
    case 'custom':
    default:
      return { ...testPayload, data: testPayload };
  }
}

/**
 * Deliver webhook with retry logic
 */
export async function deliverWebhook(
  webhook: WebhookConfiguration,
  payload: NotificationPayload,
  options: WebhookDeliveryOptions = {}
): Promise<WebhookDeliveryResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Check circuit breaker
  if (isCircuitBreakerOpen(webhook)) {
    return {
      success: false,
      error: 'Circuit breaker is open due to repeated failures',
      retryable: false,
    };
  }

  // Re-validate at delivery time, not just at registration - the hostname
  // could have been repointed at an internal address since the webhook was
  // saved.
  const urlValidation = await validateWebhookUrl(webhook.url);
  if (!urlValidation.valid || !urlValidation.resolvedAddresses?.length) {
    return {
      success: false,
      error: urlValidation.error || 'Webhook URL failed validation',
      retryable: false,
    };
  }
  const dispatcher = createPinnedDispatcher(urlValidation.resolvedAddresses);

  // Format payload for webhook type
  const formattedPayload = formatPayload(webhook.webhook_type, payload);
  const payloadString = JSON.stringify(formattedPayload);

  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'IntuneGet-Webhook/1.0',
    ...webhook.headers,
  };

  // Add signature if secret is configured
  if (webhook.secret) {
    headers['X-Webhook-Signature'] = generateWebhookSignature(payloadString, webhook.secret);
  }

  // Attempt delivery with retries
  let lastError: string | undefined;
  let lastStatusCode: number | undefined;

  for (let attempt = 0; attempt <= (opts.retries || 0); attempt++) {
    if (attempt > 0) {
      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, opts.retryDelay));
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), opts.timeout);

      const response = await undiciFetch(webhook.url, {
        method: 'POST',
        headers,
        body: payloadString,
        signal: controller.signal,
        // Never follow redirects: the redirect target was never validated
        // against the private-IP checks above, so a malicious/compromised
        // webhook endpoint could otherwise redirect this server-side
        // request to an internal address after passing validation as a
        // normal public HTTPS URL. Confirmed via live testing that undici
        // (unlike the WHATWG fetch spec's opaqueredirect response) simply
        // returns the raw 3xx response without following it - so the actual
        // redirect target is never contacted, but the resulting response
        // must be classified by status code, not response.type.
        redirect: 'manual',
        dispatcher,
      });

      clearTimeout(timeoutId);

      if (response.status >= 300 && response.status < 400) {
        return {
          success: false,
          error: 'Webhook endpoint returned a redirect, which is not followed',
          retryable: false,
        };
      }

      lastStatusCode = response.status;

      if (response.ok) {
        return {
          success: true,
          statusCode: response.status,
        };
      }

      // Non-retryable errors
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        const errorText = await response.text().catch(() => 'Unknown error');
        return {
          success: false,
          statusCode: response.status,
          error: `HTTP ${response.status}: ${errorText.slice(0, 200)}`,
          retryable: false,
        };
      }

      // Retryable error (5xx or 429)
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          lastError = 'Request timed out';
        } else {
          lastError = error.message;
        }
      } else {
        lastError = 'Unknown error';
      }
    }
  }

  return {
    success: false,
    statusCode: lastStatusCode,
    error: lastError || 'Delivery failed after retries',
    retryable: true,
  };
}

/**
 * Send test webhook
 */
export async function sendTestWebhook(
  webhook: WebhookConfiguration
): Promise<WebhookDeliveryResult> {
  const urlValidation = await validateWebhookUrl(webhook.url);
  if (!urlValidation.valid || !urlValidation.resolvedAddresses?.length) {
    return {
      success: false,
      error: urlValidation.error || 'Webhook URL failed validation',
    };
  }
  const dispatcher = createPinnedDispatcher(urlValidation.resolvedAddresses);

  const formattedPayload = formatTestPayload(webhook.webhook_type, webhook.name);
  const payloadString = JSON.stringify(formattedPayload);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'IntuneGet-Webhook/1.0',
    ...webhook.headers,
  };

  if (webhook.secret) {
    headers['X-Webhook-Signature'] = generateWebhookSignature(payloadString, webhook.secret);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await undiciFetch(webhook.url, {
      method: 'POST',
      headers,
      body: payloadString,
      signal: controller.signal,
      // See deliverWebhook: never follow redirects, since the target was
      // never validated against the private-IP checks above.
      redirect: 'manual',
      dispatcher,
    });

    clearTimeout(timeoutId);

    if (response.status >= 300 && response.status < 400) {
      return {
        success: false,
        error: 'Webhook endpoint returned a redirect, which is not followed',
      };
    }

    if (response.ok) {
      return {
        success: true,
        statusCode: response.status,
      };
    }

    const errorText = await response.text().catch(() => 'Unknown error');
    return {
      success: false,
      statusCode: response.status,
      error: `HTTP ${response.status}: ${errorText.slice(0, 200)}`,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return {
          success: false,
          error: 'Request timed out',
        };
      }
      return {
        success: false,
        error: error.message,
      };
    }
    return {
      success: false,
      error: 'Unknown error',
    };
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  // Loopback, RFC1918 private ranges, link-local (incl. cloud metadata
  // endpoints at 169.254.169.254), CGNAT, and "this network".
  const ranges: Array<[string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
  ];
  const ipInt = ipv4ToInt(ip);
  return ranges.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipInt & mask) === (ipv4ToInt(base) & mask);
  });
}

function hextetsToIPv4(hi: number, lo: number): string {
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/**
 * Expands any valid textual IPv6 form (including "::" compression and a
 * trailing embedded dotted-quad, e.g. "::ffff:192.168.1.1" or
 * "64:ff9b::10.0.0.1") to 8 16-bit groups. Returns null if unparseable.
 */
function expandIPv6(ip: string): number[] | null {
  let addr = ip;

  let v4Hextets: number[] | null = null;
  const v4Match = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Match) {
    const octets = v4Match[1].split('.').map(Number);
    if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
      return null;
    }
    v4Hextets = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
    addr = addr.slice(0, addr.length - v4Match[1].length);
    if (addr.endsWith(':') && !addr.endsWith('::')) {
      addr = addr.slice(0, -1);
    }
  }

  const parts = addr.split('::');
  if (parts.length > 2) return null;

  const parseGroups = (s: string): number[] | null => {
    if (s === '') return [];
    const nums = s.split(':').map((g) => parseInt(g, 16));
    if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
    return nums;
  };

  const head = parseGroups(parts[0]);
  if (head === null) return null;
  let tail: number[] = [];
  if (parts.length === 2) {
    const parsedTail = parseGroups(parts[1]);
    if (parsedTail === null) return null;
    tail = parsedTail;
  }
  if (v4Hextets) tail = [...tail, ...v4Hextets];

  if (parts.length === 1) {
    return head.length === 8 ? head : null;
  }

  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  return [...head, ...Array(missing).fill(0), ...tail];
}

function isPrivateIPv6(ip: string): boolean {
  const h = expandIPv6(ip.toLowerCase());
  if (!h) return true; // fail closed on unparseable input

  if (h.every((g) => g === 0)) return true; // :: unspecified
  if (h.slice(0, 7).every((g) => g === 0) && h[7] === 1) return true; // ::1 loopback

  if ((h[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((h[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((h[0] & 0xffc0) === 0xfec0) return true; // deprecated site-local fec0::/10

  // IPv4-mapped ::ffff:a.b.c.d/96
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    return isPrivateIPv4(hextetsToIPv4(h[6], h[7]));
  }

  // Deprecated IPv4-compatible ::a.b.c.d/96 (excluding :: and ::1, handled above)
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
    return isPrivateIPv4(hextetsToIPv4(h[6], h[7]));
  }

  // NAT64 well-known prefix 64:ff9b::/96 (RFC 6052)
  if (h[0] === 0x0064 && h[1] === 0xff9b && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
    return isPrivateIPv4(hextetsToIPv4(h[6], h[7]));
  }

  // 6to4 2002::/16 - embeds the IPv4 address in the next 32 bits
  if (h[0] === 0x2002) {
    return isPrivateIPv4(hextetsToIPv4(h[1], h[2]));
  }

  return false;
}

/** Fails closed - an address in an unrecognized format is treated as private. */
function isPrivateAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true;
}

interface WebhookUrlValidation {
  valid: boolean;
  error?: string;
  /**
   * The exact IP(s) this validation pass approved for `hostname`. Callers
   * that go on to make the actual request MUST connect to one of these
   * addresses specifically (see createPinnedDispatcher) rather than letting
   * the HTTP client re-resolve the hostname itself - otherwise a DNS
   * response that changes between this lookup and the real connection
   * (DNS rebinding, achievable by an attacker who controls authoritative
   * DNS for the webhook's hostname with a TTL=0 answer) can redirect the
   * request to a private/internal address after validation passed.
   */
  resolvedAddresses?: string[];
}

/**
 * Validate a webhook URL before it's saved or delivered to.
 *
 * Beyond requiring HTTPS, this resolves the hostname and rejects anything
 * that points at a private/internal/loopback address - without this, any
 * authenticated user could register a webhook targeting an internal-only
 * service reachable from this server and trigger requests against it
 * on demand (via "Test webhook" or real notification delivery). DNS is
 * re-resolved on every delivery (see deliverWebhook/sendTestWebhook), not
 * just at registration time, since a hostname that resolved to a public IP
 * when the webhook was created could be repointed at an internal IP later.
 */
export async function validateWebhookUrl(url: string): Promise<WebhookUrlValidation> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'URL must use HTTPS' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    return { valid: false, error: 'Webhook URL cannot target a local/internal host' };
  }

  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      return { valid: false, error: 'Webhook URL cannot target a private/internal address' };
    }
    return { valid: true, resolvedAddresses: [hostname] };
  }

  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (records.length === 0 || records.some((r) => isPrivateAddress(r.address))) {
      return { valid: false, error: 'Webhook URL resolves to a private/internal address' };
    }
    return { valid: true, resolvedAddresses: records.map((r) => r.address) };
  } catch {
    return { valid: false, error: 'Could not resolve webhook host' };
  }
}

/**
 * Build an undici dispatcher that resolves DNS lookups for the request's
 * hostname to exactly the IP(s) validateWebhookUrl already approved,
 * ignoring whatever that hostname's live DNS record says by the time the
 * connection is actually made. This is what closes the DNS-rebinding gap -
 * TLS certificate/SNI verification is unaffected, since undici still uses
 * the request URL's own hostname for that; only the destination IP is pinned.
 */
export function createPinnedDispatcher(addresses: string[]): Agent {
  const family = net.isIP(addresses[0]) === 6 ? 6 : 4;
  return new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        if (options.all) {
          callback(null, addresses.map((address) => ({ address, family: (net.isIP(address) as 4 | 6) || family })));
        } else {
          callback(null, addresses[0], family);
        }
      },
    },
  });
}

/**
 * Detect webhook type from URL
 */
export function detectWebhookType(url: string): WebhookType | null {
  if (url.includes('hooks.slack.com')) {
    return 'slack';
  }
  if (url.includes('webhook.office.com') || url.includes('logic.azure.com')) {
    return 'teams';
  }
  if (url.includes('discord.com/api/webhooks')) {
    return 'discord';
  }
  return null;
}
