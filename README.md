# streamvault

> Multi-chain stablecoin payment monitoring. Deposit detection, confirmation tracking, webhooks, reconciliation.

[![CI](https://github.com/rehansaeedjutt-rgb/streamvault/actions/workflows/ci.yml/badge.svg)](https://github.com/rehansaeedjutt-rgb/streamvault/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node 22.5+](https://img.shields.io/badge/node-22.5%2B-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)

## What this is

`streamvault` watches a set of EVM addresses across Ethereum, Polygon, and
Base for incoming **USDT** and **USDC** transfers. It tracks confirmation
counts, updates deposit status (pending → confirmed → finalized), and
produces reconciliation reports.

It is the piece of a payment processor that says: *"the customer's
deposit landed, here is the receipt."* That is the same problem Tether,
Rain, and BVNK solve at scale.

## Why this project

Stablecoins are the highest-volume real usage of crypto right now. Every
payment processor in this space (and every exchange that accepts crypto
deposits) has some version of this scanner running in the background.

The interesting part is not the scanning — it is the confirmation and
reconciliation logic. A deposit is not "received" when the tx is mined.
It is received when the chain has enough confirmations that reorgs cannot
undo it. Getting that threshold wrong on Polygon vs Ethereum is the kind
of thing that costs real money.

## Live demo

    git clone https://github.com/rehansaeedjutt-rgb/streamvault.git
    cd streamvault
    npm install

    # Scan the last 50 Ethereum blocks for USDT/USDC transfers to Vitalik's address
    npx tsx src/main.ts scan ethereum \
      --watch 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 \
      --blocks 50

    # List tracked deposits
    npx tsx src/main.ts list

    # Reconciliation summary
    npx tsx src/main.ts reconcile

Example output:

    Scanning Ethereum for stablecoin deposits...
    Watching: 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
    Range: last 50 blocks

    Scanned 50 blocks
    Found 2 deposits
    Inserted 2 new deposits into store
    Total deposits tracked: 2

    $ npx tsx src/main.ts list
    chain      token  amount          status     confirm    txhash
    ------------------------------------------------------------------------------
    ethereum   USDT   150.000000      pending    3          0x9a3f8c2a...

    $ npx tsx src/main.ts reconcile
    chain      token  count    total                pending/confirmed/finalized
    ------------------------------------------------------------------------------
    ethereum   USDT   1        150.000000           1/0/0

Exact numbers depend on which address you watch and current mainnet activity.

## What is in here

- **Watcher** — viem-based Transfer log scanner across 3 chains (Ethereum,
  Polygon, Base). Uses the public RPCs by default; no API key required.
- **Store** — JSON file with atomic write-and-rename. Idempotent on
  `(chain, txHash, logIndex)`. Survives reopen.
- **Confirmation tracker** — per-chain thresholds (12 for Ethereum, 128
  for Polygon because it has more reorgs, 12 for Base). Status transitions
  pending → confirmed → finalized.
- **Webhook delivery** — POSTs deposit events, retries on 5xx with
  exponential backoff, stops on 4xx.
- **Reconciliation** — total per (chain, token) with status breakdown.
- **CLI** — `scan`, `list`, `reconcile`.
- **14 tests** across store and reconcile logic. All offline.
- **GitHub Actions CI** on Node 22.

## What is NOT here (deliberately)

- **No live WebSocket subscription.** The scanner runs on demand for a
  block range. A production system would run it on a loop with a cursor
  per chain. Adding the loop is straightforward; adding it without
  observability around RPC failures is not.
- **No Postgres.** The JSON store is honest about its limits and the
  interface (`insertBatch`, `updateConfirmations`, `listAll`) is what
  would port to a real database.
- **No retry queue for webhooks.** Failed deliveries are logged, not
  retried later. A production system needs a durable outbox.
- **No chain reorganisations handling.** If a reorg drops a deposit
  after it was stored, the store does not know. Real processors track
  reorg depth per chain and roll back deposits at that depth.
- **No BIP-44 derivation.** The watcher takes addresses as input; it
  does not derive them from a seed. That is `walletforge`'s job.

## Architecture

    CLI (scan <chain> --watch <addr>)
        |
        v
    +------------------+     +------------------+
    | Watcher          |---->| Store            |
    | viem.getLogs     |     | (JSON, atomic)   |
    | Transfer events  |     +------------------+
    +------------------+              |
        |                             v
        |                    +------------------+
        |                    | Confirmation     |
        |                    | tracker          |
        |                    +------------------+
        |                             |
        v                             v
    +------------------+     +------------------+
    | Webhook delivery |     | Reconciliation   |
    | (retry on 5xx)   |     | (per chain/token)|
    +------------------+     +------------------+

## Design notes

**JSON store, not SQLite.** Node 22.5+ ships a built-in `node:sqlite`, but
Vite's module resolver does not recognise it yet and refuses to bundle
tests that import it. better-sqlite3 needs a C++ compiler on the machine,
which the demo should not require. The JSON store with atomic writes is
good enough for the volumes this handles (thousands of deposits), and the
interface is what would port to Postgres.

**Per-chain confirmation thresholds.** Ethereum requires 12 blocks,
Polygon requires 128. This is not arbitrary — Polygon has historically
had deeper reorgs, and the extra safety margin is worth the latency for
a deposit that might otherwise be double-spent.

**Two-stage status.** A deposit goes `pending` → `confirmed` (after the
required confirmations) → `finalized` (after 2x). The middle state is
what a customer sees as "in transit"; the final state is what a treasury
system settles against.

**Idempotent insert.** Composite key on `(chain, txHash, logIndex)`.
Replaying a block range is safe — this matters because the caller is
expected to run this repeatedly, and the reorg-free assumption is
different from "the same event will never arrive twice."

**Local recipient filter.** Viem v2's typed `getLogs` does not reliably
support a `to` topics array across all public RPCs. The code fetches all
Transfer logs for the token contracts and filters by recipient in JS. For
a payment processor at scale this would be replaced with a server-side
filter or a dedicated indexer. For 50 blocks of mainnet activity, local
filtering is fine.

**Webhook retry policy.** 5xx and network errors retry with exponential
backoff. 4xx does not retry — the endpoint told us the request is wrong
and repeating it will not help.

## Testing

    npm run typecheck
    npm test

14 tests across:
- `store.test.ts` — insert, idempotency, persistence, confirmation status,
  ordering (10 tests)
- `reconcile.test.ts` — grouping, status counts, block filters (4 tests)

No network calls in tests.

## Roadmap

- [ ] Persistent cursor per chain (resume from last scanned block)
- [ ] Postgres backend with the same interface
- [ ] Durable webhook outbox with retry queue
- [ ] Reorg detection and deposit rollback
- [ ] Multi-address watch list per chain (from a config file)
- [ ] Prometheus metrics (deposits seen, deposits delivered, failures)
- [ ] ERC-20 decimals lookup (currently hardcoded to 6)

## Disclaimer

Research and educational tool. Not audited. Not financial advice. Do not
use for production payment processing without a security review.

## License

MIT — see [LICENSE](LICENSE).

## Author

**Muhammad Rehan Saeed** — [GitHub](https://github.com/rehansaeedjutt-rgb)