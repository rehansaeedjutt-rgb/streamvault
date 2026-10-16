import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DepositStore } from '../src/store.js';
import { reconcile } from '../src/reconcile.js';
import type { DepositEvent } from '../src/types.js';

function mkDeposit(o: Partial<DepositEvent> = {}): DepositEvent {
  return {
    chain: 'ethereum',
    token: 'USDT',
    tokenAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    from: '0x1',
    to: '0x2',
    amountRaw: '1000000',
    amountFormatted: '1.000000',
    txHash: '0xabc',
    blockNumber: 100,
    logIndex: 1,
    timestamp: 0,
    ...o,
  };
}

let tmpDir: string;
let store: DepositStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'streamvault-recon-'));
  store = new DepositStore(join(tmpDir, 'test.json'));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('reconcile', () => {
  it('returns empty for empty store', () => {
    expect(reconcile(store)).toEqual([]);
  });

  it('groups by chain and token', () => {
    store.insertBatch([
      mkDeposit({ txHash: '0xa', amountRaw: '1000000' }),
      mkDeposit({ txHash: '0xb', amountRaw: '2000000' }),
      mkDeposit({ txHash: '0xc', token: 'USDC', amountRaw: '500000' }),
    ]);
    const rows = reconcile(store);
    expect(rows.length).toBe(2);
    const usdt = rows.find((r) => r.token === 'USDT');
    expect(usdt?.count).toBe(2);
    expect(usdt?.total).toBe('3.000000');
    const usdc = rows.find((r) => r.token === 'USDC');
    expect(usdc?.count).toBe(1);
    expect(usdc?.total).toBe('0.500000');
  });

  it('counts statuses', () => {
    store.insertBatch([
      mkDeposit({ txHash: '0xa', blockNumber: 100 }),
      mkDeposit({ txHash: '0xb', blockNumber: 100 }),
    ]);
    store.updateConfirmations({ ethereum: 115 });
    const [row] = reconcile(store);
    expect(row?.confirmedCount).toBe(2);
    expect(row?.pendingCount).toBe(0);
  });

  it('filters by min block', () => {
    store.insertBatch([
      mkDeposit({ txHash: '0xa', blockNumber: 50 }),
      mkDeposit({ txHash: '0xb', blockNumber: 100 }),
    ]);
    const rows = reconcile(store, { ethereum: 80 });
    expect(rows[0]?.count).toBe(1);
  });
});