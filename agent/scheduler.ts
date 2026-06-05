import { loadUserFileSync, saveUserFileSync } from "./userStore";

const TASKS_FILE = "scheduled-tasks.json";

export interface ScheduledTask {
  id: string;
  name: string;
  type: "recurring_rebalance" | "conditional" | "one_time";
  schedule: {
    intervalMs?: number;
    dayOfWeek?: number;   // 0=Sunday .. 6=Saturday
    hourUTC?: number;     // 0-23
  };
  condition?: {
    asset: string;
    operator: "above" | "below";
    priceUSD: number;
  };
  action: {
    type: "rebalance" | "shift_to_stable" | "increase_asset";
    targetAllocations?: { symbol: string; allocationBps: number }[];
  };
  enabled: boolean;
  lastExecutedAt: number | null;
  totalExecutions: number;
  createdAt: number;
}

function loadTasks(wallet: string): ScheduledTask[] {
  return loadUserFileSync<ScheduledTask[]>(wallet, TASKS_FILE, []);
}

function persistTasks(wallet: string, tasks: ScheduledTask[]): void {
  saveUserFileSync(wallet, TASKS_FILE, tasks);
}

export function createTask(wallet: string, task: Omit<ScheduledTask, "id" | "lastExecutedAt" | "totalExecutions" | "createdAt">): ScheduledTask {
  const tasks = loadTasks(wallet);
  const newTask: ScheduledTask = {
    ...task,
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    lastExecutedAt: null,
    totalExecutions: 0,
    createdAt: Date.now(),
  };
  tasks.push(newTask);
  persistTasks(wallet, tasks);
  return newTask;
}

export function removeTask(wallet: string, id: string): boolean {
  const tasks = loadTasks(wallet);
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  tasks.splice(idx, 1);
  persistTasks(wallet, tasks);
  return true;
}

export function getTasks(wallet: string): ScheduledTask[] {
  return loadTasks(wallet).map((t) => ({ ...t }));
}

export function pauseTask(wallet: string, id: string): boolean {
  const tasks = loadTasks(wallet);
  const task = tasks.find((t) => t.id === id);
  if (!task) return false;
  task.enabled = false;
  persistTasks(wallet, tasks);
  return true;
}

export function resumeTask(wallet: string, id: string): boolean {
  const tasks = loadTasks(wallet);
  const task = tasks.find((t) => t.id === id);
  if (!task) return false;
  task.enabled = true;
  persistTasks(wallet, tasks);
  return true;
}

export function markTaskExecuted(wallet: string, id: string): void {
  const tasks = loadTasks(wallet);
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  task.totalExecutions++;
  task.lastExecutedAt = Date.now();
  if (task.type === "one_time") {
    task.enabled = false;
  }
  persistTasks(wallet, tasks);
}

export interface MarketSnapshot {
  prices: { [symbol: string]: number };
}

export function getReadyTasks(wallet: string, snapshot: MarketSnapshot): ScheduledTask[] {
  const now = new Date();
  const tasks = loadTasks(wallet);
  return tasks.filter((task) => {
    if (!task.enabled) return false;

    if (task.type === "recurring_rebalance") {
      const { schedule, lastExecutedAt } = task;

      if (schedule.dayOfWeek !== undefined && schedule.hourUTC !== undefined) {
        const currentDay = now.getUTCDay();
        const currentHour = now.getUTCHours();
        if (currentDay !== schedule.dayOfWeek || currentHour !== schedule.hourUTC) return false;
        if (lastExecutedAt) {
          const lastExec = new Date(lastExecutedAt);
          if (
            lastExec.getUTCDay() === currentDay &&
            lastExec.getUTCHours() === currentHour &&
            now.getTime() - lastExecutedAt < 3600000
          ) return false;
        }
        return true;
      }

      if (schedule.intervalMs) {
        if (!lastExecutedAt) return true;
        return now.getTime() - lastExecutedAt >= schedule.intervalMs;
      }
    }

    if (task.type === "conditional" && task.condition) {
      if (task.lastExecutedAt && now.getTime() - task.lastExecutedAt < 3600000) return false;
      const price = snapshot.prices[task.condition.asset];
      if (price === undefined) return false;
      if (task.condition.operator === "below" && price < task.condition.priceUSD) return true;
      if (task.condition.operator === "above" && price > task.condition.priceUSD) return true;
      return false;
    }

    if (task.type === "one_time") {
      return task.lastExecutedAt === null;
    }

    return false;
  });
}

// --- Pre-built Templates ---

function hasDuplicateTask(wallet: string, name: string): boolean {
  const tasks = loadTasks(wallet);
  return tasks.some((t) => t.name === name && t.enabled);
}

export function createWeeklyRebalance(wallet: string): ScheduledTask {
  if (hasDuplicateTask(wallet, "Weekly Rebalance")) {
    throw new Error("A Weekly Rebalance task already exists");
  }
  return createTask(wallet, {
    name: "Weekly Rebalance",
    type: "recurring_rebalance",
    schedule: { dayOfWeek: 0, hourUTC: 0 },
    action: { type: "rebalance" },
    enabled: true,
  });
}

export function createSafetyShift(wallet: string, priceUSD: number): ScheduledTask {
  if (priceUSD <= 0) throw new Error("Safety Shift requires a positive price threshold");
  if (hasDuplicateTask(wallet, "Safety Shift")) {
    throw new Error("A Safety Shift task already exists — remove the old one first");
  }
  return createTask(wallet, {
    name: "Safety Shift",
    type: "conditional",
    schedule: {},
    condition: { asset: "mETH", operator: "below", priceUSD },
    action: {
      type: "shift_to_stable",
      targetAllocations: [
        { symbol: "USDY", allocationBps: 4000 },
        { symbol: "mETH", allocationBps: 2000 },
        { symbol: "USDC", allocationBps: 4000 },
      ],
    },
    enabled: true,
  });
}

export function createYieldChase(wallet: string, mETHPriceAbove: number): ScheduledTask {
  if (mETHPriceAbove <= 0) throw new Error("Yield Chase requires a positive price threshold");
  if (hasDuplicateTask(wallet, "Yield Chase")) {
    throw new Error("A Yield Chase task already exists — remove the old one first");
  }
  return createTask(wallet, {
    name: "Yield Chase",
    type: "conditional",
    schedule: {},
    condition: { asset: "mETH", operator: "above", priceUSD: mETHPriceAbove },
    action: {
      type: "increase_asset",
      targetAllocations: [
        { symbol: "mETH", allocationBps: 5000 },
        { symbol: "USDY", allocationBps: 2500 },
        { symbol: "USDC", allocationBps: 2500 },
      ],
    },
    enabled: true,
  });
}
