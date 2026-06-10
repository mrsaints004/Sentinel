import { ethers } from "ethers";
import { config } from "./config";
import { Executor } from "./executor";
import { getMarketSnapshot, MarketSnapshot } from "./dataFeeds";
import { MarketIntelligenceAgent, MarketOutlook } from "./agents/marketIntelligence";
import { YieldOptimizationAgent, YieldAnalysis } from "./agents/yieldOptimization";
import { RiskManagementAgent, RiskAnalysis } from "./agents/riskManagement";
import {
  PortfolioManagerAgent,
  PortfolioDecision,
  RiskProfile,
} from "./agents/portfolioManager";
import { calculateBlendedYield } from "./strategies/yieldOptimizer";
import { checkTrade, getRules, setRules, enableAutonomous, formatRules, getTradesToday, AutonomousRules } from "./autonomousRules";
import { getCrossChainOpportunities, getCrossChainYieldSignal, CrossChainYieldSignal } from "./skills/byrealSkill";
import { notifyDecision, notifyApprovalNeeded, notifyUserByWallet } from "./telegram";
import { logActivity } from "./activityLog";
import { getReadyPlans, markExecuted, getPlans, createPlan, removePlan, pausePlan, resumePlan, formatInterval, DcaPlan } from "./dcaManager";
import { getReadyTasks, markTaskExecuted, getTasks, createTask, removeTask, pauseTask, resumeTask, createWeeklyRebalance, createSafetyShift, createYieldChase, ScheduledTask, MarketSnapshot as SchedulerMarketSnapshot } from "./scheduler";
import { getAllUserWallets, migrateGlobalToUser } from "./userStore";

// --- Shared Sub-Agents (stateless, created once) ---
const marketAgent = new MarketIntelligenceAgent();
const yieldAgent = new YieldOptimizationAgent();
const riskAgent = new RiskManagementAgent();

// --- VaultFactory ABI (minimal) ---
const FACTORY_ABI = [
  "function getAllVaults() external view returns (address[] owners, tuple(address vault, address logger, uint256 createdAt)[] infos)",
  "function vaultCount() external view returns (uint256)",
  "function getVault(address owner) external view returns (address vault, address logger, uint256 createdAt)",
];

// --- Per-User Context ---
export interface UserContext {
  wallet: string;           // owner wallet address
  vaultAddress: string;
  loggerAddress: string;
  executor: Executor;
  portfolioAgent: PortfolioManagerAgent;
  currentAllocations: { symbol: string; allocationBps: number }[];
  totalDecisions: number;
  cumulativeROIBps: number;
  pendingApproval: PortfolioDecision | null;
  cycleHistory: CycleResult[];
  lastCycleAt: number;
}

export interface CycleResult {
  snapshot: MarketSnapshot;
  market: MarketOutlook;
  yields: YieldAnalysis;
  risk: RiskAnalysis;
  decision: PortfolioDecision;
  txHash: string | null;
  timestamp: number;
}

const MAX_CYCLE_HISTORY = 50;

export class AgentManager {
  private userContexts: Map<string, UserContext> = new Map();
  private running = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  /**
   * Load all registered vaults from VaultFactory and create contexts.
   */
  async start(): Promise<void> {
    console.log("[AgentManager] Starting multi-user agent...");

    // Try to load from VaultFactory contract
    if (config.factoryAddress) {
      await this.loadFromFactory();
    }

    // Also load any users that have local data directories but may not be in the factory
    const localWallets = getAllUserWallets();
    for (const wallet of localWallets) {
      if (!this.userContexts.has(wallet.toLowerCase())) {
        console.log(`[AgentManager] Found local user data for ${wallet} without factory entry`);
      }
    }

    // Migrate legacy single-user data if VAULT_ADDRESS is set and no users found
    if (this.userContexts.size === 0 && config.vaultAddress && config.loggerAddress) {
      console.log("[AgentManager] No factory vaults found. Using legacy single-vault config.");
      // Use a placeholder wallet address for legacy mode
      const legacyWallet = "0x0000000000000000000000000000000000000001";
      migrateGlobalToUser(legacyWallet);
      this.addUser(legacyWallet, config.vaultAddress, config.loggerAddress);
    }

    this.running = true;
    console.log(`[AgentManager] ${this.userContexts.size} user(s) loaded. Starting cycles.`);
    console.log(`[AgentManager] First cycle in ${config.intervalMs / 1000}s. Use /runnow in Telegram to trigger immediately.`);

    // Start interval — NO immediate first cycle (saves gas on restarts)
    this.intervalHandle = setInterval(async () => {
      try {
        await this.runAllCycles();
      } catch (error) {
        console.error("[AgentManager] Cycle error:", error);
      }
    }, config.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async loadFromFactory(): Promise<void> {
    try {
      const provider = new ethers.JsonRpcProvider(config.mantleRpc);
      const factory = new ethers.Contract(config.factoryAddress, FACTORY_ABI, provider);
      const count = await factory.vaultCount();

      if (Number(count) === 0) {
        console.log("[AgentManager] No vaults registered in factory yet.");
        return;
      }

      const [owners, infos] = await factory.getAllVaults();
      for (let i = 0; i < owners.length; i++) {
        const owner = (owners[i] as string).toLowerCase();
        const info = infos[i];
        this.addUser(owner, info.vault, info.logger);
      }
      console.log(`[AgentManager] Loaded ${owners.length} vault(s) from factory.`);
    } catch (error) {
      console.error("[AgentManager] Failed to load from factory:", error);
    }
  }

  addUser(wallet: string, vaultAddress: string, loggerAddress: string): UserContext {
    const key = wallet.toLowerCase();
    if (this.userContexts.has(key)) {
      return this.userContexts.get(key)!;
    }

    const executor = Executor.createForUser(vaultAddress, loggerAddress);
    const ctx: UserContext = {
      wallet: key,
      vaultAddress,
      loggerAddress,
      executor,
      portfolioAgent: new PortfolioManagerAgent("moderate"),
      currentAllocations: [
        { symbol: "USDY", allocationBps: 3333 },
        { symbol: "mETH", allocationBps: 3334 },
        { symbol: "USDC", allocationBps: 3333 },
      ],
      totalDecisions: 0,
      cumulativeROIBps: 0,
      pendingApproval: null,
      cycleHistory: [],
      lastCycleAt: 0,
    };

    this.userContexts.set(key, ctx);
    console.log(`[AgentManager] Added user ${key.slice(0, 8)}... vault=${vaultAddress.slice(0, 10)}...`);
    return ctx;
  }

  getContext(wallet: string): UserContext | undefined {
    return this.userContexts.get(wallet.toLowerCase());
  }

  getAllContexts(): UserContext[] {
    return Array.from(this.userContexts.values());
  }

  /**
   * Run a full cycle for all users. Market data is fetched once and shared.
   */
  async runAllCycles(): Promise<void> {
    if (this.userContexts.size === 0) return;

    // Fetch shared market data once
    const snapshot = await getMarketSnapshot();

    for (const [wallet, ctx] of this.userContexts) {
      try {
        // Check DCA plans first
        await this.checkDcaForUser(ctx);
        // Run main cycle
        await this.runCycleForUser(ctx, snapshot);
        // Check scheduled tasks
        const prices: { [symbol: string]: number } = {};
        if (snapshot.prices) {
          for (const p of snapshot.prices) {
            prices[p.asset] = p.priceUSD;
          }
        }
        await this.checkScheduledTasksForUser(ctx, { prices });
      } catch (error) {
        console.error(`[AgentManager] Cycle failed for ${wallet.slice(0, 8)}...:`, error);
      }
    }
  }

  private async runCycleForUser(ctx: UserContext, snapshot: MarketSnapshot): Promise<CycleResult | null> {
    const cycleNum = ctx.totalDecisions + 1;
    const shortWallet = ctx.wallet.slice(0, 8);
    console.log(`\n${"=".repeat(60)}`);
    console.log(`[Sentinel] User ${shortWallet}... Cycle ${cycleNum} — ${new Date().toISOString()}`);
    console.log("=".repeat(60));

    // Sub-agent analysis
    const market = await marketAgent.analyze(snapshot.prices);
    const yields = await yieldAgent.analyze(snapshot.yields);
    const risk = await riskAgent.analyze(snapshot.prices, snapshot.risk, ctx.currentAllocations);

    // Cross-chain yield intelligence from Byreal
    let crossChainSignal: CrossChainYieldSignal | undefined;
    let crossChainContext = "";
    try {
      // Get structured signal for rule-based allocation adjustment
      const usdyApy = yields.rankings.find(r => r.asset === "USDY")?.apy || 4.85;
      crossChainSignal = getCrossChainYieldSignal(usdyApy);
      crossChainContext = crossChainSignal.contextString;

      if (crossChainSignal.signal === "solana_outperforming") {
        console.log(`  [Byreal] Solana yields outperform Mantle by ${crossChainSignal.yieldGapPct.toFixed(1)}pp — adjusting stables +${(crossChainSignal.stableAdjustmentBps/100).toFixed(1)}%`);
      } else if (crossChainSignal.signal === "mantle_competitive") {
        console.log(`  [Byreal] Mantle yields competitive with Solana — no cross-chain adjustment`);
      }
    } catch (e) {
      // Cross-chain data unavailable — non-critical, continue without it
    }

    // Portfolio decision — cross-chain signal directly influences rule-based allocation
    let decision = await ctx.portfolioAgent.decide(market, yields, risk, ctx.currentAllocations, crossChainSignal);
    decision = await ctx.portfolioAgent.enhanceWithAI(decision, market, yields, risk, ctx.currentAllocations, crossChainContext);

    console.log(`  Action: ${decision.action} | Confidence: ${decision.confidence}% | Risk: ${decision.riskLevel}`);

    // Get actual portfolio value
    const mETHPrice = snapshot.prices?.find(p => p.asset === "mETH")?.priceUSD;
    const portfolioValueUSD = await ctx.executor.getPortfolioValueUSD(mETHPrice);

    // On-chain consensus + commit-reveal ONLY when rebalancing (saves gas)
    let commitData: { commitId: number; nonce: string } | null = null;
    if (decision.action !== "hold") {
      // Fund sub-agents and run on-chain consensus
      await ctx.executor.fundSubAgents();
      const roundId = await ctx.executor.startConsensusRound();
      if (roundId) {
        const marketAlloc = computeMarketVote(market);
        const yieldAlloc = computeYieldVote(yields);
        const riskAlloc = computeRiskVote(risk);
        const portfolioAlloc = decision.newAllocations.map((a) => a.allocationBps);

        await ctx.executor.submitVote(roundId, 0, marketAlloc, market.confidence, `Market: ${market.outlook}`);
        await ctx.executor.submitVote(roundId, 1, yieldAlloc, 70, `Best yield: ${yields.bestYieldAsset}`);
        await ctx.executor.submitVote(roundId, 2, riskAlloc, Math.max(30, 100 - risk.riskScore * 10), `Risk: ${risk.riskScore}/10`);
        await ctx.executor.submitVote(roundId, 3, portfolioAlloc, decision.confidence, `Portfolio: ${decision.action}`);

        const consensusResult = await ctx.executor.resolveConsensus(roundId);
        if (consensusResult?.success) {
          for (let i = 0; i < decision.newAllocations.length && i < consensusResult.allocations.length; i++) {
            decision.newAllocations[i].allocationBps = consensusResult.allocations[i];
          }
        }
      }

      // Commit-reveal: commit hash before execution
      commitData = await ctx.executor.commitDecision(decision, portfolioValueUSD);
    } else {
      console.log(`  [Gas] Hold decision — skipping on-chain ops (0 gas used)`);
    }

    // Autonomous rules check
    let txHash: string | null = null;
    const tradeCheck = checkTrade(
      ctx.wallet,
      { action: decision.action, confidence: decision.confidence, riskLevel: decision.riskLevel, newAllocations: decision.newAllocations },
      ctx.currentAllocations,
      risk.riskScore
    );

    if (tradeCheck.allowed) {
      if (decision.action !== "hold") {
        txHash = await ctx.executor.executeRebalance(decision);
        const oldAlloc = ctx.currentAllocations.map((a) => a.allocationBps);
        await ctx.executor.logDecisionOnChain(decision, oldAlloc, portfolioValueUSD, commitData);
        ctx.totalDecisions++;
        const blended = calculateBlendedYield(snapshot.yields, ctx.currentAllocations);
        ctx.cumulativeROIBps += Math.round((blended * 100) / 365);
        await ctx.executor.updateIdentity(ctx.totalDecisions, ctx.cumulativeROIBps);
        await ctx.executor.recordDecisionOutcome(portfolioValueUSD, decision.confidence);
      } else {
        ctx.totalDecisions++;
      }

      if (decision.action !== "hold") {
        ctx.currentAllocations = decision.newAllocations.map((a) => ({
          symbol: a.symbol,
          allocationBps: a.allocationBps,
        }));
      }

      logActivity(ctx.wallet, {
        type: "decision",
        action: decision.action,
        reasoning: decision.reasoning,
        confidence: decision.confidence,
        riskLevel: decision.riskLevel,
        allocations: decision.newAllocations,
        txHash,
        source: "agent",
      });
      notifyUserByWallet(ctx.wallet, decision, txHash);
    } else if (tradeCheck.requiresApproval) {
      ctx.pendingApproval = decision;
      logActivity(ctx.wallet, {
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

    const result: CycleResult = { snapshot, market, yields, risk, decision, txHash, timestamp: Date.now() };
    ctx.cycleHistory.push(result);
    if (ctx.cycleHistory.length > MAX_CYCLE_HISTORY) {
      ctx.cycleHistory.splice(0, ctx.cycleHistory.length - MAX_CYCLE_HISTORY);
    }
    ctx.lastCycleAt = Date.now();
    return result;
  }

  private async checkDcaForUser(ctx: UserContext): Promise<void> {
    const ready = getReadyPlans(ctx.wallet);
    if (ready.length === 0) return;

    for (const plan of ready) {
      try {
        const txHash = await ctx.executor.executeDcaSwap(plan.sourceAsset, plan.targetAsset, plan.amountBps);
        if (!txHash) continue;

        markExecuted(ctx.wallet, plan.id);
        logActivity(ctx.wallet, {
          type: "dca",
          action: `DCA ${plan.sourceAsset} -> ${plan.targetAsset}`,
          reasoning: `Scheduled DCA: ${plan.amountBps / 100}% of ${plan.sourceAsset} swapped to ${plan.targetAsset} (execution #${plan.totalExecutions + 1})`,
          source: "agent",
          txHash,
        });
      } catch (error) {
        console.error(`[DCA] Plan ${plan.id} failed for ${ctx.wallet.slice(0, 8)}...:`, error);
      }
    }
  }

  private async checkScheduledTasksForUser(ctx: UserContext, snapshot: SchedulerMarketSnapshot): Promise<void> {
    const ready = getReadyTasks(ctx.wallet, snapshot);
    if (ready.length === 0) return;

    for (const task of ready) {
      try {
        let txHash: string | null = null;
        let executed = false;

        if (task.action.targetAllocations) {
          const decision = {
            action: "rebalance" as const,
            reasoning: `Scheduled task: ${task.name}`,
            riskLevel: "medium",
            confidence: 80,
            newAllocations: task.action.targetAllocations.map((a) => ({
              asset: config.assets[a.symbol as keyof typeof config.assets] || "",
              symbol: a.symbol,
              allocationBps: a.allocationBps,
            })),
            agentContributions: { market: "N/A (scheduled)", yield: "N/A (scheduled)", risk: "N/A (scheduled)" },
          };
          txHash = await ctx.executor.executeRebalance(decision);
          if (txHash) {
            ctx.currentAllocations = task.action.targetAllocations.map((a) => ({
              symbol: a.symbol,
              allocationBps: a.allocationBps,
            }));
            executed = true;
          }
        } else if (task.action.type === "rebalance") {
          // Trigger a fresh market snapshot for this user
          const freshSnapshot = await getMarketSnapshot();
          await this.runCycleForUser(ctx, freshSnapshot);
          executed = true;
        }

        if (!executed) continue;

        markTaskExecuted(ctx.wallet, task.id);
        logActivity(ctx.wallet, {
          type: "scheduled",
          action: `Scheduled: ${task.name}`,
          reasoning: `${task.type} task executed — ${task.name} (execution #${task.totalExecutions + 1})`,
          source: "agent",
          txHash,
        });
      } catch (error) {
        console.error(`[Scheduler] Task ${task.id} failed for ${ctx.wallet.slice(0, 8)}...:`, error);
      }
    }
  }

  // --- Public API methods for use by index.ts/telegram/dashboard ---

  getDecisionHistory(wallet: string): CycleResult[] {
    return this.getContext(wallet)?.cycleHistory || [];
  }

  getCurrentAllocations(wallet: string): { symbol: string; allocationBps: number }[] {
    return this.getContext(wallet)?.currentAllocations || [
      { symbol: "USDY", allocationBps: 3333 },
      { symbol: "mETH", allocationBps: 3334 },
      { symbol: "USDC", allocationBps: 3333 },
    ];
  }

  getAgentStats(wallet: string) {
    const ctx = this.getContext(wallet);
    return {
      totalDecisions: ctx?.totalDecisions || 0,
      cumulativeROIBps: ctx?.cumulativeROIBps || 0,
      isRunning: this.running,
      uptime: process.uptime(),
    };
  }

  getPendingApproval(wallet: string): PortfolioDecision | null {
    return this.getContext(wallet)?.pendingApproval || null;
  }

  async approveDecision(wallet: string, source: "telegram" | "dashboard" | "mcp" = "telegram"): Promise<boolean> {
    const ctx = this.getContext(wallet);
    if (!ctx || !ctx.pendingApproval) return false;

    const decision = ctx.pendingApproval;
    let txHash: string | null = null;

    const portfolioValueUSD = await ctx.executor.getPortfolioValueUSD();

    if (decision.action !== "hold") {
      txHash = await ctx.executor.executeRebalance(decision);
      const oldAlloc = ctx.currentAllocations.map((a) => a.allocationBps);
      await ctx.executor.logDecisionOnChain(decision, oldAlloc, portfolioValueUSD);
    }

    logActivity(wallet, {
      type: "approval",
      action: decision.action,
      reasoning: `Trade approved via ${source}`,
      confidence: decision.confidence,
      riskLevel: decision.riskLevel,
      allocations: decision.newAllocations,
      txHash,
      source,
    });

    ctx.currentAllocations = decision.newAllocations.map((a) => ({
      symbol: a.symbol,
      allocationBps: a.allocationBps,
    }));
    ctx.totalDecisions++;

    const blended = calculateBlendedYield([], ctx.currentAllocations);
    ctx.cumulativeROIBps += Math.round((blended * 100) / 365);
    await ctx.executor.updateIdentity(ctx.totalDecisions, ctx.cumulativeROIBps);

    ctx.pendingApproval = null;
    return true;
  }

  rejectDecision(wallet: string, source: "telegram" | "dashboard" | "mcp" = "telegram"): boolean {
    const ctx = this.getContext(wallet);
    if (!ctx || !ctx.pendingApproval) return false;

    logActivity(wallet, {
      type: "rejection",
      action: ctx.pendingApproval.action,
      reasoning: `Trade rejected via ${source}`,
      source,
    });
    ctx.pendingApproval = null;
    return true;
  }

  setRiskProfile(wallet: string, profile: RiskProfile): void {
    const ctx = this.getContext(wallet);
    if (ctx) ctx.portfolioAgent.setRiskProfile(profile);
  }

  getAutonomousRules(wallet: string): AutonomousRules {
    return getRules(wallet);
  }

  updateAutonomousRules(wallet: string, update: Partial<AutonomousRules>): AutonomousRules {
    return setRules(wallet, update);
  }

  toggleAutonomous(wallet: string, enabled: boolean): AutonomousRules {
    return enableAutonomous(wallet, enabled);
  }

  getAutonomousStatus(wallet: string) {
    const rules = getRules(wallet);
    return {
      ...rules,
      tradesToday: getTradesToday(wallet),
      formattedRules: formatRules(wallet),
    };
  }

  getExecutor(wallet: string): Executor | undefined {
    return this.getContext(wallet)?.executor;
  }
}

// --- Sub-Agent Vote Computation (stateless helpers) ---

function computeMarketVote(market: MarketOutlook): number[] {
  if (market.outlook === "bullish") return [3000, 4500, 2500];
  if (market.outlook === "bearish") return [4000, 1500, 4500];
  return [3333, 3334, 3333];
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
  const sum = alloc.reduce((s, v) => s + v, 0);
  if (sum !== 10000 && sum > 0) alloc[0] += 10000 - sum;
  for (let i = 0; i < alloc.length; i++) alloc[i] = Math.min(6000, Math.max(1000, alloc[i]));
  const finalSum = alloc.reduce((s, v) => s + v, 0);
  if (finalSum !== 10000) alloc[alloc.length - 1] += 10000 - finalSum;
  return alloc;
}

function computeRiskVote(risk: RiskAnalysis): number[] {
  if (risk.riskScore >= 7) return [4500, 1000, 4500];
  if (risk.riskScore >= 5) return [4000, 2000, 4000];
  return [3000, 4000, 3000];
}
