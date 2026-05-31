import { ethers } from "ethers";

const RPC_URL = process.env.MANTLE_RPC || "https://rpc.mantle.xyz";
const VAULT_ADDRESS = process.env.NEXT_PUBLIC_VAULT_ADDRESS || process.env.VAULT_ADDRESS || "";
const LOGGER_ADDRESS = process.env.NEXT_PUBLIC_LOGGER_ADDRESS || process.env.LOGGER_ADDRESS || "";
const IDENTITY_ADDRESS = process.env.NEXT_PUBLIC_IDENTITY_ADDRESS || process.env.IDENTITY_ADDRESS || "";

// Real token decimals on Mantle Mainnet
export const TOKEN_DECIMALS: Record<string, number> = {
  USDY: 18,
  mETH: 18,
  USDC: 6,
};

// Shared provider instance (Mantle Mainnet)
let _provider: ethers.JsonRpcProvider | null = null;

export function getProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(RPC_URL);
  }
  return _provider;
}

// Contract ABIs (minimal for reading)
const VAULT_ABI = [
  "function getPortfolio() external view returns (address[], string[], uint256[], uint256[])",
  "function rebalanceCount() external view returns (uint256)",
  "function lastRebalanceTimestamp() external view returns (uint256)",
  "function swapRouter() external view returns (address)",
];

const LOGGER_ABI = [
  "function decisionCount() external view returns (uint256)",
  "function getRecentDecisions(uint256 count) external view returns (tuple(uint256 id, address agent, string reasoning, string action, uint256[] oldAllocations, uint256[] newAllocations, string[] assetNames, uint256 timestamp, uint256 portfolioValueUSD, string riskLevel)[])",
];

const IDENTITY_ABI = [
  "function agentToToken(address) external view returns (uint256)",
  "function getAgentMetadata(uint256 tokenId) external view returns (tuple(string agentName, string strategyType, uint256 totalDecisions, int256 cumulativeROIBps, uint256 createdAt, uint256 lastActiveAt, address vaultAddress, address loggerAddress))",
];

export function getVaultContract(): ethers.Contract | null {
  if (!VAULT_ADDRESS) return null;
  return new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, getProvider());
}

export function getLoggerContract(): ethers.Contract | null {
  if (!LOGGER_ADDRESS) return null;
  return new ethers.Contract(LOGGER_ADDRESS, LOGGER_ABI, getProvider());
}

export function getIdentityContract(): ethers.Contract | null {
  if (!IDENTITY_ADDRESS) return null;
  return new ethers.Contract(IDENTITY_ADDRESS, IDENTITY_ABI, getProvider());
}

// Fetch live prices from CoinGecko
export async function fetchPricesUSD(): Promise<Record<string, number>> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=mantle-staked-ether,ondo-us-dollar-yield,usd-coin&vs_currencies=usd&include_24hr_change=true",
      { next: { revalidate: 60 } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      USDY: data["ondo-us-dollar-yield"]?.usd ?? 1.05,
      mETH: data["mantle-staked-ether"]?.usd ?? 2500,
      USDC: data["usd-coin"]?.usd ?? 1.0,
      USDY_change: data["ondo-us-dollar-yield"]?.usd_24h_change ?? 0,
      mETH_change: data["mantle-staked-ether"]?.usd_24h_change ?? 0,
      USDC_change: data["usd-coin"]?.usd_24h_change ?? 0,
    };
  } catch {
    return { USDY: 1.05, mETH: 2500, USDC: 1.0, USDY_change: 0, mETH_change: 0, USDC_change: 0 };
  }
}

// Format token balance based on actual decimals
export function formatTokenBalance(balance: bigint, symbol: string): number {
  const decimals = TOKEN_DECIMALS[symbol] || 18;
  return parseFloat(ethers.formatUnits(balance, decimals));
}

export { VAULT_ADDRESS, LOGGER_ADDRESS, IDENTITY_ADDRESS };
