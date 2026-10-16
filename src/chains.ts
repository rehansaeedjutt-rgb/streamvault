/**
 * Chain and stablecoin configuration.
 *
 * Addresses are mainnet. Public RPCs only — no API key required. The
 * polygon + base public endpoints are less reliable than ethereum's, so
 * production should swap these for Alchemy/Infura/QuickNode.
 */

import type { ChainConfig, ChainId, StablecoinConfig } from './types.js';

const USDT_ETHEREUM: StablecoinConfig = {
  symbol: 'USDT',
  address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  decimals: 6,
};

const USDC_ETHEREUM: StablecoinConfig = {
  symbol: 'USDC',
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  decimals: 6,
};

const USDT_POLYGON: StablecoinConfig = {
  symbol: 'USDT',
  address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  decimals: 6,
};

const USDC_POLYGON: StablecoinConfig = {
  symbol: 'USDC',
  address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  decimals: 6,
};

const USDT_BASE: StablecoinConfig = {
  symbol: 'USDT',
  address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
  decimals: 6,
};

const USDC_BASE: StablecoinConfig = {
  symbol: 'USDC',
  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  decimals: 6,
};

export const CHAINS: Readonly<Record<ChainId, ChainConfig>> = {
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    chainId: 1,
    rpcUrl: 'https://ethereum-rpc.publicnode.com',
    explorerUrl: 'https://etherscan.io',
    confirmationsRequired: 12,
    stablecoins: [USDT_ETHEREUM, USDC_ETHEREUM],
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon',
    chainId: 137,
    rpcUrl: 'https://polygon-bor-rpc.publicnode.com',
    explorerUrl: 'https://polygonscan.com',
    confirmationsRequired: 128, // polygon has more reorgs
    stablecoins: [USDT_POLYGON, USDC_POLYGON],
  },
  base: {
    id: 'base',
    name: 'Base',
    chainId: 8453,
    rpcUrl: 'https://base-rpc.publicnode.com',
    explorerUrl: 'https://basescan.org',
    confirmationsRequired: 12,
    stablecoins: [USDT_BASE, USDC_BASE],
  },
};

// ERC-20 Transfer event signature: keccak256("Transfer(address,address,uint256)")
export const TRANSFER_EVENT_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';