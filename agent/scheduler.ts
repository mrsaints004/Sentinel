import * as fs from "fs";
import * as path from "path";

const TASKS_PATH = path.join(__dirname, "..", ".scheduled-tasks.json");

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

function loadTasks(): ScheduledTask[] {
  try {
    if (fs.existsSync(TASKS_PATH)) {
      return JSON.parse(fs.readFileSync(TASKS_PATH, "utf-8"));
    }
  } catch {}
  return [];
}

function persistTasks(tasks: ScheduledTask[]): void {
  try {
    fs.writeFileSync(TASKS_PATH, JSON.stringify(tasks, null, 2));
  } catch (err) {
    console.warn("[Scheduler] Failed to persist tasks:", (err as Error).message);
  }
}

let tasks: ScheduledTask[] = loadTasks();

export function createTask(task: Omit<ScheduledTask, "id" | "lastExecutedAt" | "totalExecutions" | "createdAt">): ScheduledTask {
  const newTask: ScheduledTask = {
    ...task,
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    lastExecutedAt: null,
    totalExecutions: 0,
    createdAt: Date.now(),
  };
  tasks.push(newTask);
  persistTasks(tasks);
  return newTask;
}

export function removeTask(id: string): boolean {
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  tasks.splice(idx, 1);
  persistTasks(tasks);
  return true;
}

export function getTasks(): ScheduledTask[] {
  return tasks.map((t) => ({ ...t }));
}

export function pauseTask(id: string): boolean {
  const task = tasks.find((t) => t.id === id);
  if (!task) return false;
  task.enabled = false;
  persistTasks(tasks);
  return true;
}

export function resumeTask(id: string): boolean {
  const task = tasks.find((t) => t.id === id);
  if (!task) return false;
  task.enabled = true;
  persistTasks(tasks);
  return true;
}

export function markTaskExecuted(id: string): void {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  task.totalExecutions++;
  task.lastExecutedAt = Date.now();
  // Disable one-time tasks after execution
  if (task.type === "one_time") {
    task.enabled = false;
  }
  persistTasks(tasks);
}

export interface MarketSnapshot {
  prices: { [symbol: string]: number };
}

export function getReadyTasks(snapshot: MarketSnapshot): ScheduledTask[] {
  const now = new Date();
  return tasks.filter((task) => {
    if (!task.enabled) return false;

    // Check schedule timing
    if (task.type === "recurring_rebalance") {
      const { schedule, lastExecutedAt } = task;

      // Day-of-week + hour based schedule (e.g. every Sunday at 00:00 UTC)
      if (schedule.dayOfWeek !== undefined && schedule.hourUTC !== undefined) {
        const currentDay = now.getUTCDay();
        const currentHour = now.getUTCHours();
        if (currentDay !== schedule.dayOfWeek || currentHour !== schedule.hourUTC) return false;
        // Don't re-execute within the same hour
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

      // Interval-based schedule
      if (schedule.intervalMs) {
        if (!lastExecutedAt) return true;
        return now.getTime() - lastExecutedAt >= schedule.intervalMs;
      }
    }

    // Conditional tasks: check price condition with cooldown
    if (task.type === "conditional" && task.condition) {
      // Cooldown: don't re-trigger within 1 hour of last execution
      if (task.lastExecutedAt && now.getTime() - task.lastExecutedAt < 3600000) return false;

      const price = snapshot.prices[task.condition.asset];
      if (price === undefined) return false;
      if (task.condition.operator === "below" && price < task.condition.priceUSD) return true;
      if (task.condition.operator === "above" && price > task.condition.priceUSD) return true;
      return false;
    }

    // One-time tasks: execute immediately if never executed
    if (task.type === "one_time") {
      return task.lastExecutedAt === null;
    }

    return false;
  });
}

// --- Pre-built Templates ---

function hasDuplicateTask(name: string): boolean {
  return tasks.some((t) => t.name === name && t.enabled);
}

export function createWeeklyRebalance(): ScheduledTask {
  if (hasDuplicateTask("Weekly Rebalance")) {
    throw new Error("A Weekly Rebalance task already exists");
  }
  return createTask({
    name: "Weekly Rebalance",
    type: "recurring_rebalance",
    schedule: { dayOfWeek: 0, hourUTC: 0 },
    action: { type: "rebalance" },
    enabled: true,
  });
}

export function createSafetyShift(priceUSD: number): ScheduledTask {
  if (priceUSD <= 0) throw new Error("Safety Shift requires a positive price threshold");
  if (hasDuplicateTask("Safety Shift")) {
    throw new Error("A Safety Shift task already exists — remove the old one first");
  }
  return createTask({
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

export function createYieldChase(mETHPriceAbove: number): ScheduledTask {
  if (mETHPriceAbove <= 0) throw new Error("Yield Chase requires a positive price threshold");
  if (hasDuplicateTask("Yield Chase")) {
    throw new Error("A Yield Chase task already exists — remove the old one first");
  }
  return createTask({
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
