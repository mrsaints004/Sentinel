import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { getWalletFromQuery, verifyWalletAuth, AuthError } from "../../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ScheduledTask {
  id: string;
  name: string;
  type: "recurring_rebalance" | "conditional" | "one_time";
  schedule: { intervalMs?: number; dayOfWeek?: number; hourUTC?: number };
  condition?: { asset: string; operator: "above" | "below"; priceUSD: number };
  action: { type: "rebalance" | "shift_to_stable" | "increase_asset"; targetAllocations?: { symbol: string; allocationBps: number }[] };
  enabled: boolean;
  lastExecutedAt: number | null;
  totalExecutions: number;
  createdAt: number;
}

function getUserDataPath(wallet: string, filename: string): string {
  const dir = path.resolve(process.cwd(), "..", "data", wallet.toLowerCase());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, filename);
}

function readTasks(wallet: string): ScheduledTask[] {
  try {
    const filePath = getUserDataPath(wallet, "scheduled-tasks.json");
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {}
  return [];
}

function writeTasks(wallet: string, tasks: ScheduledTask[]): void {
  const filePath = getUserDataPath(wallet, "scheduled-tasks.json");
  fs.writeFileSync(filePath, JSON.stringify(tasks, null, 2));
}

export async function GET(request: Request) {
  const wallet = getWalletFromQuery(request);
  if (!wallet) return NextResponse.json([]);
  return NextResponse.json(readTasks(wallet));
}

export async function POST(req: Request) {
  let wallet: string;
  try {
    wallet = verifyWalletAuth(req);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { action } = body;

    if (action === "create") {
      const tasks = readTasks(wallet);
      const validTypes = ["recurring_rebalance", "conditional", "one_time"];
      if (!validTypes.includes(body.type)) return NextResponse.json({ error: "Invalid task type" }, { status: 400 });
      if (!body.name || typeof body.name !== "string") return NextResponse.json({ error: "name is required" }, { status: 400 });

      const task: ScheduledTask = {
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: body.name, type: body.type,
        schedule: body.schedule || {},
        condition: body.condition || undefined,
        action: body.taskAction || { type: "rebalance" },
        enabled: true, lastExecutedAt: null, totalExecutions: 0, createdAt: Date.now(),
      };
      tasks.push(task);
      writeTasks(wallet, tasks);
      return NextResponse.json(task);
    }

    if (action === "pause" || action === "resume") {
      const tasks = readTasks(wallet);
      const task = tasks.find((t) => t.id === body.id);
      if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
      task.enabled = action === "resume";
      writeTasks(wallet, tasks);
      return NextResponse.json(task);
    }

    if (action === "delete") {
      let tasks = readTasks(wallet);
      tasks = tasks.filter((t) => t.id !== body.id);
      writeTasks(wallet, tasks);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Invalid request" }, { status: 400 });
  }
}
