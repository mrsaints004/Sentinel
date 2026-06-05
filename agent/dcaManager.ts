import * as fs from "fs";
import * as path from "path";

const PLANS_PATH = path.join(__dirname, "..", ".dca-plans.json");

export interface DcaPlan {
  id: string;
  sourceAsset: string;       // e.g. "USDC"
  targetAsset: string;       // e.g. "mETH"
  amountBps: number;         // % of portfolio per execution (e.g. 100 = 1%)
  intervalMs: number;        // e.g. 14400000 = 4 hours
  nextExecutionAt: number;   // unix ms
  totalExecutions: number;
  enabled: boolean;
  createdAt: number;
}

function loadPlans(): DcaPlan[] {
  try {
    if (fs.existsSync(PLANS_PATH)) {
      return JSON.parse(fs.readFileSync(PLANS_PATH, "utf-8"));
    }
  } catch {}
  return [];
}

function persistPlans(plans: DcaPlan[]): void {
  try {
    fs.writeFileSync(PLANS_PATH, JSON.stringify(plans, null, 2));
  } catch (err) {
    console.warn("[DCA] Failed to persist plans:", (err as Error).message);
  }
}

let plans: DcaPlan[] = loadPlans();

export function createPlan(opts: {
  sourceAsset: string;
  targetAsset: string;
  amountBps: number;
  intervalMs: number;
}): DcaPlan {
  const plan: DcaPlan = {
    id: `dca_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    sourceAsset: opts.sourceAsset,
    targetAsset: opts.targetAsset,
    amountBps: opts.amountBps,
    intervalMs: opts.intervalMs,
    nextExecutionAt: Date.now() + opts.intervalMs,
    totalExecutions: 0,
    enabled: true,
    createdAt: Date.now(),
  };
  plans.push(plan);
  persistPlans(plans);
  return plan;
}

export function removePlan(id: string): boolean {
  const idx = plans.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  plans.splice(idx, 1);
  persistPlans(plans);
  return true;
}

export function getPlans(): DcaPlan[] {
  return plans.map((p) => ({ ...p }));
}

export function pausePlan(id: string): boolean {
  const plan = plans.find((p) => p.id === id);
  if (!plan) return false;
  plan.enabled = false;
  persistPlans(plans);
  return true;
}

export function resumePlan(id: string): boolean {
  const plan = plans.find((p) => p.id === id);
  if (!plan) return false;
  plan.enabled = true;
  plan.nextExecutionAt = Date.now() + plan.intervalMs;
  persistPlans(plans);
  return true;
}

export function getReadyPlans(): DcaPlan[] {
  const now = Date.now();
  return plans.filter((p) => p.enabled && now >= p.nextExecutionAt);
}

export function markExecuted(id: string): void {
  const plan = plans.find((p) => p.id === id);
  if (!plan) return;
  plan.totalExecutions++;
  plan.nextExecutionAt = Date.now() + plan.intervalMs;
  persistPlans(plans);
}

export function formatInterval(ms: number): string {
  const hours = ms / 3600000;
  if (hours < 1) return `${Math.round(ms / 60000)}m`;
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
