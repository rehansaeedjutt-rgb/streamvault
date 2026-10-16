/**
 * Webhook delivery.
 *
 * POSTs deposit events to a configured URL. Retries on 5xx and network
 * errors with exponential backoff. Does not retry on 4xx (client error).
 *
 * No queue, no persistence of failed deliveries. A production system
 * would use a durable outbox table + a worker. That is a separate
 * project, and the interface here would survive that refactor.
 */

import type { TrackedDeposit } from './types.js';

export interface WebhookConfig {
  readonly url: string;
  readonly maxRetries: number;
  readonly baseDelayMs: number;
}

export interface WebhookResult {
  readonly ok: boolean;
  readonly status: number | null;
  readonly attempts: number;
  readonly error: string | null;
}

export async function deliverDeposit(
  deposit: TrackedDeposit,
  config: WebhookConfig,
): Promise<WebhookResult> {
  let lastError: string | null = null;
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      const res = await fetch(config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'deposit.received',
          chain: deposit.chain,
          token: deposit.token,
          from: deposit.from,
          to: deposit.to,
          amount: deposit.amountFormatted,
          amountRaw: deposit.amountRaw,
          txHash: deposit.txHash,
          blockNumber: deposit.blockNumber,
          confirmations: deposit.confirmations,
          status: deposit.status,
        }),
      });
      lastStatus = res.status;

      if (res.status >= 200 && res.status < 300) {
        return { ok: true, status: res.status, attempts: attempt, error: null };
      }

      // 4xx is a client problem — do not retry.
      if (res.status >= 400 && res.status < 500) {
        return {
          ok: false,
          status: res.status,
          attempts: attempt,
          error: `HTTP ${res.status}`,
        };
      }

      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = String(err);
    }

    if (attempt < config.maxRetries) {
      const delay = config.baseDelayMs * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return {
    ok: false,
    status: lastStatus,
    attempts: config.maxRetries,
    error: lastError ?? 'unknown',
  };
}