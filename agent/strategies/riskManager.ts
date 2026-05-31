import { PriceData, RiskMetrics } from "../dataFeeds";
import { config } from "../config";

export interface RiskAssessment {
  shouldRebalance: boolean;
  isEmergency: boolean;
  alerts: string[];
  suggestedAction: "hold" | "rebalance" | "emergency_withdraw";
}

export function assessRisk(
  prices: PriceData[],
  risk: RiskMetrics,
  currentAllocations: { symbol: string; allocationBps: number }[]
): RiskAssessment {
  const alerts: string[] = [];
  let isEmergency = false;
  let shouldRebalance = false;

  // Check depeg risks
  for (const price of prices) {
    if (price.pegDeviation > config.risk.depegThresholdBps) {
      alerts.push(
        `${price.asset} depeg alert: ${price.pegDeviation.toFixed(0)} bps deviation`
      );
      shouldRebalance = true;

      if (price.pegDeviation > 500) {
        isEmergency = true;
        alerts.push(`CRITICAL: ${price.asset} severe depeg — emergency rebalance`);
      }
    }
  }

  // Check concentration risk
  for (const alloc of currentAllocations) {
    if (alloc.allocationBps > config.risk.maxSingleAssetBps) {
      alerts.push(
        `Concentration risk: ${alloc.symbol} at ${(alloc.allocationBps / 100).toFixed(1)}% (max: ${config.risk.maxSingleAssetBps / 100}%)`
      );
      shouldRebalance = true;
    }
  }

  // Check minimum stable allocation
  const stableAlloc = currentAllocations
    .filter((a) => a.symbol === "USDC" || a.symbol === "USDY")
    .reduce((sum, a) => sum + a.allocationBps, 0);

  if (stableAlloc < config.risk.minStableBps) {
    alerts.push(
      `Insufficient stable allocation: ${(stableAlloc / 100).toFixed(1)}% (min: ${config.risk.minStableBps / 100}%)`
    );
    shouldRebalance = true;
  }

  // Check overall volatility
  if (risk.volatilityIndex > 80) {
    alerts.push(`High volatility: ${risk.volatilityIndex.toFixed(0)}/100`);
    shouldRebalance = true;
  }

  // Check large price movements
  for (const price of prices) {
    if (Math.abs(price.change24h) > 5) {
      alerts.push(
        `Large price move: ${price.asset} ${price.change24h > 0 ? "+" : ""}${price.change24h.toFixed(2)}% in 24h`
      );
      shouldRebalance = true;
    }
  }

  let suggestedAction: RiskAssessment["suggestedAction"] = "hold";
  if (isEmergency) suggestedAction = "emergency_withdraw";
  else if (shouldRebalance) suggestedAction = "rebalance";

  return {
    shouldRebalance: shouldRebalance || isEmergency,
    isEmergency,
    alerts,
    suggestedAction,
  };
}
