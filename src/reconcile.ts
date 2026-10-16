/**
 * Reconciliation: totals per (chain, token) for a time window.
 *
 * Because the store does not track block timestamps yet, "window" is
 * defined by block range. This is the honest version: it reports what
 * the data actually supports.
 */

import type { DepositStore } from './store.js';
import type { TrackedDeposit } from './types.js';

export interface ReconcileRow {
  readonly chain: string;
  readonly token: string;
  readonly count: number;
  readonly total: string;
  readonly pendingCount: number;
  readonly confirmedCount: number;
  readonly finalizedCount: number;
}

export function reconcile(
  store: DepositStore,
  minBlockByChain: Readonly<Record<string, number>> = {},
): ReconcileRow[] {
  const rows = store.listAll();
  const grouped = new Map<string, TrackedDeposit[]>();

  for (const d of rows) {
    const min = minBlockByChain[d.chain];
    if (min !== undefined && d.blockNumber < min) continue;
    const key = `${d.chain}|${d.token}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(d);
    grouped.set(key, bucket);
  }

  const out: ReconcileRow[] = [];
  for (const [key, bucket] of grouped) {
    const [chain, token] = key.split('|');
    if (!chain || !token) continue;

    // Sum amounts as bigint on the raw value, then format.
    // All stablecoins in this project have 6 decimals.
    let totalRaw = 0n;
    for (const d of bucket) totalRaw += BigInt(d.amountRaw);
    const divisor = 10n ** 6n;
    const whole = totalRaw / divisor;
    const frac = totalRaw % divisor;
    const total = `${whole}.${frac.toString().padStart(6, '0')}`;

    out.push({
      chain,
      token,
      count: bucket.length,
      total,
      pendingCount: bucket.filter((d) => d.status === 'pending').length,
      confirmedCount: bucket.filter((d) => d.status === 'confirmed').length,
      finalizedCount: bucket.filter((d) => d.status === 'finalized').length,
    });
  }

  return out.sort((a, b) => (a.chain < b.chain ? -1 : a.chain > b.chain ? 1 : 0));
}