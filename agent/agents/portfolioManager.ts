import { config } from "../config";
import { MarketOutlook } from "./marketIntelligence";
import { YieldAnalysis } from "./yieldOptimization";
import { RiskAnalysis } from "./riskManagement";
import { CrossChainYieldSignal } from "../skills/byrealSkill";
import OpenAI from "openai";

const AI_BASE_URL = "https://api.groq.com/openai/v1";
const AI_MODEL = "llama-3.3-70b-versatile";

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
    currentAllocations: { symbol: string; allocationBps: number }[],
    crossChainSignal?: CrossChainYieldSignal
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
    let final = this.blendAllocations(yieldAlloc, marketAdj, riskAdj, weights);

    // Apply cross-chain yield intelligence from Byreal
    if (crossChainSignal && crossChainSignal.signal === "solana_outperforming" && crossChainSignal.stableAdjustmentBps > 0) {
      final = this.crossChainAdjustment(final, crossChainSignal);
      reasons.push(
        `Cross-chain signal: Solana CLMM stable yields (${crossChainSignal.solanaStableApy.toFixed(1)}% APY) exceed Mantle RWA (${crossChainSignal.mantleRwaApy}% APY) by ${crossChainSignal.yieldGapPct.toFixed(1)}pp — shifting +${(crossChainSignal.stableAdjustmentBps/100).toFixed(1)}% toward stablecoins for capital efficiency.`
      );
    } else if (crossChainSignal && crossChainSignal.signal === "mantle_competitive") {
      reasons.push(
        `Cross-chain: Mantle RWA yields competitive with Solana (${crossChainSignal.solanaStableApy.toFixed(1)}% vs ${crossChainSignal.mantleRwaApy}%) — current Mantle allocation optimal.`
      );
    }

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

  /**
   * Apply cross-chain yield intelligence from Byreal to allocation.
   * When Solana yields significantly exceed Mantle, increase stablecoin allocation
   * (USDY/USDC) at the expense of mETH. This is a capital-preservation signal:
   * if better yields exist elsewhere, reduce directional risk on Mantle.
   */
  private crossChainAdjustment(
    base: Record<string, number>,
    signal: CrossChainYieldSignal
  ): Record<string, number> {
    const adj = { ...base };
    const shift = signal.stableAdjustmentBps;

    if (shift <= 0) return adj;

    // Reduce mETH (highest risk), increase USDY (yield-bearing stable)
    const mETHReduction = Math.min(shift, (adj["mETH"] || 3000) - 1000);
    adj["mETH"] = (adj["mETH"] || 3000) - mETHReduction;

    // Split the freed allocation: 60% to USDY (yield-bearing), 40% to USDC (pure stable)
    adj["USDY"] = (adj["USDY"] || 3000) + Math.round(mETHReduction * 0.6);
    adj["USDC"] = (adj["USDC"] || 3000) + Math.round(mETHReduction * 0.4);

    return this.normalize(adj);
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
   * Enhance decision with Gemini AI reasoning AND allocation adjustments.
   * The AI can override allocations within safe bounds (no single asset > 60%,
   * must sum to 10000 bps). Falls back to rule-based if AI fails.
   */
  async enhanceWithAI(
    decision: PortfolioDecision,
    market: MarketOutlook,
    yields: YieldAnalysis,
    risk: RiskAnalysis,
    currentAllocations: { symbol: string; allocationBps: number }[],
    crossChainContext: string = ""
  ): Promise<PortfolioDecision> {
    if (!config.openaiApiKey) return decision;

    try {
      const openai = new OpenAI({
        apiKey: config.openaiApiKey,
        baseURL: AI_BASE_URL,
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

RULE-BASED SUGGESTION:
- Action: ${decision.action}
- Allocations: ${decision.newAllocations.map(a => `${a.symbol}: ${(a.allocationBps/100).toFixed(1)}%`).join(", ")}
${crossChainContext ? `\nCROSS-CHAIN INTELLIGENCE (Byreal Agent Skills — Solana CLMM):\n${crossChainContext}\nUse this to judge if Mantle yields are competitive. If Solana yields are significantly higher for similar risk, mention it in reasoning.\n` : ""}
You may adjust the allocations if you see a better opportunity. Respond with ONLY valid JSON:
{
  "action": "rebalance" | "hold",
  "reasoning": "2-3 sentences explaining WHY, referencing specific data points",
  "USDY": <number 1000-6000>,
  "mETH": <number 1000-6000>,
  "USDC": <number 1000-6000>
}

RULES:
- All three values MUST sum to exactly 10000
- No single asset above 6000 (60%)
- No single asset below 1000 (10%)
- If risk score >= 7, stablecoins (USDY+USDC) should be >= 6000
- Be analytical and reference specific yield rates, momentum, and risk data`;

      const response = await openai.chat.completions.create({
        model: AI_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 300,
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) throw new Error("Empty AI response");

      // Parse JSON from response (handle markdown code blocks)
      const jsonStr = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      const aiResult = JSON.parse(jsonStr);

      // Validate AI allocations
      const usdyBps = Number(aiResult.USDY);
      const methBps = Number(aiResult.mETH);
      const usdcBps = Number(aiResult.USDC);
      const sum = usdyBps + methBps + usdcBps;

      if (
        sum === 10000 &&
        usdyBps >= 1000 && usdyBps <= 6000 &&
        methBps >= 1000 && methBps <= 6000 &&
        usdcBps >= 1000 && usdcBps <= 6000 &&
        aiResult.reasoning && aiResult.reasoning.length > 20
      ) {
        // AI allocations are valid — apply them
        decision.newAllocations = [
          { asset: config.assets.USDY, symbol: "USDY", allocationBps: usdyBps },
          { asset: config.assets.mETH, symbol: "mETH", allocationBps: methBps },
          { asset: config.assets.USDC, symbol: "USDC", allocationBps: usdcBps },
        ];
        decision.reasoning = aiResult.reasoning;
        if (aiResult.action === "hold" || aiResult.action === "rebalance") {
          decision.action = aiResult.action;
        }
        console.log("  [AI] AI adjusted allocations and reasoning");
      } else if (aiResult.reasoning && aiResult.reasoning.length > 20) {
        // Reasoning is good but allocations failed validation — keep rule-based allocations
        decision.reasoning = aiResult.reasoning;
        console.log("  [AI] AI reasoning applied (allocations failed validation, using rule-based)");
      }
    } catch (error) {
      console.warn("  [AI] AI enhancement failed, using rule-based:", (error as Error).message);
    }

    return decision;
  }
}
