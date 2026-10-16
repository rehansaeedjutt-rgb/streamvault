/**
 * Block scanner. For each configured chain, fetch Transfer logs from
 * the token contracts where the recipient is one of the watched addresses.
 *
 * Design:
 *   - One scan per chain per invocation. The caller decides how far back
 *     to scan (fromBlock, toBlock).
 *   - Uses viem's typed getLogs with the event ABI + args filter. The RPC
 *     does the filtering server-side via topics.
 *   - No subscription. A bounded scan is what a payment processor actually
 *     runs every few seconds from the last scanned block.
 */

import {
  createPublicClient,
  http,
  parseAbiItem,
  type Address,
  type Log,
} from 'viem';
import { CHAINS } from './chains.js';
import type { ChainId, DepositEvent } from './types.js';

// Event signature. Viem uses this to build the topic filter automatically.
const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
);

export interface ScanOptions {
  readonly chain: ChainId;
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  readonly watchAddresses: readonly string[];
}

export interface ScanResult {
  readonly chain: ChainId;
  readonly scannedBlocks: number;
  readonly deposits: readonly DepositEvent[];
  readonly errors: readonly string[];
}

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

/** Convert a 32-byte topic to a lowercase 20-byte address. */
function topicToAddress(topic: string): string {
  const clean = topic.startsWith('0x') ? topic.slice(2) : topic;
  return '0x' + clean.slice(24).toLowerCase();
}

export async function scanChain(opts: ScanOptions): Promise<ScanResult> {
  const config = CHAINS[opts.chain];
  const errors: string[] = [];
  const deposits: DepositEvent[] = [];

  const client = createPublicClient({
    transport: http(config.rpcUrl, { timeout: 20_000 }),
  });

  if (opts.watchAddresses.length === 0) {
    return { chain: opts.chain, scannedBlocks: 0, deposits: [], errors: [] };
  }

  const tokenAddresses = config.stablecoins.map((s) => s.address as Address);
  const normalizedWatch = opts.watchAddresses.map(normalizeAddress);

  try {
    // Two-step: fetch all Transfer logs for the token contracts in the
    // block range, then filter by `to` locally. Viem v2's typed getLogs
    // with a `to` array filter is not reliably supported across all
    // public RPCs, so we do the recipient filter in JS. For a payment
    // processor at production scale this would be replaced with a
    // server-side filter or a dedicated indexer.
    const logs: Log[] = await client.getLogs({
      address: tokenAddresses,
      event: TRANSFER_EVENT,
      fromBlock: opts.fromBlock,
      toBlock: opts.toBlock,
    });

    for (const log of logs) {
      const parsed = decodeLog(log, opts.chain);
      if (!parsed) continue;
      if (!normalizedWatch.includes(parsed.to)) continue;
      deposits.push(parsed);
    }
  } catch (err) {
    errors.push(`RPC error on ${opts.chain}: ${String(err)}`);
  }

  const scanned = Number(opts.toBlock - opts.fromBlock + 1n);

  return {
    chain: opts.chain,
    scannedBlocks: scanned,
    deposits,
    errors,
  };
}

function decodeLog(log: Log, chain: ChainId): DepositEvent | null {
  if (!log.topics || log.topics.length < 3) return null;
  if (!log.data || !log.transactionHash) return null;
  if (log.blockNumber === null || log.blockNumber === undefined) return null;

  const fromTopic = log.topics[1];
  const toTopic = log.topics[2];
  if (!fromTopic || !toTopic) return null;

  const from = topicToAddress(fromTopic);
  const to = topicToAddress(toTopic);

  let amountRaw: bigint;
  try {
    amountRaw = BigInt(log.data);
  } catch {
    return null;
  }

  const tokenAddress = (log.address || '').toLowerCase();
  const token = CHAINS[chain].stablecoins.find(
    (s) => s.address.toLowerCase() === tokenAddress,
  );
  if (!token) return null;

  const divisor = 10n ** BigInt(token.decimals);
  const whole = amountRaw / divisor;
  const frac = amountRaw % divisor;
  const amountFormatted = `${whole}.${frac.toString().padStart(token.decimals, '0')}`;

  return {
    chain,
    token: token.symbol,
    tokenAddress: token.address,
    from,
    to,
    amountRaw: amountRaw.toString(),
    amountFormatted,
    txHash: log.transactionHash,
    blockNumber: Number(log.blockNumber),
    logIndex: Number(log.logIndex ?? 0),
    timestamp: 0,
  };
}