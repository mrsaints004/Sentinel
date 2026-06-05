import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TASKS_PATH = path.resolve(process.cwd(), "..", ".scheduled-tasks.json");

interface ScheduledTask {
  id: string;
  name: string;
  type: "recurring_rebalance" | "conditional" | "one_time";
  schedule: {
    intervalMs?: number;
    dayOfWeek?: number;
    hourUTC?: number;
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

function readTasks(): ScheduledTask[] {
  try {
    if (fs.existsSync(TASKS_PATH)) {
      return JSON.parse(fs.readFileSync(TASKS_PATH, "utf-8"));
    }
  } catch {}
  return [];
}

function writeTasks(tasks: ScheduledTask[]): void {
  fs.writeFileSync(TASKS_PATH, JSON.stringify(tasks, null, 2));
}

export async function GET() {
  return NextResponse.json(readTasks());
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === "create") {
      const tasks = readTasks();
      const validTypes = ["recurring_rebalance", "conditional", "one_time"];
      if (!validTypes.includes(body.type)) {
        return NextResponse.json({ error: "Invalid task type" }, { status: 400 });
      }
      if (!body.name || typeof body.name !== "string") {
        return NextResponse.json({ error: "name is required" }, { status: 400 });
      }

      const task: ScheduledTask = {
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: body.name,
        type: body.type,
        schedule: body.schedule || {},
        condition: body.condition || undefined,
        action: body.taskAction || { type: "rebalance" },
        enabled: true,
        lastExecutedAt: null,
        totalExecutions: 0,
        createdAt: Date.now(),
      };
      tasks.push(task);
      writeTasks(tasks);
      return NextResponse.json(task);
    }

    if (action === "pause" || action === "resume") {
      const tasks = readTasks();
      const task = tasks.find((t) => t.id === body.id);
      if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
      task.enabled = action === "resume";
      writeTasks(tasks);
      return NextResponse.json(task);
    }

    if (action === "delete") {
      let tasks = readTasks();
      tasks = tasks.filter((t) => t.id !== body.id);
      writeTasks(tasks);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Invalid request" }, { status: 400 });
  }
}
