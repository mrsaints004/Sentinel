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

// Global executor reference — set once at startup, required for all operations
let globalExecutor: Executor | null = null;

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
const MAX_CYCLE_HISTORY = 50;
let cycleRunning = false;

// --- Main Cycle ---
async function runCycle(executor: Executor): Promise<CycleResult> {
  if (cycleRunning) {
    console.warn("[Sentinel] Cycle already in progress — skipping overlap");
    return cycleHistory[cycleHistory.length - 1];
  }
  cycleRunning = true;
  try {
    return await _runCycleInner(executor);
  } finally {
    cycleRunning = false;
  }
}

async function _runCycleInner(executor: Executor): Promise<CycleResult> {
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

  // Cross-chain intelligence via Byreal CLI (fetch before decision for AI context)
  let crossChainContext = "";
  console.log("\n  --- Cross-Chain Intelligence (Byreal) ---");
  try {
    const crossChain = getCrossChainOpportunities();
    console.log(`  Solana top yield: ${crossChain.solanaTopYield.toFixed(1)}% APY`);
    console.log(`  ${crossChain.mantleComparison}`);
    crossChain.opportunities.forEach((o) =>
      console.log(`  ${o.pool}: ${o.apy.toFixed(1)}% APY [${o.risk}]`)
    );
    // Build context string for AI
    if (crossChain.opportunities.length > 0) {
      const topOps = crossChain.opportunities.slice(0, 3).map(o =>
        `${o.pool}: ${o.apy.toFixed(1)}% APY [${o.risk} risk]`
      ).join("; ");
      crossChainContext = `Cross-chain: Solana top yield ${crossChain.solanaTopYield.toFixed(1)}% APY. ${crossChain.mantleComparison}. Top pools: ${topOps}`;
    }
  } catch (e) {
    console.log("  Cross-chain data unavailable");
  }

  // 5. Portfolio Manager Agent (combines all)
  console.log("\n[5/5] Portfolio Manager Agent deciding...");
  let decision = await portfolioAgent.decide(market, yields, risk, currentAllocations);

  // Enhance with Gemini AI reasoning (includes cross-chain data)
  decision = await portfolioAgent.enhanceWithAI(decision, market, yields, risk, currentAllocations, crossChainContext);
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

  // --- Multi-Agent Consensus Voting ---
  console.log("\n  --- Multi-Agent Consensus ---");
  const roundId = await executor.startConsensusRound();
  if (roundId) {
    // Each sub-agent submits its vote based on its analysis
    const marketAlloc = computeMarketVote(market);
    const yieldAlloc = computeYieldVote(yields);
    const riskAlloc = computeRiskVote(risk);
    const portfolioAlloc = decision.newAllocations.map((a) => a.allocationBps);

    await executor.submitVote(roundId, 0, marketAlloc, market.confidence, `Market: ${market.outlook}`);
    await executor.submitVote(roundId, 1, yieldAlloc, 70, `Best yield: ${yields.bestYieldAsset}`);
    await executor.submitVote(roundId, 2, riskAlloc, Math.max(30, 100 - risk.riskScore * 10), `Risk: ${risk.riskScore}/10`);
    await executor.submitVote(roundId, 3, portfolioAlloc, decision.confidence, `Portfolio: ${decision.action}`);

    const consensusResult = await executor.resolveConsensus(roundId);
    if (consensusResult?.success) {
      console.log(`  Consensus allocations: ${consensusResult.allocations.join(", ")}`);
      // Override decision with consensus allocations
      for (let i = 0; i < decision.newAllocations.length && i < consensusResult.allocations.length; i++) {
        decision.newAllocations[i].allocationBps = consensusResult.allocations[i];
      }
    }
  }

  // --- Commit-Reveal: Phase 1 — Commit hash BEFORE execution ---
  let commitData: { commitId: number; nonce: string } | null = null;
  if (decision.action !== "hold") {
    commitData = await executor.commitDecision(decision, 100000);
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
    if (decision.action !== "hold") {
      // Phase 2: Execute the rebalance
      txHash = await executor.executeRebalance(decision);
      // Phase 3: Reveal — log decision with commit verification
      const oldAlloc = currentAllocations.map((a) => a.allocationBps);
      await executor.logDecisionOnChain(decision, oldAlloc, 100000, commitData);
      totalDecisions++;
      const blended = calculateBlendedYield(snapshot.yields, currentAllocations);
      cumulativeROIBps += Math.round((blended * 100) / 365);
      await executor.updateIdentity(totalDecisions, cumulativeROIBps);
      // Record outcome for reputation tracking
      await executor.recordDecisionOutcome(100000, decision.confidence);
    } else {
      totalDecisions++;
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
  // Cap history to prevent memory leak
  if (cycleHistory.length > MAX_CYCLE_HISTORY) {
    cycleHistory.splice(0, cycleHistory.length - MAX_CYCLE_HISTORY);
  }
  return result;
}

// --- Sub-Agent Vote Computation ---
function computeMarketVote(market: MarketOutlook): number[] {
  if (market.outlook === "bullish") return [3000, 4500, 2500];
  if (market.outlook === "bearish") return [4000, 1500, 4500];
  return [3333, 3334, 3333]; // neutral
}

function computeYieldVote(yields: YieldAnalysis): number[] {
  const alloc = [3333, 3334, 3333];
  const symbols = ["USDY", "mETH", "USDC"];
  for (const r of yields.rankings) {
    const idx = symbols.indexOf(r.asset);
    if (idx >= 0) {
      alloc[idx] = Math.round((r.apy / yields.rankings.reduce((s, x) => s + x.apy, 0)) * 10000);
    }
  }
  // Normalize to 10000
  const sum = alloc.reduce((s, v) => s + v, 0);
  if (sum !== 10000 && sum > 0) {
    const diff = 10000 - sum;
    alloc[0] += diff;
  }
  // Clamp each to max 6000
  for (let i = 0; i < alloc.length; i++) {
    alloc[i] = Math.min(6000, Math.max(1000, alloc[i]));
  }
  const finalSum = alloc.reduce((s, v) => s + v, 0);
  if (finalSum !== 10000) alloc[alloc.length - 1] += 10000 - finalSum;
  return alloc;
}

function computeRiskVote(risk: RiskAnalysis): number[] {
  if (risk.riskScore >= 7) return [4500, 1000, 4500];
  if (risk.riskScore >= 5) return [4000, 2000, 4000];
  return [3000, 4000, 3000];
}

async function main(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════╗");
  console.log("║        Sentinel — AI Treasury on Mantle               ║");
  console.log("║                                                        ║");
  console.log("║   Agents: Market | Yield | Risk | Portfolio            ║");
  console.log("╚════════════════════════════════════════════════════════╝\n");

  if (!config.privateKey || !config.vaultAddress) {
    console.error("ERROR: PRIVATE_KEY and VAULT_ADDRESS must be set in .env");
    console.error("The agent requires a configured wallet and deployed contracts to run.");
    process.exit(1);
  }

  let executor: Executor;
  try {
    executor = new Executor();
    globalExecutor = executor;
    console.log(`Agent wallet: ${executor.getWalletAddress()}`);
  } catch (error) {
    console.error("ERROR: Failed to initialize executor. Check your PRIVATE_KEY, VAULT_ADDRESS, LOGGER_ADDRESS, and IDENTITY_ADDRESS.");
    console.error(error);
    process.exit(1);
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
export async function approveDecision(source: "telegram" | "dashboard" | "mcp" = "telegram") {
  if (!pendingApproval) return false;
  if (!globalExecutor) {
    console.error("Cannot approve: no executor configured");
    return false;
  }

  const decision = pendingApproval;
  let txHash: string | null = null;

  // Execute on-chain
  if (decision.action !== "hold") {
    txHash = await globalExecutor.executeRebalance(decision);
    const oldAlloc = currentAllocations.map((a) => a.allocationBps);
    await globalExecutor.logDecisionOnChain(decision, oldAlloc, 100000);
  }

  logActivity({
    type: "approval",
    action: decision.action,
    reasoning: `Trade approved via ${source}`,
    confidence: decision.confidence,
    riskLevel: decision.riskLevel,
    allocations: decision.newAllocations,
    txHash,
    source,
  });

  currentAllocations = decision.newAllocations.map((a) => ({
    symbol: a.symbol,
    allocationBps: a.allocationBps,
  }));
  totalDecisions++;

  const blended = calculateBlendedYield([], currentAllocations);
  cumulativeROIBps += Math.round((blended * 100) / 365);
  await globalExecutor.updateIdentity(totalDecisions, cumulativeROIBps);

  pendingApproval = null;
  return true;
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
