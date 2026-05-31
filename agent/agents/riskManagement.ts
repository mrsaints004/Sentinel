import { PriceData, RiskMetrics } from "../dataFeeds";
import { config } from "../config";

export interface RiskAnalysis {
  riskScore: number; // 0-10, higher = more risky
  recommendation: string;
  maxDrawdownEstimate: number; // percentage
  exposureWarnings: {
    asset: string;
    issue: string;
    severity: "info" | "warning" | "critical";
  }[];
  suggestedLimits: {
    asset: string;
    maxAllocationBps: number;
    reason: string;
  }[];
  timestamp: number;
}

export class RiskManagementAgent {
  async analyze(
    prices: PriceData[],
    risk: RiskMetrics,
    currentAllocations: { symbol: string; allocationBps: number }[]
  ): Promise<RiskAnalysis> {
    const warnings: RiskAnalysis["exposureWarnings"] = [];
    const suggestedLimits: RiskAnalysis["suggestedLimits"] = [];
    let riskScore = 2; // baseline

    // Check peg deviations (skip USDY — it's yield-bearing, not pegged to $1)
    for (const price of prices) {
      if (price.asset !== "USDY" && price.pegDeviation > config.risk.depegThresholdBps) {
        warnings.push({
          asset: price.asset,
          issue: `Peg deviation of ${price.pegDeviation.toFixed(0)} bps detected`,
          severity: price.pegDeviation > 500 ? "critical" : "warning",
        });
        riskScore += price.pegDeviation > 500 ? 3 : 1.5;
      }

      if (Math.abs(price.change24h) > 5) {
        warnings.push({
          asset: price.asset,
          issue: `Large 24h price move: ${price.change24h > 0 ? "+" : ""}${price.change24h.toFixed(1)}%`,
          severity: Math.abs(price.change24h) > 10 ? "critical" : "warning",
        });
        riskScore += 1;
      }
    }

    // Check concentration
    for (const alloc of currentAllocations) {
      if (alloc.allocationBps > config.risk.maxSingleAssetBps) {
        warnings.push({
          asset: alloc.symbol,
          issue: `Over-concentrated at ${(alloc.allocationBps / 100).toFixed(0)}%`,
          severity: "warning",
        });
        riskScore += 1;
      }
    }

    // Check stable allocation
    const stableAlloc = currentAllocations
      .filter((a) => a.symbol === "USDC" || a.symbol === "USDY")
      .reduce((sum, a) => sum + a.allocationBps, 0);

    if (stableAlloc < config.risk.minStableBps) {
      warnings.push({
        asset: "Stablecoins",
        issue: `Combined stable allocation ${(stableAlloc / 100).toFixed(0)}% below minimum ${config.risk.minStableBps / 100}%`,
        severity: "warning",
      });
      riskScore += 1;
    }

    // Volatility contribution
    riskScore += risk.volatilityIndex / 50;

    // Cap at 10
    riskScore = Math.min(10, Math.max(0, riskScore));

    // Generate limits based on risk
    const isHighRisk = riskScore > 6;
    for (const alloc of currentAllocations) {
      let maxBps = config.risk.maxSingleAssetBps;
      let reason = "Standard concentration limit";

      if (alloc.symbol === "mETH" && isHighRisk) {
        maxBps = 2000;
        reason = "Reduced limit due to elevated risk score";
      }

      if ((alloc.symbol === "USDC" || alloc.symbol === "USDY") && isHighRisk) {
        maxBps = 6000;
        reason = "Increased limit for safe haven in high-risk conditions";
      }

      suggestedLimits.push({ asset: alloc.symbol, maxAllocationBps: maxBps, reason });
    }

    // Recommendation
    let recommendation: string;
    if (riskScore <= 3) {
      recommendation = "Risk levels acceptable. Normal operations recommended.";
    } else if (riskScore <= 6) {
      recommendation = "Moderate risk detected. Consider reducing volatile asset exposure.";
    } else if (riskScore <= 8) {
      recommendation = "High risk environment. Shift allocation toward stablecoins.";
    } else {
      recommendation = "Critical risk. Recommend emergency rebalance to maximum stable allocation.";
    }

    // Estimate max drawdown
    const maxDrawdownEstimate = riskScore * 1.5 + risk.volatilityIndex * 0.05;

    return {
      riskScore: Math.round(riskScore * 10) / 10,
      recommendation,
      maxDrawdownEstimate: Math.round(maxDrawdownEstimate * 10) / 10,
      exposureWarnings: warnings,
      suggestedLimits,
      timestamp: Date.now(),
    };
  }
}
