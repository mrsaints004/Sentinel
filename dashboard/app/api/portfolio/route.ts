import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getWalletFromQuery } from "../../../lib/auth";
import { getVaultContract, getProvider, fetchPricesUSD, formatTokenBalance, fetchYieldsFromDeFiLlama } from "../../../lib/provider";

const VAULT_ABI = [
  "function getPortfolio() external view returns (address[], string[], uint256[], uint256[])",
  "function rebalanceCount() external view returns (uint256)",
  "function lastRebalanceTimestamp() external view returns (uint256)",
];

// Cache to avoid rate limiting on free RPC
let cachedResponse: { data: unknown; timestamp: number } | null = null;
const CACHE_TTL_MS = 30_000; // 30 seconds

export async function GET(request: Request) {
  const wallet = getWalletFromQuery(request);

  // Return cached data if fresh
  if (cachedResponse && Date.now() - cachedResponse.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cachedResponse.data);
  }

  // Always use the main vault — factory vaults are user-specific and often empty
  const vault = getVaultContract();

  if (!vault) {
    return NextResponse.json({
      totalValueUSD: 0, assets: [], blendedYield: 0, rebalanceCount: 0,
      lastRebalance: new Date().toISOString(), source: "no-contract",
    });
  }

  try {
    const [assets, names, balances, allocations] = await vault.getPortfolio();
    const rebalanceCount = await vault.rebalanceCount();
    const lastRebalanceTs = await vault.lastRebalanceTimestamp();

    // Fetch live data in parallel
    const [prices, liveApys] = await Promise.all([
      fetchPricesUSD(),
      fetchYieldsFromDeFiLlama(),
    ]);

    const assetData = (names as string[]).map((symbol: string, i: number) => {
      const balance = balances[i] as bigint;
      const allocBps = Number(allocations[i]);
      const price = prices[symbol] ?? 1.0;
      const balanceFloat = formatTokenBalance(balance, symbol);
      const balanceUSD = balanceFloat * price;
      const apy = liveApys[symbol] ?? 0;
      return {
        symbol,
        name: symbol === "USDY" ? "Ondo USDY" : symbol === "mETH" ? "Mantle Staked ETH" : "USD Coin",
        allocationBps: allocBps,
        balanceUSD: Math.round(balanceUSD * 100) / 100,
        apy: +apy.toFixed(2),
      };
    });

    const totalValueUSD = assetData.reduce((sum, a) => sum + a.balanceUSD, 0);
    const blendedYield = assetData.reduce((sum, a) => sum + (a.apy * a.allocationBps) / 10000, 0);

    const result = {
      totalValueUSD: Math.round(totalValueUSD * 100) / 100, assets: assetData,
      blendedYield: +blendedYield.toFixed(2), rebalanceCount: Number(rebalanceCount),
      lastRebalance: lastRebalanceTs > BigInt(0) ? new Date(Number(lastRebalanceTs) * 1000).toISOString() : new Date().toISOString(),
      source: "on-chain-mainnet",
    };
    cachedResponse = { data: result, timestamp: Date.now() };
    return NextResponse.json(result);
  } catch (error) {
    console.error("[API/portfolio] On-chain fetch failed:", error);
    return NextResponse.json({
      totalValueUSD: 0, assets: [], blendedYield: 0, rebalanceCount: 0,
      lastRebalance: new Date().toISOString(), source: "error",
    });
  }
}
