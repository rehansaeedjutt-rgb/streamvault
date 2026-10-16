/**
 * Core types for stablecoin payment monitoring.
 */

export interface ChainConfig {
  readonly id: ChainId;
  readonly name: string;
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly explorerUrl: string;
  readonly confirmationsRequired: number;
  readonly stablecoins: readonly StablecoinConfig[];
}

export interface StablecoinConfig {
  readonly symbol: 'USDT' | 'USDC';
  readonly address: string;
  readonly decimals: number;
}

export type ChainId = 'ethereum' | 'polygon' | 'base';

export interface DepositEvent {
  readonly chain: ChainId;
  readonly token: 'USDT' | 'USDC';
  readonly tokenAddress: string;
  readonly from: string;
  readonly to: string;
  readonly amountRaw: string;
  readonly amountFormatted: string;
  readonly txHash: string;
  readonly blockNumber: number;
  readonly logIndex: number;
  readonly timestamp: number;
}

export type DepositStatus = 'pending' | 'confirmed' | 'finalized';

export interface TrackedDeposit extends DepositEvent {
  readonly status: DepositStatus;
  readonly confirmations: number;
  readonly confirmationsRequired: number;
}