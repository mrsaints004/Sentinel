import { YieldData } from "../dataFeeds";

export interface YieldRecommendation {
  symbol: string;
  currentApy: number;
  suggestedAllocationBps: number;
  reason: string;
}

export function optimizeYield(
  yields: YieldData[],
  riskLevel: string
): YieldRecommendation[] {
  const sorted = [...yields].sort((a, b) => b.apy - a.apy);

  // Risk-adjusted allocation weights
  const riskMultipliers: Record<string, { aggressive: number; moderate: number; conservative: number }> = {
    low: { aggressive: 0.5, moderate: 0.3, conservative: 0.2 },
    medium: { aggressive: 0.35, moderate: 0.35, conservative: 0.3 },
    high: { aggressive: 0.2, moderate: 0.3, conservative: 0.5 },
    critical: { aggressive: 0.1, moderate: 0.2, conservative: 0.7 },
  };

  const multiplier = riskMultipliers[riskLevel] || riskMultipliers.medium;

  const recommendations: YieldRecommendation[] = sorted.map((y, i) => {
    let weight: number;
    if (i === 0) weight = multiplier.aggressive;
    else if (i === 1) weight = multiplier.moderate;
    else weight = multiplier.conservative;

    const allocBps = Math.round(weight * 10000);

    return {
      symbol: y.symbol,
      currentApy: y.apy,
      suggestedAllocationBps: allocBps,
      reason:
        i === 0
          ? `Highest yield at ${y.apy.toFixed(2)}% from ${y.source}`
          : i === 1
            ? `Second highest yield at ${y.apy.toFixed(2)}%`
            : `Lowest yield but provides stability at ${y.apy.toFixed(2)}%`,
    };
  });

  return recommendations;
}

export function calculateBlendedYield(
  yields: YieldData[],
  allocations: { symbol: string; allocationBps: number }[]
): number {
  let blended = 0;
  for (const alloc of allocations) {
    const yieldData = yields.find((y) => y.symbol === alloc.symbol);
    if (yieldData) {
      blended += (yieldData.apy * alloc.allocationBps) / 10000;
    }
  }
  return blended;
}
