import { execSync } from "child_process";

/**
 * Byreal CLI Integration - Real Solana CLMM DEX Intelligence
 *
 * Uses @byreal-io/byreal-cli to fetch real pool data from Byreal DEX.
 * Provides cross-chain yield intelligence for the Mantle Treasury Agent.
 */

export interface ByrealPool {
  id: string;
  pair: string;
  tokenA: string;
  tokenB: string;
  tvl: number;
  volume24h: number;
  apy: number;
  feeRate: number;
  totalApr: number;
}

export interface ByrealPoolAnalysis {
  pool: string;
  pair: string;
  currentPrice: number;
  tvl: number;
  feeApy: number;
  rewardApr: number;
  totalApr: number;
  volume24h: number;
  priceChange24h: number;
}

export interface ByrealOverview {
  totalPools: number;
  totalTvl: number;
  totalVolume24h: number;
  topPairs: string[];
}

function runByreal(command: string): any {
  try {
    const result = execSync(
      `npx @byreal-io/byreal-cli ${command} -o json --non-interactive`,
      {
        encoding: "utf-8",
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
        cwd: process.cwd(),
      }
    );
    // Parse JSON output - may have banner text before JSON
    const jsonStart = result.indexOf("{");
    if (jsonStart === -1) return null;
    return JSON.parse(result.slice(jsonStart));
  } catch (error: any) {
    // Try parsing stdout even on error
    const stdout = error.stdout || "";
    const jsonStart = stdout.indexOf("{");
    if (jsonStart >= 0) {
      try { return JSON.parse(stdout.slice(jsonStart)); } catch {}
    }
    console.warn(`[Byreal] CLI call failed: ${error.message?.slice(0, 100)}`);
    return null;
  }
}

/**
 * Get top pools from Byreal DEX (real Solana CLMM data)
 */
export function getTopPools(limit: number = 10): ByrealPool[] {
  const result = runByreal("pools");

  if (result?.success && result.data?.pools) {
    const pools = result.data.pools.slice(0, limit);
    return pools.map((p: any) => ({
      id: p.id,
      pair: p.pair,
      tokenA: p.token_a?.symbol || "?",
      tokenB: p.token_b?.symbol || "?",
      tvl: p.tvl_usd || 0,
      volume24h: p.volume_24h_usd || 0,
      apy: (p.total_apr || 0) * 100, // convert to percentage
      feeRate: p.fee_rate_bps || 0,
      totalApr: p.total_apr || 0,
    }));
  }

  console.warn("[Byreal] Failed to fetch pools, returning empty");
  return [];
}

/**
 * Analyze a specific pool
 */
export function analyzePool(poolId: string): ByrealPoolAnalysis | null {
  const result = runByreal("pools");

  if (result?.success && result.data?.pools) {
    const pool = result.data.pools.find((p: any) => p.id === poolId || p.pair === poolId);
    if (pool) {
      return {
        pool: pool.id,
        pair: pool.pair,
        currentPrice: pool.current_price || 0,
        tvl: pool.tvl_usd || 0,
        feeApy: (pool.apr || 0) * 100,
        rewardApr: (pool.reward_apr || 0) * 100,
        totalApr: (pool.total_apr || 0) * 100,
        volume24h: pool.volume_24h_usd || 0,
        priceChange24h: pool.price_change_24h || 0,
      };
    }
  }
  return null;
}

/**
 * Get DEX overview stats
 */
export function getOverview(): ByrealOverview | null {
  const result = runByreal("overview");

  if (result?.success && result.data) {
    return {
      totalPools: result.data.total_pools || result.data.pools_count || 0,
      totalTvl: result.data.total_tvl_usd || result.data.tvl || 0,
      totalVolume24h: result.data.total_volume_24h_usd || result.data.volume_24h || 0,
      topPairs: result.data.top_pairs || [],
    };
  }
  return null;
}

/**
 * Get cross-chain yield comparison for the agent
 * Compares real Solana CLMM yields with Mantle yields
 */
/**
 * Cross-chain yield signal for direct use in allocation decisions.
 * Returns a concrete signal the portfolio manager can act on without AI.
 */
export interface CrossChainYieldSignal {
  signal: "solana_outperforming" | "mantle_competitive" | "no_data";
  /** How much Solana stable yields exceed Mantle RWA yields (percentage points) */
  yieldGapPct: number;
  /** Recommended adjustment to stablecoin allocation (bps): positive = increase stables */
  stableAdjustmentBps: number;
  /** Top Solana stable pool APY */
  solanaStableApy: number;
  /** Average Mantle RWA yield (USDY baseline) */
  mantleRwaApy: number;
  /** Raw data for AI prompt context */
  contextString: string;
}

export function getCrossChainYieldSignal(mantleUsdyApy: number = 4.85): CrossChainYieldSignal {
  const pools = getTopPools(10);

  if (pools.length === 0) {
    return {
      signal: "no_data",
      yieldGapPct: 0,
      stableAdjustmentBps: 0,
      solanaStableApy: 0,
      mantleRwaApy: mantleUsdyApy,
      contextString: "Byreal cross-chain data unavailable",
    };
  }

  // Find best stable pool yield on Solana
  const stablePools = pools.filter(
    (p) => p.tokenA === "USDC" || p.tokenB === "USDC" || p.tokenA === "USDT" || p.tokenB === "USDT"
  );
  const solanaStableApy = stablePools.length > 0
    ? Math.max(...stablePools.map((p) => p.apy))
    : 0;

  const yieldGap = solanaStableApy - mantleUsdyApy;

  // If Solana stable yields beat Mantle by >3%, signal to increase stables on Mantle
  // (capital preservation — user should move to Solana or at least reduce Mantle risk)
  let stableAdjustmentBps = 0;
  let signal: CrossChainYieldSignal["signal"] = "mantle_competitive";

  if (yieldGap > 3) {
    signal = "solana_outperforming";
    // Scale: 3% gap = 200bps shift, 6%+ gap = 500bps shift toward stables
    stableAdjustmentBps = Math.min(500, Math.round(yieldGap * 80));
  } else if (yieldGap > 1) {
    signal = "solana_outperforming";
    stableAdjustmentBps = Math.round(yieldGap * 50);
  }

  const topOps = pools.slice(0, 3).map((p) =>
    `${p.pair}: ${p.apy.toFixed(1)}% APY [${p.apy > 50 ? "high" : p.apy > 15 ? "medium" : "low"} risk]`
  ).join("; ");

  const contextString = signal === "solana_outperforming"
    ? `Cross-chain: Solana stable yields (${solanaStableApy.toFixed(1)}% APY) outperform Mantle RWA (${mantleUsdyApy}% APY) by ${yieldGap.toFixed(1)}pp. Recommend increasing stable allocation by ${(stableAdjustmentBps/100).toFixed(1)}%. Top pools: ${topOps}`
    : `Cross-chain: Mantle RWA yields (${mantleUsdyApy}% APY) competitive with Solana stables (${solanaStableApy.toFixed(1)}% APY). Current Mantle strategy optimal. Top Solana pools: ${topOps}`;

  return {
    signal,
    yieldGapPct: yieldGap,
    stableAdjustmentBps,
    solanaStableApy,
    mantleRwaApy: mantleUsdyApy,
    contextString,
  };
}

export function getCrossChainOpportunities(): {
  solanaTopYield: number;
  mantleComparison: string;
  opportunities: { pool: string; apy: number; risk: string; tvl: number }[];
  source: string;
} {
  const pools = getTopPools(10);

  if (pools.length === 0) {
    return {
      solanaTopYield: 0,
      mantleComparison: "Byreal data unavailable",
      opportunities: [],
      source: "offline",
    };
  }

  const topYield = Math.max(...pools.map((p) => p.apy));

  // Filter for stable/yield pools
  const stablePools = pools.filter(
    (p) => p.tokenA === "USDC" || p.tokenB === "USDC" || p.tokenA === "USDT" || p.tokenB === "USDT"
  );
  const stableTopApy = stablePools.length > 0
    ? Math.max(...stablePools.map((p) => p.apy))
    : 0;

  // Compare with Mantle RWA yields (~4-5% APY)
  const mantleAvg = 4.5;
  const comparison = stableTopApy > mantleAvg
    ? `Solana CLMM stable pools yielding ${stableTopApy.toFixed(1)}% APY vs Mantle RWA ${mantleAvg}% — cross-chain opportunity detected`
    : `Mantle RWA yields (${mantleAvg}%) competitive with Solana stable pools (${stableTopApy.toFixed(1)}%) — staying on Mantle optimal`;

  return {
    solanaTopYield: topYield,
    mantleComparison: comparison,
    opportunities: pools.slice(0, 5).map((p) => ({
      pool: p.pair,
      apy: p.apy,
      risk: p.apy > 50 ? "high" : p.apy > 15 ? "medium" : "low",
      tvl: p.tvl,
    })),
    source: "byreal-cli-live",
  };
}
