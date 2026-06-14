import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { getWalletFromQuery, verifyWalletAuth, AuthError } from "../../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function getUserDataPath(wallet: string, filename: string): string {
  const dir = path.resolve(process.cwd(), "..", "data", wallet.toLowerCase());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, filename);
}

function readPlans(wallet: string): DcaPlan[] {
  try {
    const filePath = getUserDataPath(wallet, "dca-plans.json");
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch { /* DCA plans file missing or malformed — return empty list */ }
  return [];
}

function writePlans(wallet: string, plans: DcaPlan[]): void {
  const filePath = getUserDataPath(wallet, "dca-plans.json");
  fs.writeFileSync(filePath, JSON.stringify(plans, null, 2));
}

export async function GET(request: Request) {
  const wallet = getWalletFromQuery(request);
  if (!wallet) return NextResponse.json([]);
  return NextResponse.json(readPlans(wallet));
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
      const plans = readPlans(wallet);
      const validAssets = ["USDY", "mETH", "USDC"];
      if (!validAssets.includes(body.sourceAsset) || !validAssets.includes(body.targetAsset)) return NextResponse.json({ error: "Invalid asset" }, { status: 400 });
      if (body.sourceAsset === body.targetAsset) return NextResponse.json({ error: "Source and target must differ" }, { status: 400 });
      if (!body.amountBps || body.amountBps < 10 || body.amountBps > 2000) return NextResponse.json({ error: "amountBps must be 10-2000" }, { status: 400 });
      if (!body.intervalMs || body.intervalMs < 60000) return NextResponse.json({ error: "intervalMs must be >= 60000" }, { status: 400 });

      const plan: DcaPlan = {
        id: `dca_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        sourceAsset: body.sourceAsset, targetAsset: body.targetAsset,
        amountBps: Math.round(body.amountBps), intervalMs: Math.round(body.intervalMs),
        nextExecutionAt: Date.now() + body.intervalMs, totalExecutions: 0,
        enabled: true, createdAt: Date.now(),
      };
      plans.push(plan);
      writePlans(wallet, plans);
      return NextResponse.json(plan);
    }

    if (action === "pause" || action === "resume") {
      const plans = readPlans(wallet);
      const plan = plans.find((p) => p.id === body.id);
      if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
      plan.enabled = action === "resume";
      if (action === "resume") plan.nextExecutionAt = Date.now() + plan.intervalMs;
      writePlans(wallet, plans);
      return NextResponse.json(plan);
    }

    if (action === "delete") {
      let plans = readPlans(wallet);
      plans = plans.filter((p) => p.id !== body.id);
      writePlans(wallet, plans);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Invalid request" }, { status: 400 });
  }
}
