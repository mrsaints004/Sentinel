import { config } from "./config";
import { AgentManager, CycleResult } from "./agentManager";
import { PortfolioDecision, RiskProfile } from "./agents/portfolioManager";
import { AutonomousRules } from "./autonomousRules";
import {
  getPlans as getDcaPlansForUser,
  createPlan as createDcaPlanForUser,
  removePlan as removeDcaPlanForUser,
  pausePlan as pauseDcaPlanForUser,
  resumePlan as resumeDcaPlanForUser,
  formatInterval,
  DcaPlan,
} from "./dcaManager";
import {
  getTasks as getScheduledTasksForUser,
  createTask as createScheduledTaskForUser,
  removeTask as removeScheduledTaskForUser,
  pauseTask as pauseScheduledTaskForUser,
  resumeTask as resumeScheduledTaskForUser,
  createWeeklyRebalance as createWeeklyRebalanceForUser,
  createSafetyShift as createSafetyShiftForUser,
  createYieldChase as createYieldChaseForUser,
  ScheduledTask,
} from "./scheduler";

// --- Global AgentManager Instance ---
let manager: AgentManager | null = null;

export function getManager(): AgentManager | null {
  return manager;
}

export async function runNow(): Promise<boolean> {
  if (!manager) return false;
  await manager.runAllCycles();
  return true;
}

// --- Wallet-scoped exports for API / Telegram ---

export function getDecisionHistory(wallet: string): CycleResult[] {
  return manager?.getDecisionHistory(wallet) || [];
}

export function getCurrentAllocations(wallet: string): { symbol: string; allocationBps: number }[] {
  return manager?.getCurrentAllocations(wallet) || [
    { symbol: "USDY", allocationBps: 3333 },
    { symbol: "mETH", allocationBps: 3334 },
    { symbol: "USDC", allocationBps: 3333 },
  ];
}

export function getAgentStats(wallet: string) {
  return manager?.getAgentStats(wallet) || {
    totalDecisions: 0,
    cumulativeROIBps: 0,
    isRunning: false,
    uptime: 0,
  };
}

export function getPendingApproval(wallet: string): PortfolioDecision | null {
  return manager?.getPendingApproval(wallet) || null;
}

export async function approveDecision(wallet: string, source: "telegram" | "dashboard" | "mcp" = "telegram"): Promise<boolean> {
  return manager?.approveDecision(wallet, source) || false;
}

export function rejectDecision(wallet: string, source: "telegram" | "dashboard" | "mcp" = "telegram"): boolean {
  return manager?.rejectDecision(wallet, source) || false;
}

export function setRiskProfile(wallet: string, profile: RiskProfile): void {
  manager?.setRiskProfile(wallet, profile);
}

export function getAutonomousRules(wallet: string): AutonomousRules {
  return manager?.getAutonomousRules(wallet) || {
    enabled: false,
    maxPortfolioChangeBps: 2000,
    maxDailyTrades: 3,
    allowedAssets: ["USDY", "mETH", "USDC"],
    riskProfile: "moderate",
    maxRiskScore: 7,
    minConfidence: 60,
  };
}

export function updateAutonomousRules(wallet: string, update: Partial<AutonomousRules>): AutonomousRules {
  return manager?.updateAutonomousRules(wallet, update) || getAutonomousRules(wallet);
}

export function toggleAutonomous(wallet: string, enabled: boolean): AutonomousRules {
  return manager?.toggleAutonomous(wallet, enabled) || getAutonomousRules(wallet);
}

export function getAutonomousStatus(wallet: string) {
  return manager?.getAutonomousStatus(wallet) || {
    enabled: false,
    maxPortfolioChangeBps: 2000,
    maxDailyTrades: 3,
    allowedAssets: ["USDY", "mETH", "USDC"],
    riskProfile: "moderate" as const,
    maxRiskScore: 7,
    minConfidence: 60,
    tradesToday: 0,
    formattedRules: "",
  };
}

// --- DCA Exports (wallet-scoped) ---
export function getDcaPlans(wallet: string): DcaPlan[] {
  return getDcaPlansForUser(wallet);
}
export function createDcaPlan(wallet: string, opts: { sourceAsset: string; targetAsset: string; amountBps: number; intervalMs: number }): DcaPlan {
  return createDcaPlanForUser(wallet, opts);
}
export function removeDcaPlan(wallet: string, id: string): boolean {
  return removeDcaPlanForUser(wallet, id);
}
export function pauseDcaPlan(wallet: string, id: string): boolean {
  return pauseDcaPlanForUser(wallet, id);
}
export function resumeDcaPlan(wallet: string, id: string): boolean {
  return resumeDcaPlanForUser(wallet, id);
}
export { formatInterval };
export type { DcaPlan };

// --- Scheduler Exports (wallet-scoped) ---
export function getScheduledTasks(wallet: string): ScheduledTask[] {
  return getScheduledTasksForUser(wallet);
}
export function createScheduledTask(wallet: string, task: Parameters<typeof createScheduledTaskForUser>[1]): ScheduledTask {
  return createScheduledTaskForUser(wallet, task);
}
export function removeScheduledTask(wallet: string, id: string): boolean {
  return removeScheduledTaskForUser(wallet, id);
}
export function pauseScheduledTask(wallet: string, id: string): boolean {
  return pauseScheduledTaskForUser(wallet, id);
}
export function resumeScheduledTask(wallet: string, id: string): boolean {
  return resumeScheduledTaskForUser(wallet, id);
}
export function createWeeklyRebalance(wallet: string): ScheduledTask {
  return createWeeklyRebalanceForUser(wallet);
}
export function createSafetyShift(wallet: string, priceUSD: number): ScheduledTask {
  return createSafetyShiftForUser(wallet, priceUSD);
}
export function createYieldChase(wallet: string, mETHPriceAbove: number): ScheduledTask {
  return createYieldChaseForUser(wallet, mETHPriceAbove);
}
export type { ScheduledTask };

// --- Main Entry Point ---
async function main(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════╗");
  console.log("║        Sentinel — Multi-User AI Treasury on Mantle    ║");
  console.log("║                                                        ║");
  console.log("║   Agents: Market | Yield | Risk | Portfolio            ║");
  console.log("╚════════════════════════════════════════════════════════╝\n");

  if (!config.privateKey) {
    console.error("ERROR: PRIVATE_KEY must be set in .env");
    process.exit(1);
  }

  if (!config.factoryAddress && !config.vaultAddress) {
    console.error("ERROR: Either FACTORY_ADDRESS or VAULT_ADDRESS must be set in .env");
    process.exit(1);
  }

  manager = new AgentManager();
  console.log(`Interval: ${config.intervalMs / 1000}s\n`);

  await manager.start();
}

main().catch(console.error);
