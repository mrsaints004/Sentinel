import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RULES_PATH = path.resolve(process.cwd(), "..", ".autonomous-rules.json");

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
  enabled: false,
  maxPortfolioChangeBps: 2000,
  maxDailyTrades: 3,
  allowedAssets: ["USDY", "mETH", "USDC"],
  riskProfile: "moderate",
  maxRiskScore: 7,
  minConfidence: 60,
};

function readRules(): AutonomousRules {
  try {
    if (fs.existsSync(RULES_PATH)) {
      const data = JSON.parse(fs.readFileSync(RULES_PATH, "utf-8"));
      return { ...DEFAULT_RULES, ...data };
    }
  } catch {}
  return { ...DEFAULT_RULES };
}

function writeRules(rules: AutonomousRules): void {
  fs.writeFileSync(RULES_PATH, JSON.stringify(rules, null, 2));
}

export async function GET() {
  return NextResponse.json(readRules());
}

export async function POST(req: Request) {
  try {
    const update = await req.json();
    const rules = readRules();

    // Validate and apply each field with range checks
    if (typeof update.enabled === "boolean") {
      rules.enabled = update.enabled;
    }

    if (typeof update.maxPortfolioChangeBps === "number") {
      const v = Math.round(update.maxPortfolioChangeBps);
      if (v < 100 || v > 5000) {
        return NextResponse.json(
          { error: "maxPortfolioChangeBps must be between 100 and 5000" },
          { status: 400 }
        );
      }
      rules.maxPortfolioChangeBps = v;
    }

    if (typeof update.maxDailyTrades === "number") {
      const v = Math.round(update.maxDailyTrades);
      if (v < 1 || v > 20) {
        return NextResponse.json(
          { error: "maxDailyTrades must be between 1 and 20" },
          { status: 400 }
        );
      }
      rules.maxDailyTrades = v;
    }

    if (Array.isArray(update.allowedAssets)) {
      const valid = ["USDY", "mETH", "USDC"];
      const filtered = update.allowedAssets.filter((a: unknown) =>
        typeof a === "string" && valid.includes(a)
      );
      if (filtered.length === 0) {
        return NextResponse.json(
          { error: "allowedAssets must contain at least one valid asset" },
          { status: 400 }
        );
      }
      rules.allowedAssets = filtered;
    }

    if (typeof update.riskProfile === "string") {
      if (!["conservative", "moderate", "aggressive"].includes(update.riskProfile)) {
        return NextResponse.json(
          { error: "riskProfile must be conservative, moderate, or aggressive" },
          { status: 400 }
        );
      }
      rules.riskProfile = update.riskProfile as AutonomousRules["riskProfile"];
    }

    if (typeof update.maxRiskScore === "number") {
      const v = Math.round(update.maxRiskScore);
      if (v < 1 || v > 10) {
        return NextResponse.json(
          { error: "maxRiskScore must be between 1 and 10" },
          { status: 400 }
        );
      }
      rules.maxRiskScore = v;
    }

    if (typeof update.minConfidence === "number") {
      const v = Math.round(update.minConfidence);
      if (v < 0 || v > 100) {
        return NextResponse.json(
          { error: "minConfidence must be between 0 and 100" },
          { status: 400 }
        );
      }
      rules.minConfidence = v;
    }

    writeRules(rules);
    return NextResponse.json(rules);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Invalid request body" },
      { status: 400 }
    );
  }
}
