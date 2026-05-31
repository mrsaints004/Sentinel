import { YieldData } from "../dataFeeds";

export interface YieldAnalysis {
  bestYieldAsset: string;
  bestYieldApy: number;
  rankings: {
    asset: string;
    apy: number;
    tvl: number;
    source: string;
    capitalEfficiency: number; // score 0-100
    recommendation: string;
  }[];
  yieldSpread: number; // difference between best and worst
  averageYield: number;
  timestamp: number;
}

export class YieldOptimizationAgent {
  async analyze(yields: YieldData[]): Promise<YieldAnalysis> {
    const sorted = [...yields].sort((a, b) => b.apy - a.apy);

    const rankings = sorted.map((y, i) => {
      // Capital efficiency considers yield relative to TVL and source reliability
      const tvlScore = Math.min(100, (y.tvl / 1_000_000_000) * 100);
      const yieldScore = Math.min(100, y.apy * 15);
      const capitalEfficiency = Math.round(yieldScore * 0.6 + tvlScore * 0.4);

      let recommendation: string;
      if (i === 0) {
        recommendation = `Highest yield at ${y.apy.toFixed(2)}%. Strong allocation candidate.`;
      } else if (y.apy > sorted[0].apy * 0.85) {
        recommendation = `Competitive yield, within 15% of best. Good diversification option.`;
      } else {
        recommendation = `Lower yield but provides stability. Use for risk management allocation.`;
      }

      return {
        asset: y.symbol,
        apy: y.apy,
        tvl: y.tvl,
        source: y.source,
        capitalEfficiency,
        recommendation,
      };
    });

    const best = sorted[0];
    const worst = sorted[sorted.length - 1];

    return {
      bestYieldAsset: best.symbol,
      bestYieldApy: best.apy,
      rankings,
      yieldSpread: best.apy - worst.apy,
      averageYield: yields.reduce((s, y) => s + y.apy, 0) / yields.length,
      timestamp: Date.now(),
    };
  }
}
