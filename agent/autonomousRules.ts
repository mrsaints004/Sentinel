import * as fs from "fs";
import * as path from "path";

const RULES_PATH = path.join(__dirname, "..", ".autonomous-rules.json");

export interface AutonomousRules {
  enabled: boolean;
  maxPortfolioChangeBps: number;  // max single-asset change per trade (e.g. 2000 = 20%)
  maxDailyTrades: number;
  allowedAssets: string[];
  riskProfile: "conservative" | "moderate" | "aggressive";
  maxRiskScore: number;           // won't execute if risk score exceeds this
  minConfidence: number;          // won't execute if AI confidence below this (0-100)
}

export interface TradeCheck {
  allowed: boolean;
  reason: string;
  requiresApproval: boolean;
  violations: string[];
}

const DEFAULT_RULES: AutonomousRules = {
  enabled: false,
  maxPortfolioChangeBps: 2000,    // 20%
  maxDailyTrades: 3,
  allowedAssets: ["USDY", "mETH", "USDC"],
  riskProfile: "moderate",
  maxRiskScore: 7,
  minConfidence: 60,
};

// Load persisted rules from disk
function loadRules(): AutonomousRules {
  try {
    if (fs.existsSync(RULES_PATH)) {
      const data = JSON.parse(fs.readFileSync(RULES_PATH, "utf-8"));
      return { ...DEFAULT_RULES, ...data };
    }
  } catch {}
  return { ...DEFAULT_RULES };
}

function persistRules(r: AutonomousRules): void {
  try {
    fs.writeFileSync(RULES_PATH, JSON.stringify(r, null, 2));
  } catch (err) {
    console.warn("[AutonomousRules] Failed to persist rules:", (err as Error).message);
  }
}

let rules: AutonomousRules = loadRules();
let tradesToday: number = 0;
let lastTradeDate: string = "";

// Use UTC date string for timezone-independent daily reset
function getUTCDateString(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

export function getRules(): AutonomousRules {
  return { ...rules };
}

export function setRules(update: Partial<AutonomousRules>): AutonomousRules {
  rules = { ...rules, ...update };
  persistRules(rules);
  return { ...rules };
}

export function enableAutonomous(enabled: boolean): AutonomousRules {
  rules.enabled = enabled;
  persistRules(rules);
  return { ...rules };
}

export function resetDailyCounter(): void {
  tradesToday = 0;
  lastTradeDate = getUTCDateString();
}

export function checkTrade(
  decision: {
    action: string;
    confidence: number;
    riskLevel: string;
    newAllocations: { symbol: string; allocationBps: number }[];
  },
  currentAllocations: { symbol: string; allocationBps: number }[],
  riskScore: number
): TradeCheck {
  // Reset daily counter if new day (UTC)
  const today = getUTCDateString();
  if (today !== lastTradeDate) {
    tradesToday = 0;
    lastTradeDate = today;
  }

  if (!rules.enabled) {
    return {
      allowed: false,
      reason: "Autonomous mode is disabled. Approval required.",
      requiresApproval: true,
      violations: [],
    };
  }

  // Hold decisions always pass
  if (decision.action === "hold") {
    return {
      allowed: true,
      reason: "Hold decision — no trade needed.",
      requiresApproval: false,
      violations: [],
    };
  }

  const violations: string[] = [];

  // Check 1: Daily trade limit
  if (tradesToday >= rules.maxDailyTrades) {
    violations.push(
      `Daily trade limit reached (${tradesToday}/${rules.maxDailyTrades})`
    );
  }

  // Check 2: Max portfolio change per asset
  for (const newAlloc of decision.newAllocations) {
    const current = currentAllocations.find((c) => c.symbol === newAlloc.symbol);
    const currentBps = current?.allocationBps ?? 3333;
    const delta = Math.abs(newAlloc.allocationBps - currentBps);

    if (delta > rules.maxPortfolioChangeBps) {
      violations.push(
        `${newAlloc.symbol} change ${(delta / 100).toFixed(0)}% exceeds max ${(rules.maxPortfolioChangeBps / 100).toFixed(0)}%`
      );
    }
  }

  // Check 3: Allowed assets only
  for (const alloc of decision.newAllocations) {
    if (!rules.allowedAssets.includes(alloc.symbol)) {
      violations.push(`${alloc.symbol} is not in allowed assets list`);
    }
  }

  // Check 4: Risk score limit
  if (riskScore > rules.maxRiskScore) {
    violations.push(
      `Risk score ${riskScore.toFixed(1)} exceeds max ${rules.maxRiskScore}`
    );
  }

  // Check 5: Minimum confidence
  if (decision.confidence < rules.minConfidence) {
    violations.push(
      `Confidence ${decision.confidence}% below minimum ${rules.minConfidence}%`
    );
  }

  // Emergency withdrawals always require approval unless risk is critical
  if (decision.action === "emergency_withdraw" && riskScore < 9) {
    violations.push("Emergency withdrawals require manual approval");
  }

  if (violations.length > 0) {
    return {
      allowed: false,
      reason: `Trade exceeds autonomous limits: ${violations.join("; ")}`,
      requiresApproval: true,
      violations,
    };
  }

  // All checks passed — trade is allowed
  tradesToday++;
  return {
    allowed: true,
    reason: `Trade within autonomous limits. (${tradesToday}/${rules.maxDailyTrades} daily trades used)`,
    requiresApproval: false,
    violations: [],
  };
}

export function getTradesToday(): number {
  const today = getUTCDateString();
  if (today !== lastTradeDate) return 0;
  return tradesToday;
}

export function formatRules(): string {
  return [
    `Autonomous Mode: ${rules.enabled ? "ENABLED" : "DISABLED"}`,
    `Max Portfolio Change: ${(rules.maxPortfolioChangeBps / 100).toFixed(0)}% per asset`,
    `Max Daily Trades: ${rules.maxDailyTrades}`,
    `Allowed Assets: ${rules.allowedAssets.join(", ")}`,
    `Risk Profile: ${rules.riskProfile}`,
    `Max Risk Score: ${rules.maxRiskScore}/10`,
    `Min Confidence: ${rules.minConfidence}%`,
  ].join("\n");
}
