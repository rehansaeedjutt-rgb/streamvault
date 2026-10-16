/**
 * CLI entry point.
 *
 * Commands:
 *   scan       Scan a chain from a block range and store any deposits
 *   list       List all tracked deposits
 *   reconcile  Print a reconciliation summary
 */

import { createPublicClient, http } from 'viem';
import { CHAINS } from './chains.js';
import { reconcile } from './reconcile.js';
import { DepositStore } from './store.js';
import type { ChainId } from './types.js';
import { scanChain } from './watcher.js';

const DB_PATH = 'streamvault.json';

function usage(): never {
  console.log(`
streamvault — multi-chain stablecoin payment monitor

Usage:
  tsx src/main.ts scan <chain> --watch <addresses> [--blocks <n>]
  tsx src/main.ts list
  tsx src/main.ts reconcile

Chains: ethereum, polygon, base

Example:
  tsx src/main.ts scan ethereum --watch 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --blocks 50
`);
  process.exit(1);
}

async function headBlock(chain: ChainId): Promise<number> {
  const client = createPublicClient({
    transport: http(CHAINS[chain].rpcUrl, { timeout: 15_000 }),
  });
  const head = await client.getBlockNumber();
  return Number(head);
}

async function cmdScan(args: string[]): Promise<void> {
  const chain = args[0] as ChainId | undefined;
  if (!chain || !(chain in CHAINS)) {
    console.error(`Unknown or missing chain. Expected one of: ${Object.keys(CHAINS).join(', ')}`);
    process.exit(1);
  }

  const watchIdx = args.indexOf('--watch');
  const blocksIdx = args.indexOf('--blocks');
  const watchAddresses: string[] = [];
  if (watchIdx >= 0) {
    for (let i = watchIdx + 1; i < args.length; i++) {
      const a = args[i];
      if (!a || a.startsWith('--')) break;
      watchAddresses.push(a);
    }
  }
  const blockCount = blocksIdx >= 0 ? Number(args[blocksIdx + 1] ?? '50') : 50;

  if (watchAddresses.length === 0) {
    console.error('At least one --watch <address> is required');
    process.exit(1);
  }

  console.log(`Scanning ${CHAINS[chain].name} for stablecoin deposits...`);
  console.log(`Watching: ${watchAddresses.join(', ')}`);
  console.log(`Range: last ${blockCount} blocks\n`);

  const head = await headBlock(chain);
  const from = BigInt(Math.max(0, head - blockCount + 1));
  const to = BigInt(head);

  const result = await scanChain({
    chain,
    fromBlock: from,
    toBlock: to,
    watchAddresses,
  });

  console.log(`Scanned ${result.scannedBlocks} blocks`);
  console.log(`Found ${result.deposits.length} deposits`);
  if (result.errors.length) {
    console.log('Errors:');
    for (const e of result.errors) console.log(`  - ${e}`);
  }

  const store = new DepositStore(DB_PATH);
  try {
    const inserted = store.insertBatch(result.deposits);
    console.log(`Inserted ${inserted} new deposits into store`);

    // Update confirmations using current head.
    store.updateConfirmations({ [chain]: head });
    console.log(`Total deposits tracked: ${store.count()}`);
  } finally {
    store.close();
  }
}

function cmdList(): void {
  const store = new DepositStore(DB_PATH);
  try {
    const rows = store.listAll();
    if (rows.length === 0) {
      console.log('No deposits tracked. Run `scan` first.');
      return;
    }
    console.log(
      `${'chain'.padEnd(10)} ${'token'.padEnd(6)} ${'amount'.padEnd(15)} ${'status'.padEnd(10)} ${'confirm'.padEnd(10)} txhash`,
    );
    console.log('-'.repeat(100));
    for (const d of rows) {
      const short = d.txHash.slice(0, 12) + '...';
      console.log(
        `${d.chain.padEnd(10)} ${d.token.padEnd(6)} ${d.amountFormatted.padEnd(15)} ${d.status.padEnd(10)} ${String(d.confirmations).padEnd(10)} ${short}`,
      );
    }
    console.log(`\nTotal: ${rows.length} deposits`);
  } finally {
    store.close();
  }
}

function cmdReconcile(): void {
  const store = new DepositStore(DB_PATH);
  try {
    const rows = reconcile(store);
    if (rows.length === 0) {
      console.log('Nothing to reconcile.');
      return;
    }
    console.log(
      `${'chain'.padEnd(10)} ${'token'.padEnd(6)} ${'count'.padEnd(8)} ${'total'.padEnd(20)} pending/confirmed/finalized`,
    );
    console.log('-'.repeat(80));
    for (const r of rows) {
      console.log(
        `${r.chain.padEnd(10)} ${r.token.padEnd(6)} ${String(r.count).padEnd(8)} ${r.total.padEnd(20)} ${r.pendingCount}/${r.confirmedCount}/${r.finalizedCount}`,
      );
    }
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd) usage();

  switch (cmd) {
    case 'scan':
      await cmdScan(rest);
      break;
    case 'list':
      cmdList();
      break;
    case 'reconcile':
      cmdReconcile();
      break;
    default:
      usage();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});