import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DepositStore } from '../src/store.js';
import type { DepositEvent } from '../src/types.js';

function mkDeposit(overrides: Partial<DepositEvent> = {}): DepositEvent {
  return {
    chain: 'ethereum',
    token: 'USDT',
    tokenAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    amountRaw: '1000000',
    amountFormatted: '1.000000',
    txHash: '0xabc',
    blockNumber: 100,
    logIndex: 5,
    timestamp: 0,
    ...overrides,
  };
}

let tmpDir: string;
let store: DepositStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'streamvault-test-'));
  store = new DepositStore(join(tmpDir, 'test.json'));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('DepositStore', () => {
  it('starts empty', () => {
    expect(store.count()).toBe(0);
  });

  it('inserts a batch', () => {
    const n = store.insertBatch([mkDeposit(), mkDeposit({ txHash: '0xdef' })]);
    expect(n).toBe(2);
    expect(store.count()).toBe(2);
  });

  it('is idempotent on (chain, txHash, logIndex)', () => {
    const d = mkDeposit();
    expect(store.insertBatch([d])).toBe(1);
    expect(store.insertBatch([d])).toBe(0);
    expect(store.count()).toBe(1);
  });

  it('inserts empty batch returns 0', () => {
    expect(store.insertBatch([])).toBe(0);
  });

  it('persists across reopen', () => {
    store.insertBatch([mkDeposit()]);
    store.close();
    const reopened = new DepositStore(join(tmpDir, 'test.json'));
    expect(reopened.count()).toBe(1);
    reopened.close();
  });

  it('updates confirmations and status', () => {
    store.insertBatch([mkDeposit({ blockNumber: 100 })]);
    store.updateConfirmations({ ethereum: 105 });
    const [row] = store.listAll();
    expect(row?.confirmations).toBe(5);
    expect(row?.status).toBe('pending');
  });

  it('marks confirmed after required confirmations', () => {
    store.insertBatch([mkDeposit({ blockNumber: 100 })]);
    store.updateConfirmations({ ethereum: 115 });
    const [row] = store.listAll();
    expect(row?.status).toBe('confirmed');
  });

  it('marks finalized after 2x required confirmations', () => {
    store.insertBatch([mkDeposit({ blockNumber: 100 })]);
    store.updateConfirmations({ ethereum: 200 });
    const [row] = store.listAll();
    expect(row?.status).toBe('finalized');
  });

  it('skips chains not in the head map', () => {
    store.insertBatch([mkDeposit({ blockNumber: 100 })]);
    store.updateConfirmations({ polygon: 5000 });
    const [row] = store.listAll();
    expect(row?.confirmations).toBe(0);
  });

  it('order is by block DESC, logIndex DESC', () => {
    store.insertBatch([
      mkDeposit({ txHash: '0xa', blockNumber: 100, logIndex: 1 }),
      mkDeposit({ txHash: '0xb', blockNumber: 101, logIndex: 2 }),
      mkDeposit({ txHash: '0xc', blockNumber: 101, logIndex: 5 }),
    ]);
    const rows = store.listAll();
    expect(rows.map((r) => r.txHash)).toEqual(['0xc', '0xb', '0xa']);
  });
});