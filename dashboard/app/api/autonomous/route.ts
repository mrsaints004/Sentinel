import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { getWalletFromQuery, verifyWalletAuth, AuthError } from "../../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AutonomousRules {
  enabled: boolean;
  maxPortfolioChangeBps: number;
  maxDailyTrades: number;
  allowedAssets: string[];
  riskProfile: "conservative" | "moderate" | "aggressive";
  maxRiskScore: number;
  minConfidence: number;
}

const DEFAULT_RULES: AutonomousRules = {
  enabled: true,
  maxPortfolioChangeBps: 1500,
  maxDailyTrades: 3,
  allowedAssets: ["USDY", "mETH", "USDC"],
  riskProfile: "moderate",
  maxRiskScore: 5,
  minConfidence: 70,
};

function getUserDataPath(wallet: string, filename: string): string {
  const dir = path.resolve(process.cwd(), "..", "data", wallet.toLowerCase());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, filename);
}

function readRules(wallet: string): AutonomousRules {
  try {
    const filePath = getUserDataPath(wallet, "autonomous-rules.json");
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return { ...DEFAULT_RULES, ...data };
    }
  } catch {
    // Rules file doesn't exist — use defaults
  }
  return { ...DEFAULT_RULES };
}

function writeRules(wallet: string, rules: AutonomousRules): void {
  const filePath = getUserDataPath(wallet, "autonomous-rules.json");
  fs.writeFileSync(filePath, JSON.stringify(rules, null, 2));
}

function readPendingApproval(wallet: string): Record<string, unknown> | null {
  try {
    const filePath = getUserDataPath(wallet, "pending-approval.json");
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (data && typeof data === "object" && data.action) return data;
    }
  } catch {
    // No pending approval file
  }
  return null;
}

function clearPendingApproval(wallet: string): void {
  const filePath = getUserDataPath(wallet, "pending-approval.json");
  try {
    fs.writeFileSync(filePath, "null");
  } catch {
    // Unable to clear pending approval file
  }
}

function writeApprovalResponse(wallet: string, action: "approve" | "reject"): void {
  const filePath = getUserDataPath(wallet, "approval-response.json");
  fs.writeFileSync(filePath, JSON.stringify({ action, timestamp: Date.now() }));
}

export async function GET(request: Request) {
  const wallet = getWalletFromQuery(request);
  if (!wallet) return NextResponse.json(DEFAULT_RULES);

  const rules = readRules(wallet);
  const pendingApproval = readPendingApproval(wallet);

  return NextResponse.json({ ...rules, pendingApproval });
}

export async function POST(req: Request) {
  let wallet: string;
  try {
    wallet = verifyWalletAuth(req);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const update = await req.json();

    // Handle approve/reject actions for pending trades
    if (update.action === "approve") {
      writeApprovalResponse(wallet, "approve");
      clearPendingApproval(wallet);
      return NextResponse.json({ status: "approved", message: "Trade approved. Agent will execute on next cycle." });
    }
    if (update.action === "reject") {
      writeApprovalResponse(wallet, "reject");
      clearPendingApproval(wallet);
      return NextResponse.json({ status: "rejected", message: "Trade rejected." });
    }

    // Handle rule updates
    const rules = readRules(wallet);

    if (typeof update.enabled === "boolean") rules.enabled = update.enabled;

    if (typeof update.maxPortfolioChangeBps === "number") {
      const v = Math.round(update.maxPortfolioChangeBps);
      if (v < 100 || v > 5000) return NextResponse.json({ error: "maxPortfolioChangeBps must be 100-5000" }, { status: 400 });
      rules.maxPortfolioChangeBps = v;
    }
    if (typeof update.maxDailyTrades === "number") {
      const v = Math.round(update.maxDailyTrades);
      if (v < 1 || v > 20) return NextResponse.json({ error: "maxDailyTrades must be 1-20" }, { status: 400 });
      rules.maxDailyTrades = v;
    }
    if (Array.isArray(update.allowedAssets)) {
      const valid = ["USDY", "mETH", "USDC"];
      const filtered = update.allowedAssets.filter((a: unknown) => typeof a === "string" && valid.includes(a));
      if (filtered.length === 0) return NextResponse.json({ error: "Need at least one valid asset" }, { status: 400 });
      rules.allowedAssets = filtered;
    }
    if (typeof update.riskProfile === "string") {
      if (!["conservative", "moderate", "aggressive"].includes(update.riskProfile)) return NextResponse.json({ error: "Invalid riskProfile" }, { status: 400 });
      rules.riskProfile = update.riskProfile as AutonomousRules["riskProfile"];
    }
    if (typeof update.maxRiskScore === "number") {
      const v = Math.round(update.maxRiskScore);
      if (v < 1 || v > 10) return NextResponse.json({ error: "maxRiskScore must be 1-10" }, { status: 400 });
      rules.maxRiskScore = v;
    }
    if (typeof update.minConfidence === "number") {
      const v = Math.round(update.minConfidence);
      if (v < 0 || v > 100) return NextResponse.json({ error: "minConfidence must be 0-100" }, { status: 400 });
      rules.minConfidence = v;
    }

    writeRules(wallet, rules);
    return NextResponse.json(rules);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Invalid request body";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
