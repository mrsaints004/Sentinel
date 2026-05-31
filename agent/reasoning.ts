import OpenAI from "openai";
import { config } from "./config";
import { MarketSnapshot } from "./dataFeeds";

// Gemini via OpenAI-compatible endpoint
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const GEMINI_MODEL = "gemini-2.0-flash";

export interface AgentDecision {
  action: "rebalance" | "hold" | "emergency_withdraw";
  reasoning: string;
  riskLevel: string;
  newAllocations: {
    asset: string;
    symbol: string;
    allocationBps: number;
  }[];
  confidence: number;
}

const SYSTEM_PROMPT = `You are Sentinel, an autonomous AI portfolio manager for Real World Assets (RWA) on the Mantle blockchain. Your role is to manage a portfolio of three assets:

1. USDY — Ondo Finance's tokenized US Treasury yield token (~4-5% APY)
2. mETH — Mantle's liquid staking ETH derivative (~3-4% APY)
3. USDC — Stablecoin deployed in lending protocols (~2-4% APY)

Your objectives:
- Maximize risk-adjusted yield
- Maintain portfolio stability
- React to market conditions (depeg risks, yield changes, volatility)
- Keep minimum 20% in stablecoins (USDC/USDY) for liquidity

Rules:
- No single asset should exceed 60% allocation
- During high risk: increase stablecoin allocation to >50%
- During low risk: optimize for highest yield
- Always provide clear reasoning for decisions

Respond ONLY with valid JSON matching this schema:
{
  "action": "rebalance" | "hold" | "emergency_withdraw",
  "reasoning": "string explaining the decision in plain English",
  "riskLevel": "low" | "medium" | "high" | "critical",
  "newAllocations": [
    { "asset": "address", "symbol": "USDY", "allocationBps": 3500 },
    { "asset": "address", "symbol": "mETH", "allocationBps": 3500 },
    { "asset": "address", "symbol": "USDC", "allocationBps": 3000 }
  ],
  "confidence": 0.85
}

Allocations must sum to exactly 10000 (basis points = 100%).`;

export async function makeDecision(
  snapshot: MarketSnapshot,
  currentAllocations: { symbol: string; allocationBps: number }[]
): Promise<AgentDecision> {
  // If no API key, use rule-based fallback
  if (!config.openaiApiKey) {
    return ruleBasedDecision(snapshot, currentAllocations);
  }

  const openai = new OpenAI({
    apiKey: config.openaiApiKey,
    baseURL: GEMINI_BASE_URL,
  });

  const userPrompt = `Current market snapshot:

YIELDS:
${snapshot.yields.map((y) => `- ${y.symbol}: ${y.apy.toFixed(2)}% APY (TVL: $${(y.tvl / 1e6).toFixed(0)}M, Source: ${y.source})`).join("\n")}

PRICES:
${snapshot.prices.map((p) => `- ${p.asset}: $${p.priceUSD.toFixed(4)} (24h: ${p.change24h > 0 ? "+" : ""}${p.change24h.toFixed(2)}%, Peg deviation: ${p.pegDeviation.toFixed(0)} bps)`).join("\n")}

RISK:
- Overall: ${snapshot.risk.overallRisk}
- Volatility Index: ${snapshot.risk.volatilityIndex.toFixed(1)}/100
- Depeg Risks: ${snapshot.risk.depegRisks.length > 0 ? snapshot.risk.depegRisks.map((d) => `${d.asset}: ${d.deviation} bps`).join(", ") : "None"}

CURRENT ALLOCATIONS:
${currentAllocations.map((a) => `- ${a.symbol}: ${(a.allocationBps / 100).toFixed(1)}%`).join("\n")}

Asset addresses:
- USDY: ${config.assets.USDY}
- mETH: ${config.assets.mETH}
- USDC: ${config.assets.USDC}

Analyze the data and decide the optimal portfolio action.`;

  try {
    const response = await openai.chat.completions.create({
      model: GEMINI_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty response from OpenAI");

    const decision = JSON.parse(content) as AgentDecision;
    validateDecision(decision);
    return decision;
  } catch (error) {
    console.error("OpenAI reasoning failed, using rule-based fallback:", error);
    return ruleBasedDecision(snapshot, currentAllocations);
  }
}

function ruleBasedDecision(
  snapshot: MarketSnapshot,
  currentAllocations: { symbol: string; allocationBps: number }[]
): AgentDecision {
  const { risk, yields } = snapshot;

  // Sort yields descending
  const sorted = [...yields].sort((a, b) => b.apy - a.apy);

  let allocations: AgentDecision["newAllocations"];
  let reasoning: string;
  let action: AgentDecision["action"] = "rebalance";

  if (risk.overallRisk === "critical") {
    // Emergency: go heavy into stables
    allocations = [
      { asset: config.assets.USDY, symbol: "USDY", allocationBps: 4000 },
      { asset: config.assets.mETH, symbol: "mETH", allocationBps: 1000 },
      { asset: config.assets.USDC, symbol: "USDC", allocationBps: 5000 },
    ];
    reasoning = `Critical risk detected. Moving to defensive position with 90% stablecoins. Depeg risks: ${risk.depegRisks.map((d) => `${d.asset} at ${d.deviation}bps`).join(", ")}.`;
    action = "emergency_withdraw";
  } else if (risk.overallRisk === "high") {
    allocations = [
      { asset: config.assets.USDY, symbol: "USDY", allocationBps: 3500 },
      { asset: config.assets.mETH, symbol: "mETH", allocationBps: 2000 },
      { asset: config.assets.USDC, symbol: "USDC", allocationBps: 4500 },
    ];
    reasoning = `High risk environment. Reducing mETH exposure, increasing stablecoin buffer. Volatility at ${risk.volatilityIndex.toFixed(0)}/100.`;
  } else if (risk.overallRisk === "medium") {
    allocations = [
      { asset: config.assets.USDY, symbol: "USDY", allocationBps: 3500 },
      { asset: config.assets.mETH, symbol: "mETH", allocationBps: 3000 },
      { asset: config.assets.USDC, symbol: "USDC", allocationBps: 3500 },
    ];
    reasoning = `Medium risk. Balanced allocation across all assets. Best yield: ${sorted[0].symbol} at ${sorted[0].apy.toFixed(2)}% APY.`;
  } else {
    // Low risk: optimize for yield
    const bestYield = sorted[0];
    const secondYield = sorted[1];

    let bestBps = 5000;
    let secondBps = 3000;
    let thirdBps = 2000;

    // Ensure no single asset > 60%
    if (bestBps > 6000) bestBps = 6000;

    allocations = [
      {
        asset: config.assets[bestYield.symbol as keyof typeof config.assets],
        symbol: bestYield.symbol,
        allocationBps: bestBps,
      },
      {
        asset: config.assets[secondYield.symbol as keyof typeof config.assets],
        symbol: secondYield.symbol,
        allocationBps: secondBps,
      },
      {
        asset: config.assets[sorted[2].symbol as keyof typeof config.assets],
        symbol: sorted[2].symbol,
        allocationBps: thirdBps,
      },
    ];
    reasoning = `Low risk environment. Optimizing for yield. Leading with ${bestYield.symbol} at ${bestYield.apy.toFixed(2)}% APY. All assets showing healthy metrics.`;
  }

  // Check if rebalance is significant enough
  const maxDelta = Math.max(
    ...allocations.map((a) => {
      const current = currentAllocations.find((c) => c.symbol === a.symbol);
      return Math.abs(a.allocationBps - (current?.allocationBps || 3333));
    })
  );

  if (maxDelta < config.rebalanceThresholdBps && risk.overallRisk !== "critical") {
    action = "hold";
    reasoning = `Portfolio is within optimal range. Max allocation delta: ${maxDelta} bps (threshold: ${config.rebalanceThresholdBps} bps). Holding current positions.`;
  }

  return {
    action,
    reasoning,
    riskLevel: risk.overallRisk,
    newAllocations: allocations,
    confidence: risk.overallRisk === "low" ? 0.9 : risk.overallRisk === "medium" ? 0.75 : 0.6,
  };
}

function validateDecision(decision: AgentDecision): void {
  const totalBps = decision.newAllocations.reduce(
    (sum, a) => sum + a.allocationBps,
    0
  );
  if (totalBps !== 10000) {
    throw new Error(`Allocations sum to ${totalBps}, expected 10000`);
  }
  if (decision.newAllocations.some((a) => a.allocationBps > 6000)) {
    throw new Error("Single asset exceeds 60% limit");
  }
}
