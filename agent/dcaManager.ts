import { loadUserFileSync, saveUserFileSync } from "./userStore";

const DCA_FILE = "dca-plans.json";

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

function loadPlans(wallet: string): DcaPlan[] {
  return loadUserFileSync<DcaPlan[]>(wallet, DCA_FILE, []);
}

function persistPlans(wallet: string, plans: DcaPlan[]): void {
  saveUserFileSync(wallet, DCA_FILE, plans);
}

export function createPlan(wallet: string, opts: {
  sourceAsset: string;
  targetAsset: string;
  amountBps: number;
  intervalMs: number;
}): DcaPlan {
  const plans = loadPlans(wallet);
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
  persistPlans(wallet, plans);
  return plan;
}

export function removePlan(wallet: string, id: string): boolean {
  const plans = loadPlans(wallet);
  const idx = plans.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  plans.splice(idx, 1);
  persistPlans(wallet, plans);
  return true;
}

export function getPlans(wallet: string): DcaPlan[] {
  return loadPlans(wallet).map((p) => ({ ...p }));
}

export function pausePlan(wallet: string, id: string): boolean {
  const plans = loadPlans(wallet);
  const plan = plans.find((p) => p.id === id);
  if (!plan) return false;
  plan.enabled = false;
  persistPlans(wallet, plans);
  return true;
}

export function resumePlan(wallet: string, id: string): boolean {
  const plans = loadPlans(wallet);
  const plan = plans.find((p) => p.id === id);
  if (!plan) return false;
  plan.enabled = true;
  plan.nextExecutionAt = Date.now() + plan.intervalMs;
  persistPlans(wallet, plans);
  return true;
}

export function getReadyPlans(wallet: string): DcaPlan[] {
  const now = Date.now();
  return loadPlans(wallet).filter((p) => p.enabled && now >= p.nextExecutionAt);
}

export function markExecuted(wallet: string, id: string): void {
  const plans = loadPlans(wallet);
  const plan = plans.find((p) => p.id === id);
  if (!plan) return;
  plan.totalExecutions++;
  plan.nextExecutionAt = Date.now() + plan.intervalMs;
  persistPlans(wallet, plans);
}

export function formatInterval(ms: number): string {
  const hours = ms / 3600000;
  if (hours < 1) return `${Math.round(ms / 60000)}m`;
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
