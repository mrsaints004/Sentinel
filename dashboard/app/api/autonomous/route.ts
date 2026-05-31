import { NextResponse } from "next/server";

// In-memory rules state (mirrors agent/autonomousRules.ts for the dashboard)
let rules = {
  enabled: false,
  maxPortfolioChangeBps: 2000,
  maxDailyTrades: 3,
  allowedAssets: ["USDY", "mETH", "USDC"],
  riskProfile: "moderate" as const,
  maxRiskScore: 7,
  minConfidence: 60,
  tradesToday: 0,
};

export async function GET() {
  return NextResponse.json(rules);
}

export async function POST(req: Request) {
  const update = await req.json();

  // Only allow updating known fields
  const allowed = [
    "enabled",
    "maxPortfolioChangeBps",
    "maxDailyTrades",
    "allowedAssets",
    "riskProfile",
    "maxRiskScore",
    "minConfidence",
  ];

  for (const key of allowed) {
    if (key in update) {
      (rules as any)[key] = update[key];
    }
  }

  return NextResponse.json(rules);
}
