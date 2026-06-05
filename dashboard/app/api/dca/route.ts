import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLANS_PATH = path.resolve(process.cwd(), "..", ".dca-plans.json");

interface DcaPlan {
  id: string;
  sourceAsset: string;
  targetAsset: string;
  amountBps: number;
  intervalMs: number;
  nextExecutionAt: number;
  totalExecutions: number;
  enabled: boolean;
  createdAt: number;
}

function readPlans(): DcaPlan[] {
  try {
    if (fs.existsSync(PLANS_PATH)) {
      return JSON.parse(fs.readFileSync(PLANS_PATH, "utf-8"));
    }
  } catch {}
  return [];
}

function writePlans(plans: DcaPlan[]): void {
  fs.writeFileSync(PLANS_PATH, JSON.stringify(plans, null, 2));
}

export async function GET() {
  return NextResponse.json(readPlans());
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === "create") {
      const plans = readPlans();
      const validAssets = ["USDY", "mETH", "USDC"];
      if (!validAssets.includes(body.sourceAsset) || !validAssets.includes(body.targetAsset)) {
        return NextResponse.json({ error: "Invalid asset" }, { status: 400 });
      }
      if (body.sourceAsset === body.targetAsset) {
        return NextResponse.json({ error: "Source and target must differ" }, { status: 400 });
      }
      if (!body.amountBps || body.amountBps < 10 || body.amountBps > 2000) {
        return NextResponse.json({ error: "amountBps must be between 10 and 2000" }, { status: 400 });
      }
      if (!body.intervalMs || body.intervalMs < 60000) {
        return NextResponse.json({ error: "intervalMs must be at least 60000 (1 minute)" }, { status: 400 });
      }

      const plan: DcaPlan = {
        id: `dca_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        sourceAsset: body.sourceAsset,
        targetAsset: body.targetAsset,
        amountBps: Math.round(body.amountBps),
        intervalMs: Math.round(body.intervalMs),
        nextExecutionAt: Date.now() + body.intervalMs,
        totalExecutions: 0,
        enabled: true,
        createdAt: Date.now(),
      };
      plans.push(plan);
      writePlans(plans);
      return NextResponse.json(plan);
    }

    if (action === "pause" || action === "resume") {
      const plans = readPlans();
      const plan = plans.find((p) => p.id === body.id);
      if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
      plan.enabled = action === "resume";
      if (action === "resume") plan.nextExecutionAt = Date.now() + plan.intervalMs;
      writePlans(plans);
      return NextResponse.json(plan);
    }

    if (action === "delete") {
      let plans = readPlans();
      plans = plans.filter((p) => p.id !== body.id);
      writePlans(plans);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Invalid request" }, { status: 400 });
  }
}
