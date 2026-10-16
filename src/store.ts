/**
 * Deposit persistence using a single JSON file with atomic writes.
 *
 * Why not SQLite: Node 22.5+ ships a built-in `node:sqlite`, but Vite's
 * module resolver does not recognise it yet and refuses to bundle tests
 * that import it. The alternative (better-sqlite3) needs a C++ compiler
 * on the machine. Neither tradeoff is worth it for a demo.
 *
 * Design: a single JSON file with atomic replace-on-write. Enough for
 * the volumes this demo handles (thousands of deposits). A production
 * payment processor would use Postgres or MySQL — the interface here
 * (insertBatch / updateConfirmations / listAll) is what would port.
 *
 * Idempotency: (chain, txHash, logIndex) is the composite key. Replaying
 * a block range is safe.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { DepositEvent, DepositStatus, TrackedDeposit } from './types.js';

interface StoreState {
  deposits: TrackedDeposit[];
}

// Per-chain confirmation thresholds. Matches chains.ts but duplicated
// here to avoid a circular dependency.
const CONFIRMATIONS_REQUIRED: Record<string, number> = {
  ethereum: 12,
  polygon: 128,
  base: 12,
};

function key(d: { chain: string; txHash: string; logIndex: number }): string {
  return `${d.chain}:${d.txHash.toLowerCase()}:${d.logIndex}`;
}

export class DepositStore {
  private readonly path: string;
  private state: StoreState;

  constructor(dbPath: string) {
    this.path = dbPath;
    mkdirSync(dirname(this.path), { recursive: true });
    this.state = this.load();
  }

  private load(): StoreState {
    if (!existsSync(this.path)) {
      return { deposits: [] };
    }
    try {
      const raw = readFileSync(this.path, 'utf-8');
      return JSON.parse(raw) as StoreState;
    } catch {
      return { deposits: [] };
    }
  }

  private persist(): void {
    // Atomic write: write to a temp file, then rename. Rename is atomic
    // on POSIX and on Windows when the target is on the same volume.
    const tmp = join(dirname(this.path), `.${Date.now()}.tmp`);
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf-8');
    renameSync(tmp, this.path);
  }

  insertBatch(deposits: readonly DepositEvent[]): number {
    if (deposits.length === 0) return 0;
    const existing = new Set(this.state.deposits.map((d) => key(d)));

    let inserted = 0;
    for (const d of deposits) {
      const k = key(d);
      if (existing.has(k)) continue;
      existing.add(k);
      const tracked: TrackedDeposit = {
        ...d,
        status: 'pending',
        confirmations: 0,
        confirmationsRequired: CONFIRMATIONS_REQUIRED[d.chain] ?? 12,
      };
      this.state.deposits.push(tracked);
      inserted++;
    }

    if (inserted > 0) this.persist();
    return inserted;
  }

  updateConfirmations(headByChain: Readonly<Record<string, number>>): void {
    let changed = false;

    for (let i = 0; i < this.state.deposits.length; i++) {
      const d = this.state.deposits[i];
      if (!d) continue;
      if (d.status === 'finalized') continue;

      const head = headByChain[d.chain];
      if (head === undefined) continue;

      const confirmations = head - d.blockNumber;
      const status = this.statusFor(d.chain, confirmations);

      if (d.confirmations !== confirmations || d.status !== status) {
        this.state.deposits[i] = { ...d, confirmations, status };
        changed = true;
      }
    }

    if (changed) this.persist();
  }

  private statusFor(chain: string, confirmations: number): DepositStatus {
    const r = CONFIRMATIONS_REQUIRED[chain] ?? 12;
    if (confirmations >= r * 2) return 'finalized';
    if (confirmations >= r) return 'confirmed';
    return 'pending';
  }

  listAll(): TrackedDeposit[] {
    return [...this.state.deposits].sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return b.blockNumber - a.blockNumber;
      return b.logIndex - a.logIndex;
    });
  }

  count(): number {
    return this.state.deposits.length;
  }

  close(): void {
    // Nothing to release — the file writes are synchronous and atomic.
    // Kept in the interface so a future SQLite/Postgres backend can
    // override.
  }
}