import { config } from "../config";
import { MarketOutlook } from "./marketIntelligence";
import { YieldAnalysis } from "./yieldOptimization";
import { RiskAnalysis } from "./riskManagement";
import OpenAI from "openai";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const GEMINI_MODEL = "gemini-2.0-flash";

export type RiskProfile = "conservative" | "moderate" | "aggressive";

export interface PortfolioDecision {
  action: "rebalance" | "hold" | "emergency_withdraw";
  reasoning: string;
  riskLevel: string;
  confidence: number;
  newAllocations: {
    asset: string;
    symbol: string;
    allocationBps: number;
  }[];
  agentContributions: {
    market: string;
    yield: string;
    risk: string;
  };
}

// Weight profiles for different risk appetites
const RISK_PROFILES: Record<RiskProfile, { yieldWeight: number; safetyWeight: number; momentumWeight: number }> = {
  conservative: { yieldWeight: 0.2, safetyWeight: 0.6, momentumWeight: 0.2 },
  moderate: { yieldWeight: 0.4, safetyWeight: 0.35, momentumWeight: 0.25 },
  aggressive: { yieldWeight: 0.5, safetyWeight: 0.2, momentumWeight: 0.3 },
};

export class PortfolioManagerAgent {
  private riskProfile: RiskProfile;

  constructor(riskProfile: RiskProfile = "moderate") {
    this.riskProfile = riskProfile;
  }

  setRiskProfile(profile: RiskProfile) {
    this.riskProfile = profile;
  }

  async decide(
    market: MarketOutlook,
    yields: YieldAnalysis,
    risk: RiskAnalysis,
    currentAllocations: { symbol: string; allocationBps: number }[]
  ): Promise<PortfolioDecision> {
    const weights = RISK_PROFILES[this.riskProfile];
    const reasons: string[] = [];

    // Emergency check
    if (risk.riskScore >= 8) {
      reasons.push(`Critical risk score: ${risk.riskScore}/10. ${risk.recommendation}`);
      return this.emergencyAllocation(reasons, market, yields, risk);
    }

    // Base allocation from yield rankings
    const yieldAlloc = this.yieldBasedAllocation(yields);

    // Adjust for market conditions
    const marketAdj = this.marketAdjustment(market, yieldAlloc);

    // Adjust for risk
    const riskAdj = this.riskAdjustment(risk, marketAdj);

    // Blend based on profile weights
    const final = this.blendAllocations(yieldAlloc, marketAdj, riskAdj, weights);

    // Determine action
    const maxDelta = this.maxAllocationDelta(currentAllocations, final);
    let action: PortfolioDecision["action"] = "rebalance";

    if (maxDelta < config.rebalanceThresholdBps && risk.riskScore < 6) {
      action = "hold";
      reasons.push(`Portfolio within optimal range (max delta: ${maxDelta} bps, threshold: ${config.rebalanceThresholdBps} bps).`);
    }

    // Build reasoning
    if (action === "rebalance") {
      if (market.outlook === "bullish") {
        reasons.push(`Market outlook: bullish (confidence: ${market.confidence}%, ETH momentum: ${market.ethMomentum}/100).`);
      } else if (market.outlook === "bearish") {
        reasons.push(`Market outlook: bearish — reducing risk exposure.`);
      }

      reasons.push(`Best yield: ${yields.bestYieldAsset} at ${yields.bestYieldApy.toFixed(2)}% APY.`);
      reasons.push(`Risk score: ${risk.riskScore}/10. ${risk.recommendation}`);
      reasons.push(`Strategy: ${this.riskProfile}. Rebalancing to optimal allocation.`);
    }

    const confidence = Math.round(
      (market.confidence * 0.3 + (100 - risk.riskScore * 10) * 0.4 + 70 * 0.3)
    );

    return {
      action,
      reasoning: reasons.join(" "),
      riskLevel: risk.riskScore <= 3 ? "low" : risk.riskScore <= 6 ? "medium" : "high",
      confidence: Math.min(95, confidence),
      newAllocations: this.formatAllocations(final),
      agentContributions: {
        market: `Outlook: ${market.outlook} (${market.confidence}% confidence). ${market.signals.slice(0, 2).join(". ")}.`,
        yield: `Best: ${yields.bestYieldAsset} at ${yields.bestYieldApy.toFixed(2)}%. Spread: ${yields.yieldSpread.toFixed(2)}%.`,
        risk: `Score: ${risk.riskScore}/10. ${risk.exposureWarnings.length} warnings. ${risk.recommendation}`,
      },
    };
  }

  private yieldBasedAllocation(yields: YieldAnalysis): Record<string, number> {
    const alloc: Record<string, number> = {};
    const total = yields.rankings.reduce((s, r) => s + r.apy, 0);

    for (const r of yields.rankings) {
      alloc[r.asset] = Math.round((r.apy / total) * 10000);
    }

    return this.normalize(alloc);
  }

  private marketAdjustment(
    market: MarketOutlook,
    base: Record<string, number>
  ): Record<string, number> {
    const adj = { ...base };

    if (market.outlook === "bullish" && market.confidence > 60) {
      // Increase mETH for bullish
      adj["mETH"] = Math.min(6000, (adj["mETH"] || 3000) + 500);
      adj["USDC"] = Math.max(1500, (adj["USDC"] || 3000) - 500);
    } else if (market.outlook === "bearish") {
      // Decrease mETH for bearish
      adj["mETH"] = Math.max(1000, (adj["mETH"] || 3000) - 800);
      adj["USDC"] = Math.min(5000, (adj["USDC"] || 3000) + 800);
    }

    return this.normalize(adj);
  }

  private riskAdjustment(
    risk: RiskAnalysis,
    base: Record<string, number>
  ): Record<string, number> {
    const adj = { ...base };

    if (risk.riskScore > 6) {
      // High risk: push toward stables
      adj["USDY"] = Math.min(5000, (adj["USDY"] || 3000) + 1000);
      adj["USDC"] = Math.min(5000, (adj["USDC"] || 3000) + 500);
      adj["mETH"] = Math.max(1000, (adj["mETH"] || 3000) - 1500);
    }

    // Apply suggested limits
    for (const limit of risk.suggestedLimits) {
      if (adj[limit.asset] > limit.maxAllocationBps) {
        const excess = adj[limit.asset] - limit.maxAllocationBps;
        adj[limit.asset] = limit.maxAllocationBps;
        // Redistribute excess to stables
        adj["USDC"] = (adj["USDC"] || 2000) + excess;
      }
    }

    return this.normalize(adj);
  }

  private blendAllocations(
    yieldAlloc: Record<string, number>,
    marketAlloc: Record<string, number>,
    riskAlloc: Record<string, number>,
    weights: { yieldWeight: number; safetyWeight: number; momentumWeight: number }
  ): Record<string, number> {
    const assets = new Set([
      ...Object.keys(yieldAlloc),
      ...Object.keys(marketAlloc),
      ...Object.keys(riskAlloc),
    ]);

    const blended: Record<string, number> = {};
    for (const asset of assets) {
      blended[asset] = Math.round(
        (yieldAlloc[asset] || 0) * weights.yieldWeight +
        (marketAlloc[asset] || 0) * weights.momentumWeight +
        (riskAlloc[asset] || 0) * weights.safetyWeight
      );
    }

    return this.normalize(blended);
  }

  private normalize(alloc: Record<string, number>): Record<string, number> {
    const total = Object.values(alloc).reduce((s, v) => s + v, 0);
    if (total === 0) return alloc;

    const normalized: Record<string, number> = {};
    let sum = 0;
    const keys = Object.keys(alloc);

    for (let i = 0; i < keys.length - 1; i++) {
      normalized[keys[i]] = Math.round((alloc[keys[i]] / total) * 10000);
      sum += normalized[keys[i]];
    }
    // Last asset gets remainder to ensure sum = 10000
    normalized[keys[keys.length - 1]] = 10000 - sum;

    return normalized;
  }

  private maxAllocationDelta(
    current: { symbol: string; allocationBps: number }[],
    target: Record<string, number>
  ): number {
    let max = 0;
    for (const c of current) {
      const delta = Math.abs((target[c.symbol] || 3333) - c.allocationBps);
      if (delta > max) max = delta;
    }
    return max;
  }

  private emergencyAllocation(
    reasons: string[],
    market: MarketOutlook,
    yields: YieldAnalysis,
    risk: RiskAnalysis
  ): PortfolioDecision {
    return {
      action: "emergency_withdraw",
      reasoning: reasons.join(" ") + " Emergency rebalance to maximum stable allocation.",
      riskLevel: "critical",
      confidence: 95,
      newAllocations: [
        { asset: config.assets.USDY, symbol: "USDY", allocationBps: 4000 },
        { asset: config.assets.mETH, symbol: "mETH", allocationBps: 1000 },
        { asset: config.assets.USDC, symbol: "USDC", allocationBps: 5000 },
      ],
      agentContributions: {
        market: `EMERGENCY. ${market.signals.join(". ")}`,
        yield: `Yields irrelevant during emergency. Best was ${yields.bestYieldAsset} at ${yields.bestYieldApy.toFixed(2)}%.`,
        risk: `CRITICAL: Score ${risk.riskScore}/10. ${risk.exposureWarnings.map((w) => w.issue).join(". ")}`,
      },
    };
  }

  private formatAllocations(alloc: Record<string, number>): PortfolioDecision["newAllocations"] {
    const assetMap: Record<string, string> = {
      USDY: config.assets.USDY,
      mETH: config.assets.mETH,
      USDC: config.assets.USDC,
    };

    return Object.entries(alloc).map(([symbol, bps]) => ({
      asset: assetMap[symbol] || symbol,
      symbol,
      allocationBps: bps,
    }));
  }

  /**
   * Enhance decision with Gemini AI reasoning.
   * Takes the rule-based decision and enriches it with AI-generated reasoning,
   * or lets the AI override allocations if it's confident.
   */
  async enhanceWithAI(
    decision: PortfolioDecision,
    market: MarketOutlook,
    yields: YieldAnalysis,
    risk: RiskAnalysis,
    currentAllocations: { symbol: string; allocationBps: number }[]
  ): Promise<PortfolioDecision> {
    if (!config.openaiApiKey) return decision;

    try {
      const openai = new OpenAI({
        apiKey: config.openaiApiKey,
        baseURL: GEMINI_BASE_URL,
      });

      const prompt = `You are Sentinel, an autonomous AI portfolio manager on Mantle.

CURRENT STATE:
- Allocations: ${currentAllocations.map(a => `${a.symbol}: ${(a.allocationBps/100).toFixed(1)}%`).join(", ")}
- Risk Profile: ${this.riskProfile}

MARKET INTELLIGENCE:
- Outlook: ${market.outlook} (confidence: ${market.confidence}%)
- ETH Momentum: ${market.ethMomentum}/100
- Volatility: ${market.volatility}
- Signals: ${market.signals.join("; ")}

YIELD DATA:
- Best: ${yields.bestYieldAsset} at ${yields.bestYieldApy.toFixed(2)}% APY
- Rankings: ${yields.rankings.map(r => `${r.asset}: ${r.apy.toFixed(2)}%`).join(", ")}
- Spread: ${yields.yieldSpread.toFixed(2)}%

RISK ASSESSMENT:
- Score: ${risk.riskScore}/10
- Max Drawdown: ${risk.maxDrawdownEstimate}%
- Warnings: ${risk.exposureWarnings.map(w => `${w.asset}: ${w.issue}`).join("; ") || "None"}
- Recommendation: ${risk.recommendation}

RULE-BASED DECISION:
- Action: ${decision.action}
- New Allocations: ${decision.newAllocations.map(a => `${a.symbol}: ${(a.allocationBps/100).toFixed(1)}%`).join(", ")}

Generate a concise 2-3 sentence reasoning explaining WHY this decision was made. Reference specific data points. Be analytical and professional. Do NOT include JSON. Just the reasoning text.`;

      const response = await openai.chat.completions.create({
        model: GEMINI_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 200,
      });

      const aiReasoning = response.choices[0]?.message?.content?.trim();
      if (aiReasoning && aiReasoning.length > 20) {
        decision.reasoning = aiReasoning;
        console.log("  [Gemini] AI reasoning generated successfully");
      }
    } catch (error) {
      console.warn("  [Gemini] AI reasoning failed, using rule-based:", (error as Error).message);
    }

    return decision;
  }
}
