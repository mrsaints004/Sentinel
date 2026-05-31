import { config } from "./config";
import { getMarketSnapshot, MarketSnapshot } from "./dataFeeds";
import { Executor } from "./executor";
import { MarketIntelligenceAgent, MarketOutlook } from "./agents/marketIntelligence";
import { YieldOptimizationAgent, YieldAnalysis } from "./agents/yieldOptimization";
import { RiskManagementAgent, RiskAnalysis } from "./agents/riskManagement";
import {
  PortfolioManagerAgent,
  PortfolioDecision,
  RiskProfile,
} from "./agents/portfolioManager";
import { calculateBlendedYield } from "./strategies/yieldOptimizer";
import {
  checkTrade,
  getRules,
  setRules,
  enableAutonomous,
  formatRules,
  getTradesToday,
  AutonomousRules,
} from "./autonomousRules";
import { getCrossChainOpportunities } from "./skills/byrealSkill";
import { notifyDecision, notifyApprovalNeeded } from "./telegram";
import { logActivity } from "./activityLog";

// --- Multi-Agent System ---
const marketAgent = new MarketIntelligenceAgent();
const yieldAgent = new YieldOptimizationAgent();
const riskAgent = new RiskManagementAgent();
const portfolioAgent = new PortfolioManagerAgent("moderate");

// --- State ---
let currentAllocations = [
  { symbol: "USDY", allocationBps: 3333 },
  { symbol: "mETH", allocationBps: 3334 },
  { symbol: "USDC", allocationBps: 3333 },
];

let totalDecisions = 0;
let cumulativeROIBps = 0;
let pendingApproval: PortfolioDecision | null = null;

interface CycleResult {
  snapshot: MarketSnapshot;
  market: MarketOutlook;
  yields: YieldAnalysis;
  risk: RiskAnalysis;
  decision: PortfolioDecision;
  txHash: string | null;
  timestamp: number;
}

const cycleHistory: CycleResult[] = [];

// --- Main Cycle ---
async function runCycle(executor: Executor | null): Promise<CycleResult> {
  const cycleNum = totalDecisions + 1;
  console.log("\n" + "=".repeat(60));
  console.log(`[Sentinel] Cycle ${cycleNum} — ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  // 1. Collect market data
  console.log("\n[1/5] Fetching market data...");
  const snapshot = await getMarketSnapshot();
  snapshot.yields.forEach((y) =>
    console.log(`  ${y.symbol}: ${y.apy.toFixed(2)}% APY (${y.source})`)
  );

  // 2. Market Intelligence Agent
  console.log("\n[2/5] Market Intelligence Agent analyzing...");
  const market = await marketAgent.analyze(snapshot.prices);
  console.log(`  Outlook: ${market.outlook} (confidence: ${market.confidence}%)`);
  console.log(`  ETH Momentum: ${market.ethMomentum}/100`);
  console.log(`  Volatility: ${market.volatility}`);
  market.signals.forEach((s) => console.log(`  Signal: ${s}`));

  // 3. Yield Optimization Agent
  console.log("\n[3/5] Yield Optimization Agent analyzing...");
  const yields = await yieldAgent.analyze(snapshot.yields);
  console.log(`  Best yield: ${yields.bestYieldAsset} at ${yields.bestYieldApy.toFixed(2)}% APY`);
  console.log(`  Yield spread: ${yields.yieldSpread.toFixed(2)}%`);
  yields.rankings.forEach((r) =>
    console.log(`  ${r.asset}: ${r.apy.toFixed(2)}% (efficiency: ${r.capitalEfficiency}/100)`)
  );

  // 4. Risk Management Agent
  console.log("\n[4/5] Risk Management Agent analyzing...");
  const risk = await riskAgent.analyze(snapshot.prices, snapshot.risk, currentAllocations);
  console.log(`  Risk Score: ${risk.riskScore}/10`);
  console.log(`  Max Drawdown Est: ${risk.maxDrawdownEstimate}%`);
  console.log(`  ${risk.recommendation}`);
  risk.exposureWarnings.forEach((w) =>
    console.log(`  [${w.severity.toUpperCase()}] ${w.asset}: ${w.issue}`)
  );

  // 5. Portfolio Manager Agent (combines all)
  console.log("\n[5/5] Portfolio Manager Agent deciding...");
  let decision = await portfolioAgent.decide(market, yields, risk, currentAllocations);

  // Enhance with Gemini AI reasoning
  decision = await portfolioAgent.enhanceWithAI(decision, market, yields, risk, currentAllocations);
  console.log(`  Action: ${decision.action}`);
  console.log(`  Confidence: ${decision.confidence}%`);
  console.log(`  Risk Level: ${decision.riskLevel}`);
  console.log(`  Reasoning: ${decision.reasoning}`);
  decision.newAllocations.forEach((a) =>
    console.log(`  ${a.symbol}: ${(a.allocationBps / 100).toFixed(1)}%`)
  );

  // Agent contributions
  console.log("\n  --- Agent Contributions ---");
  console.log(`  Market: ${decision.agentContributions.market}`);
  console.log(`  Yield: ${decision.agentContributions.yield}`);
  console.log(`  Risk: ${decision.agentContributions.risk}`);

  // Cross-chain intelligence via Byreal CLI
  console.log("\n  --- Cross-Chain Intelligence (Byreal) ---");
  try {
    const crossChain = getCrossChainOpportunities();
    console.log(`  Solana top yield: ${crossChain.solanaTopYield.toFixed(1)}% APY`);
    console.log(`  ${crossChain.mantleComparison}`);
    crossChain.opportunities.forEach((o) =>
      console.log(`  ${o.pool}: ${o.apy.toFixed(1)}% APY [${o.risk}]`)
    );
  } catch (e) {
    console.log("  Cross-chain data unavailable");
  }

  // Execute — check autonomous rules first
  let txHash: string | null = null;

  const tradeCheck = checkTrade(
    {
      action: decision.action,
      confidence: decision.confidence,
      riskLevel: decision.riskLevel,
      newAllocations: decision.newAllocations,
    },
    currentAllocations,
    risk.riskScore
  );

  console.log(`\n  --- Autonomous Rules ---`);
  console.log(`  Allowed: ${tradeCheck.allowed}`);
  console.log(`  Reason: ${tradeCheck.reason}`);
  if (tradeCheck.violations.length > 0) {
    tradeCheck.violations.forEach((v) => console.log(`  Violation: ${v}`));
  }

  if (tradeCheck.allowed) {
    // Autonomous mode approved the trade
    if (executor && decision.action !== "hold") {
      txHash = await executor.executeRebalance(decision);
      const oldAlloc = currentAllocations.map((a) => a.allocationBps);
      await executor.logDecisionOnChain(decision, oldAlloc, 100000);
      totalDecisions++;
      const blended = calculateBlendedYield(snapshot.yields, currentAllocations);
      cumulativeROIBps += Math.round((blended * 100) / 365);
      await executor.updateIdentity(totalDecisions, cumulativeROIBps);
    } else {
      totalDecisions++;
      console.log("\n  [Demo mode] Skipping on-chain execution");
    }

    if (decision.action !== "hold") {
      currentAllocations = decision.newAllocations.map((a) => ({
        symbol: a.symbol,
        allocationBps: a.allocationBps,
      }));
    }

    // Log activity and notify linked Telegram users
    logActivity({
      type: "decision",
      action: decision.action,
      reasoning: decision.reasoning,
      confidence: decision.confidence,
      riskLevel: decision.riskLevel,
      allocations: decision.newAllocations,
      txHash,
      source: "agent",
    });
    notifyDecision(decision, txHash);
  } else if (tradeCheck.requiresApproval) {
    // Needs manual approval
    pendingApproval = decision;
    console.log("\n  Awaiting user approval (Telegram/Dashboard)...");
    logActivity({
      type: "approval",
      action: decision.action,
      reasoning: "Awaiting user approval — exceeds autonomous limits",
      confidence: decision.confidence,
      riskLevel: decision.riskLevel,
      allocations: decision.newAllocations,
      source: "agent",
    });
    notifyApprovalNeeded(decision);
  }

  const blended = calculateBlendedYield(snapshot.yields, currentAllocations);
  console.log(`\n  Blended portfolio yield: ${blended.toFixed(2)}% APY`);

  const result: CycleResult = {
    snapshot,
    market,
    yields,
    risk,
    decision,
    txHash,
    timestamp: Date.now(),
  };

  cycleHistory.push(result);
  return result;
}

async function main(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════╗");
  console.log("║      Mantle Treasury AI — Multi-Agent System          ║");
  console.log("║                                                        ║");
  console.log("║   Agents: Market | Yield | Risk | Portfolio Manager   ║");
  console.log("╚════════════════════════════════════════════════════════╝\n");

  let executor: Executor | null = null;
  if (config.privateKey && config.vaultAddress) {
    try {
      executor = new Executor();
      console.log(`Agent wallet: ${executor.getWalletAddress()}`);
    } catch {
      console.log("Running in demo mode (no contracts configured)");
    }
  } else {
    console.log("Running in DEMO mode");
  }

  console.log(`Risk profile: moderate`);
  console.log(`Interval: ${config.intervalMs / 1000}s\n`);

  await runCycle(executor);

  setInterval(async () => {
    try {
      await runCycle(executor);
    } catch (error) {
      console.error("Cycle failed:", error);
    }
  }, config.intervalMs);
}

// --- Exports for API / Telegram ---
export function getDecisionHistory() {
  return cycleHistory;
}
export function getCurrentAllocations() {
  return currentAllocations;
}
export function getAgentStats() {
  return { totalDecisions, cumulativeROIBps, isRunning: true, uptime: process.uptime() };
}
export function getPendingApproval() {
  return pendingApproval;
}
export function approveDecision(source: "telegram" | "dashboard" | "mcp" = "telegram") {
  if (pendingApproval) {
    logActivity({
      type: "approval",
      action: pendingApproval.action,
      reasoning: `Trade approved via ${source}`,
      confidence: pendingApproval.confidence,
      riskLevel: pendingApproval.riskLevel,
      allocations: pendingApproval.newAllocations,
      source,
    });
    currentAllocations = pendingApproval.newAllocations.map((a) => ({
      symbol: a.symbol,
      allocationBps: a.allocationBps,
    }));
    totalDecisions++;
    pendingApproval = null;
    return true;
  }
  return false;
}
export function rejectDecision(source: "telegram" | "dashboard" | "mcp" = "telegram") {
  if (pendingApproval) {
    logActivity({
      type: "rejection",
      action: pendingApproval.action,
      reasoning: `Trade rejected via ${source}`,
      source,
    });
  }
  pendingApproval = null;
  return true;
}
export function setRiskProfile(profile: RiskProfile) {
  portfolioAgent.setRiskProfile(profile);
}
export function getAutonomousRules() {
  return getRules();
}
export function updateAutonomousRules(update: Partial<AutonomousRules>) {
  return setRules(update);
}
export function toggleAutonomous(enabled: boolean) {
  return enableAutonomous(enabled);
}
export function getAutonomousStatus() {
  const rules = getRules();
  return {
    ...rules,
    tradesToday: getTradesToday(),
    formattedRules: formatRules(),
  };
}

main().catch(console.error);
